-- MB Stats: migrations 0005-0010 in one script for the Supabase SQL editor.
-- Generated from supabase/migrations by concatenation (do not edit by hand).
-- Why: the Supabase connector asks for a confirmation on any statement containing DELETE
-- (even inside a function body), and that confirmation cannot be answered from the cloud
-- session. Run this whole file once in Supabase > SQL Editor > New query > Run.
-- It runs in one transaction: either everything is applied or nothing is.

begin;

-- ===================================================================
-- 0005_upload_rpcs
-- ===================================================================

-- Upload lifecycle: publish, retract, discard and the review comparison.
--
-- publish_upload and retract_upload are SECURITY DEFINER (the architecture draft said
-- INVOKER): they are the only code allowed to flip upload_slices.is_current and
-- uploads.status, which clients therefore cannot write directly. Both check
-- is_app_user() first and serialize per dataset with an advisory lock.

-- Total of one metric for one company x month, either inside a given upload or (when
-- p_upload_id is null) in the current data. Current data with no current slice for the
-- month is null (no data); a covered month without rows is 0.
create or replace function private.month_total(
  p_metric_id smallint,
  p_company_id smallint,
  p_scenario text,
  p_month date,
  p_upload_id uuid
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_metric public.metrics%rowtype;
  v_upload uuid := p_upload_id;
begin
  select m.* into v_metric from public.metrics m where m.id = p_metric_id;
  if v_upload is null then
    select s.upload_id into v_upload
    from public.upload_slices s
    where s.dataset_id = v_metric.dataset_id
      and s.company_id = p_company_id
      and s.scenario = p_scenario
      and s.month = p_month
      and s.is_current;
    if v_upload is null then
      return null;
    end if;
  end if;

  if v_metric.kind = 'ledger' then
    return coalesce((
      select sum(lb.amount * ag.sign)
      from public.ledger_balances lb
      join public.account_groups ag on ag.key = v_metric.account_group_key
      where lb.upload_id = v_upload
        and lb.company_id = p_company_id
        and lb.month = p_month
        and lb.dim_no is null
        and exists (
          select 1 from public.account_group_ranges r
          where r.group_key = ag.key and lb.account between r.from_account and r.to_account
        )
    ), 0);
  end if;

  return coalesce((
    select sum(mv.value)
    from public.metric_values mv
    where mv.upload_id = v_upload
      and mv.metric_id = p_metric_id
      and mv.company_id = p_company_id
      and mv.month = p_month
  ), 0);
end;
$$;

create or replace function public.publish_upload(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_dataset public.datasets%rowtype;
  v_min_engine integer;
  v_slices integer;
  v_won integer;
  v_superseded uuid[];
  v_facts bigint;
  v_ledger bigint;
begin
  perform private.assert_app_user();

  select u.* into v_upload from public.uploads u where u.id = p_upload_id;
  if not found then
    raise exception 'Uppladdningen finns inte' using errcode = 'no_data_found';
  end if;
  perform pg_advisory_xact_lock(hashtext('publish:' || v_upload.dataset_id::text));
  select u.* into v_upload from public.uploads u where u.id = p_upload_id for update;
  if v_upload.status <> 'staged' then
    raise exception 'Bara förberedda uppladdningar kan publiceras (status: %)', v_upload.status
      using errcode = 'check_violation';
  end if;
  select d.* into v_dataset from public.datasets d where d.id = v_upload.dataset_id;

  select (s.value #>> '{}')::integer into v_min_engine
  from public.settings s where s.key = 'min_engine_version';
  if v_upload.engine_version < coalesce(v_min_engine, 1) then
    raise exception 'Filen är inläst med en för gammal version (motor % < %). Läs in den igen.',
      v_upload.engine_version, v_min_engine
      using errcode = 'check_violation';
  end if;

  if v_upload.template_id is not null and not exists (
    select 1 from public.import_templates t
    where t.id = v_upload.template_id and t.dataset_id = v_upload.dataset_id
  ) then
    raise exception 'Importmallen hör till en annan datakälla' using errcode = 'check_violation';
  end if;

  select count(*) into v_slices from public.upload_slices s where s.upload_id = p_upload_id;
  if v_slices = 0 then
    raise exception 'Uppladdningen saknar månader' using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.metric_values mv
    join public.metrics m on m.id = mv.metric_id
    where mv.upload_id = p_upload_id
      and (m.dataset_id is distinct from v_upload.dataset_id or m.kind not in ('sum', 'snapshot'))
  ) then
    raise exception 'Uppladdningen innehåller mått som inte hör till datakällan %', v_dataset.key
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.metric_values mv
    where mv.upload_id = p_upload_id
      and not exists (
        select 1 from public.upload_slices s
        where s.upload_id = p_upload_id and s.company_id = mv.company_id and s.month = mv.month
      )
  ) then
    raise exception 'Uppladdningen innehåller värden utanför sina bolag och månader'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.metric_values mv
    cross join lateral jsonb_each(mv.dims) e
    where mv.upload_id = p_upload_id
      and not exists (
        select 1
        from public.dimensions d
        join public.dataset_dimensions dd
          on dd.dimension_id = d.id and dd.dataset_id = v_upload.dataset_id
        join public.dimension_values dv on dv.dimension_id = d.id
        where d.key = e.key
          and dv.id = case
            when jsonb_typeof(e.value) = 'number' and (e.value #>> '{}') ~ '^[0-9]{1,18}$'
              then (e.value #>> '{}')::bigint
          end
      )
  ) then
    raise exception 'Uppladdningen refererar till dimensionsvärden som inte hör till datakällan'
      using errcode = 'check_violation';
  end if;

  -- Kostnadsställen are scoped per company ("MBAB:100"); a fact (e.g. budget) on another
  -- company's or an unscoped value would never line up with that company's ledger.
  if exists (
    select 1
    from public.metric_values mv
    join public.companies c on c.id = mv.company_id
    join public.dimension_values dv on dv.id = (mv.dims ->> 'kostnadsstalle')::bigint
    where mv.upload_id = p_upload_id
      and mv.dims ? 'kostnadsstalle'
      and left(dv.code, length(c.code) + 1) <> c.code || ':'
  ) then
    raise exception 'Uppladdningen refererar till kostnadsställen i ett annat bolag eller utan bolag'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_ledger from public.ledger_balances lb where lb.upload_id = p_upload_id;
  if v_ledger > 0 and v_dataset.kind <> 'ledger' then
    raise exception 'Bokföringsrader kan bara publiceras i en bokföringskälla'
      using errcode = 'check_violation';
  end if;
  if v_dataset.kind = 'ledger' then
    if (select count(distinct s.company_id) from public.upload_slices s
        where s.upload_id = p_upload_id) > 1 then
      raise exception 'En SIE-fil gäller ett bolag' using errcode = 'check_violation';
    end if;
    if exists (
      select 1
      from public.ledger_balances lb
      where lb.upload_id = p_upload_id
        and not exists (
          select 1 from public.upload_slices s
          where s.upload_id = p_upload_id and s.company_id = lb.company_id and s.month = lb.month
        )
    ) then
      raise exception 'Bokföringens bolag eller månader stämmer inte med uppladdningen'
        using errcode = 'check_violation';
    end if;
    -- Dimension 1 object rows are what ledger_monthly groups by kostnadsstalle: they must
    -- point at the company's own kostnadsställen (codes are scoped "MBAB:100").
    if exists (
      select 1
      from public.ledger_balances lb
      join public.companies c on c.id = lb.company_id
      left join public.dimension_values dv on dv.id = lb.object_value_id
      left join public.dimensions d on d.id = dv.dimension_id
      where lb.upload_id = p_upload_id
        and lb.dim_no = 1
        and (
          d.key is distinct from 'kostnadsstalle'
          or left(dv.code, length(c.code) + 1) is distinct from c.code || ':'
        )
    ) then
      raise exception 'Bokföringens objektrader för dimension 1 måste vara kostnadsställen i uppladdningens bolag'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Same rule as uploads_published_file_uniq: an upload whose template was deleted while
  -- it was staged (template_id null, version kept) is not compared.
  if (v_upload.template_id is not null or v_upload.template_version is null) and exists (
    select 1
    from public.uploads u
    where u.status = 'published'
      and u.id <> p_upload_id
      and u.dataset_id = v_upload.dataset_id
      and u.file_sha256 = v_upload.file_sha256
      and u.template_id is not distinct from v_upload.template_id
      and u.template_version is not distinct from v_upload.template_version
  ) then
    raise exception 'Filen är redan publicerad med samma mallversion'
      using errcode = 'unique_violation';
  end if;

  -- A slice becomes current unless the current slice has higher priority (a SIE file's
  -- own year beats previous-year rows from the next year's file).
  with winners as (
    select s.company_id, s.scenario, s.month
    from public.upload_slices s
    left join public.upload_slices c
      on c.dataset_id = s.dataset_id and c.company_id = s.company_id
      and c.scenario = s.scenario and c.month = s.month and c.is_current
    where s.upload_id = p_upload_id
      and (c.upload_id is null or s.priority >= c.priority)
  ),
  demoted as (
    update public.upload_slices c
    set is_current = false
    from winners w
    where c.dataset_id = v_upload.dataset_id
      and c.company_id = w.company_id
      and c.scenario = w.scenario
      and c.month = w.month
      and c.is_current
    returning c.upload_id
  )
  select coalesce(array_agg(distinct d.upload_id), '{}') into v_superseded from demoted d;

  update public.upload_slices s
  set is_current = true
  where s.upload_id = p_upload_id
    and not exists (
      select 1 from public.upload_slices c
      where c.dataset_id = s.dataset_id and c.company_id = s.company_id
        and c.scenario = s.scenario and c.month = s.month and c.is_current
    );
  get diagnostics v_won = row_count;

  -- clock_timestamp(), taken under the advisory lock: published_at follows the order in
  -- which publishes take effect (now() is the transaction start, which can be earlier
  -- than a publish that committed while this one waited, or equal within a transaction).
  update public.uploads
  set status = 'published', published_at = clock_timestamp()
  where id = p_upload_id;

  select count(*) into v_facts from public.metric_values mv where mv.upload_id = p_upload_id;

  insert into public.audit_log (action, entity, entity_id, detail)
  values ('publish', 'upload', p_upload_id::text, jsonb_build_object(
    'dataset', v_dataset.key, 'slices', v_slices, 'current', v_won,
    'superseded', to_jsonb(v_superseded)));

  return jsonb_build_object(
    'upload_id', p_upload_id,
    'dataset', v_dataset.key,
    'slices', v_slices,
    'current', v_won,
    'kept', v_slices - v_won,
    'superseded', to_jsonb(v_superseded),
    'facts', v_facts,
    'ledger_rows', v_ledger
  );
end;
$$;

create or replace function public.retract_upload(p_upload_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_slice public.upload_slices%rowtype;
  v_replacement uuid;
  v_released integer := 0;
  v_restored integer := 0;
  v_restored_from uuid[] := '{}';
begin
  perform private.assert_app_user();

  select u.* into v_upload from public.uploads u where u.id = p_upload_id;
  if not found then
    raise exception 'Uppladdningen finns inte' using errcode = 'no_data_found';
  end if;
  perform pg_advisory_xact_lock(hashtext('publish:' || v_upload.dataset_id::text));
  select u.* into v_upload from public.uploads u where u.id = p_upload_id for update;
  if v_upload.status <> 'published' then
    raise exception 'Bara publicerade uppladdningar kan dras tillbaka (status: %)', v_upload.status
      using errcode = 'check_violation';
  end if;

  for v_slice in
    select s.* from public.upload_slices s where s.upload_id = p_upload_id and s.is_current
  loop
    update public.upload_slices s
    set is_current = false
    where s.upload_id = p_upload_id and s.company_id = v_slice.company_id
      and s.scenario = v_slice.scenario and s.month = v_slice.month;
    v_released := v_released + 1;

    -- The slice that would be current had this upload never been published.
    select s.upload_id into v_replacement
    from public.upload_slices s
    join public.uploads u on u.id = s.upload_id
    where s.dataset_id = v_slice.dataset_id
      and s.company_id = v_slice.company_id
      and s.scenario = v_slice.scenario
      and s.month = v_slice.month
      and u.status = 'published'
      and u.id <> p_upload_id
    order by s.priority desc, u.published_at desc, u.id desc
    limit 1;

    if v_replacement is not null then
      update public.upload_slices s
      set is_current = true
      where s.upload_id = v_replacement and s.company_id = v_slice.company_id
        and s.scenario = v_slice.scenario and s.month = v_slice.month;
      v_restored := v_restored + 1;
      if not v_replacement = any(v_restored_from) then
        v_restored_from := array_append(v_restored_from, v_replacement);
      end if;
    end if;
  end loop;

  update public.uploads
  set status = 'retracted', retracted_at = now(), retract_reason = nullif(btrim(p_reason), '')
  where id = p_upload_id;

  insert into public.audit_log (action, entity, entity_id, detail)
  values ('retract', 'upload', p_upload_id::text, jsonb_build_object(
    'reason', nullif(btrim(p_reason), ''), 'released', v_released, 'restored', v_restored,
    'restored_from', to_jsonb(v_restored_from)));

  return jsonb_build_object(
    'upload_id', p_upload_id,
    'released', v_released,
    'restored', v_restored,
    'restored_from', to_jsonb(v_restored_from)
  );
end;
$$;

create or replace function public.discard_upload(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_facts bigint;
  v_ledger bigint;
begin
  perform private.assert_app_user();

  select u.* into v_upload from public.uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception 'Uppladdningen finns inte' using errcode = 'no_data_found';
  end if;
  if v_upload.status <> 'staged' then
    raise exception 'Bara förberedda uppladdningar kan kastas (status: %)', v_upload.status
      using errcode = 'check_violation';
  end if;

  delete from public.metric_values mv where mv.upload_id = p_upload_id;
  get diagnostics v_facts = row_count;
  delete from public.ledger_balances lb where lb.upload_id = p_upload_id;
  get diagnostics v_ledger = row_count;

  update public.uploads set status = 'discarded' where id = p_upload_id;

  insert into public.audit_log (action, entity, entity_id, detail)
  values ('discard', 'upload', p_upload_id::text,
    jsonb_build_object('facts', v_facts, 'ledger_rows', v_ledger));

  return jsonb_build_object('upload_id', p_upload_id, 'facts', v_facts, 'ledger_rows', v_ledger);
end;
$$;

-- Staged uploads nobody published or discarded (a closed tab, a lost connection) keep
-- their staged rows. Discards every one older than the threshold exactly as
-- discard_upload does (each is audited there) and returns how many. Uploads being
-- published right now are locked and skipped. The threshold is at least an hour so an
-- upload that is still being staged or reviewed is never thrown away.
create or replace function public.discard_stale_uploads(p_older_than_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  perform private.assert_app_user();
  if p_older_than_hours is null or p_older_than_hours < 1 then
    raise exception 'Gränsen måste vara minst en timme' using errcode = 'invalid_parameter_value';
  end if;

  for v_id in
    select u.id
    from public.uploads u
    where u.status = 'staged'
      and u.created_at < now() - make_interval(hours => p_older_than_hours)
    order by u.created_at, u.id
    for update skip locked
  loop
    perform public.discard_upload(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Per metric x company x month of a staged upload: the staged total, the current
-- published total for the same slice, the previous month (inside this upload when it
-- covers that month, else current data) and the relative deviations.
create or replace function public.review_compare(p_upload_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_dataset public.datasets%rowtype;
  v_threshold numeric;
  v_rows jsonb;
begin
  perform private.assert_app_user();

  select u.* into v_upload from public.uploads u where u.id = p_upload_id;
  if not found then
    raise exception 'Uppladdningen finns inte' using errcode = 'no_data_found';
  end if;
  select d.* into v_dataset from public.datasets d where d.id = v_upload.dataset_id;
  select (s.value #>> '{}')::numeric into v_threshold
  from public.settings s where s.key = 'deviation_threshold_pct';
  v_threshold := coalesce(v_threshold, 25);

  with base as (
    select
      m.key as metric_key,
      m.id as metric_id,
      c.code as company,
      s.company_id,
      s.scenario,
      s.month,
      s.priority,
      (s.month - interval '1 month')::date as prev_month,
      exists (
        select 1 from public.upload_slices ps
        where ps.upload_id = s.upload_id and ps.company_id = s.company_id
          and ps.scenario = s.scenario and ps.month = (s.month - interval '1 month')::date
      ) as covers_prev,
      (
        select cs.priority from public.upload_slices cs
        where cs.dataset_id = s.dataset_id and cs.company_id = s.company_id
          and cs.scenario = s.scenario and cs.month = s.month and cs.is_current
          and cs.upload_id <> s.upload_id
      ) as current_priority
    from public.upload_slices s
    join public.companies c on c.id = s.company_id
    join public.metrics m
      on m.dataset_id = s.dataset_id
      and m.kind = any (
        case when v_dataset.kind = 'ledger' then array['ledger'] else array['sum', 'snapshot'] end
      )
    where s.upload_id = p_upload_id
  ),
  vals as (
    select
      b.*,
      private.month_total(b.metric_id, b.company_id, b.scenario, b.month, p_upload_id) as staged_total,
      private.month_total(b.metric_id, b.company_id, b.scenario, b.month, null) as current_total,
      private.month_total(b.metric_id, b.company_id, b.scenario, b.prev_month,
        case when b.covers_prev then p_upload_id end) as previous_total
    from base b
  ),
  pct as (
    select
      v.*,
      case when v.current_total is null or v.current_total = 0 then null
        else round((v.staged_total - v.current_total) / abs(v.current_total) * 100, 1)
      end as change_pct,
      case when v.previous_total is null or v.previous_total = 0 then null
        else round((v.staged_total - v.previous_total) / abs(v.previous_total) * 100, 1)
      end as deviation_pct
    from vals v
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'metric_key', p.metric_key,
      'company', p.company,
      'month', to_char(p.month, 'YYYY-MM'),
      'staged', p.staged_total,
      'current', p.current_total,
      'previous', p.previous_total,
      'change_pct', p.change_pct,
      'deviation_pct', p.deviation_pct,
      'flagged', coalesce(abs(p.deviation_pct) >= v_threshold, false),
      'replaces_current', p.current_priority is null or p.priority >= p.current_priority
    ) order by p.metric_key, p.company, p.month), '[]'::jsonb)
  into v_rows
  from pct p;

  return jsonb_build_object(
    'upload_id', p_upload_id,
    'dataset', v_dataset.key,
    'scenario', v_upload.scenario,
    'threshold_pct', v_threshold,
    'rows', v_rows
  );
end;
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.month_total(smallint, smallint, text, date, uuid) to authenticated;

revoke execute on function public.publish_upload(uuid) from public, anon;
revoke execute on function public.retract_upload(uuid, text) from public, anon;
revoke execute on function public.discard_upload(uuid) from public, anon;
revoke execute on function public.discard_stale_uploads(integer) from public, anon;
revoke execute on function public.review_compare(uuid) from public, anon;
grant execute on function public.publish_upload(uuid) to authenticated;
grant execute on function public.retract_upload(uuid, text) to authenticated;
grant execute on function public.discard_upload(uuid) to authenticated;
grant execute on function public.discard_stale_uploads(integer) to authenticated;
grant execute on function public.review_compare(uuid) to authenticated;

-- ===================================================================
-- 0006_query_rpcs
-- ===================================================================

-- Read RPCs behind MetricDataSource (src/lib/db/repo/metrics.ts). All SECURITY
-- INVOKER (RLS applies) and they read current data only. Grouping keys are built with
-- jsonb_object_agg over the requested dimension keys (no dynamic SQL); "bolag" is the
-- company code. A fact lacking a grouped dimension gets null for it.
--
-- p_filters is a DimFilter[]: [{"dimension": "verksamhet", "valueIds": [3, 4]}].
-- A fact passes when, for every filter, its dims value is one of the valueIds.
-- p_company_codes null = all companies. Results have a total order so clients can page
-- with limit/offset (PostgREST caps responses at max_rows).

create or replace function public.metric_monthly(
  p_metric_keys text[],
  p_company_codes text[],
  p_scenario text,
  p_from date,
  p_to date,
  p_group_by text[] default '{}',
  p_filters jsonb default '[]'
)
returns table (metric_key text, month date, grp jsonb, value numeric)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_app_user();
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) <> 'array' then
    raise exception 'p_filters måste vara en lista' using errcode = 'invalid_parameter_value';
  end if;

  return query
  select m.key, mv.month, gk.grp, sum(mv.value)
  from public.metric_values mv
  join public.metrics m on m.id = mv.metric_id
  join public.companies c on c.id = mv.company_id
  join public.upload_slices s
    on s.upload_id = mv.upload_id and s.company_id = mv.company_id
    and s.month = mv.month and s.is_current
  cross join lateral (
    select coalesce(jsonb_object_agg(g.k,
      case when g.k = 'bolag' then to_jsonb(c.code) else coalesce(mv.dims -> g.k, 'null'::jsonb) end
    ), '{}'::jsonb) as grp
    from unnest(coalesce(p_group_by, '{}'::text[])) as g(k)
  ) gk
  where m.key = any (p_metric_keys)
    and s.scenario = coalesce(p_scenario, 'utfall')
    and mv.month between p_from and p_to
    and (p_company_codes is null or c.code = any (p_company_codes))
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) f
      where not coalesce((f -> 'valueIds') @> (mv.dims -> (f ->> 'dimension')), false)
    )
  group by m.key, mv.month, gk.grp
  order by 1, 2, 3;
end;
$$;

-- Distinct count of dims ->> p_dimension among current facts of the base metric with
-- value > 0, over the whole window (p_per_month false, month null) or per month.
create or replace function public.metric_distinct(
  p_base_metric_key text,
  p_dimension text,
  p_company_codes text[],
  p_scenario text,
  p_from date,
  p_to date,
  p_group_by text[] default '{}',
  p_filters jsonb default '[]',
  p_per_month boolean default false
)
returns table (month date, grp jsonb, cnt bigint)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_app_user();
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) <> 'array' then
    raise exception 'p_filters måste vara en lista' using errcode = 'invalid_parameter_value';
  end if;

  return query
  select
    case when p_per_month then mv.month end,
    gk.grp,
    count(distinct mv.dims ->> p_dimension)
  from public.metric_values mv
  join public.metrics m on m.id = mv.metric_id
  join public.companies c on c.id = mv.company_id
  join public.upload_slices s
    on s.upload_id = mv.upload_id and s.company_id = mv.company_id
    and s.month = mv.month and s.is_current
  cross join lateral (
    select coalesce(jsonb_object_agg(g.k,
      case when g.k = 'bolag' then to_jsonb(c.code) else coalesce(mv.dims -> g.k, 'null'::jsonb) end
    ), '{}'::jsonb) as grp
    from unnest(coalesce(p_group_by, '{}'::text[])) as g(k)
  ) gk
  where m.key = p_base_metric_key
    and s.scenario = coalesce(p_scenario, 'utfall')
    and mv.month between p_from and p_to
    and mv.value > 0
    and mv.dims ? p_dimension
    and (p_company_codes is null or c.code = any (p_company_codes))
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) f
      where not coalesce((f -> 'valueIds') @> (mv.dims -> (f ->> 'dimension')), false)
    )
  group by 1, 2
  order by 1 nulls first, 2;
end;
$$;

-- Monthly ledger sums per account group (amount x sign over the group's ranges).
-- Without kostnadsstalle grouping only account totals (dim_no is null) are used. With
-- it, object rows of SIE dimension 1 are grouped by their value id and the remainder
-- total - sum(objects) is returned as {"kostnadsstalle": null} ("ofördelat") when it is
-- not zero, so the rows of a month always add up to the total. Utfall only: ledger
-- budget comes from metric_monthly(['budget_belopp']) by kontogrupp.
create or replace function public.ledger_monthly(
  p_group_keys text[],
  p_company_codes text[],
  p_from date,
  p_to date,
  p_group_by text[] default '{}'
)
returns table (group_key text, month date, grp jsonb, value numeric)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_by_object boolean := 'kostnadsstalle' = any (coalesce(p_group_by, '{}'::text[]));
begin
  perform private.assert_app_user();

  return query
  with cur as (
    select c.code as company_code, lb.month, lb.account, lb.dim_no, lb.object_value_id, lb.amount
    from public.ledger_balances lb
    join public.companies c on c.id = lb.company_id
    join public.upload_slices s
      on s.upload_id = lb.upload_id and s.company_id = lb.company_id
      and s.month = lb.month and s.is_current and s.scenario = 'utfall'
    where lb.month between p_from and p_to
      and (p_company_codes is null or c.code = any (p_company_codes))
      and (lb.dim_no is null or (v_by_object and lb.dim_no = 1))
  ),
  by_group as (
    select
      ag.key as group_key,
      cur.company_code,
      cur.month,
      cur.dim_no is null as is_total,
      cur.object_value_id,
      sum(cur.amount * ag.sign) as amount
    from cur
    join public.account_groups ag on ag.key = any (p_group_keys)
    where exists (
      select 1 from public.account_group_ranges r
      where r.group_key = ag.key and cur.account between r.from_account and r.to_account
    )
    group by 1, 2, 3, 4, 5
  ),
  parts as (
    -- Totals, or object rows when grouping by kostnadsställe.
    select b.group_key, b.company_code, b.month, b.object_value_id, b.amount
    from by_group b
    where b.is_total <> v_by_object
    union all
    -- "Ofördelat": total minus the sum of the objects.
    select t.group_key, t.company_code, t.month, null::bigint,
      coalesce(t.total, 0) - coalesce(t.objects, 0)
    from (
      select b.group_key, b.company_code, b.month,
        sum(b.amount) filter (where b.is_total) as total,
        sum(b.amount) filter (where not b.is_total) as objects
      from by_group b
      group by 1, 2, 3
    ) t
    where v_by_object and coalesce(t.total, 0) - coalesce(t.objects, 0) <> 0
  )
  select p.group_key, p.month, gk.grp, sum(p.amount)
  from parts p
  cross join lateral (
    select coalesce(jsonb_object_agg(g.k, case
      when g.k = 'bolag' then to_jsonb(p.company_code)
      when g.k = 'kostnadsstalle' then coalesce(to_jsonb(p.object_value_id), 'null'::jsonb)
      else 'null'::jsonb
    end), '{}'::jsonb) as grp
    from unnest(coalesce(p_group_by, '{}'::text[])) as g(k)
  ) gk
  group by 1, 2, 3
  order by 1, 2, 3;
end;
$$;

-- Months with current data per metric: months where the metric's dataset has a current
-- slice for any of the companies (a covered month without rows is a real 0). Formula
-- metrics have no coverage of their own.
create or replace function public.metric_coverage(
  p_metric_keys text[],
  p_company_codes text[],
  p_scenario text,
  p_from date,
  p_to date
)
returns table (metric_key text, month date)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_app_user();

  return query
  select m.key, s.month
  from public.metrics m
  join public.upload_slices s on s.dataset_id = m.dataset_id and s.is_current
  join public.companies c on c.id = s.company_id
  where m.key = any (p_metric_keys)
    and m.kind <> 'formula'
    and s.scenario = coalesce(p_scenario, 'utfall')
    and s.month between p_from and p_to
    and (p_company_codes is null or c.code = any (p_company_codes))
  group by 1, 2
  order by 1, 2;
end;
$$;

-- Published uploads behind the current data of the metrics' datasets in the window
-- (all scenarios), newest first, with the months they currently supply.
create or replace function public.metric_sources(
  p_metric_keys text[],
  p_company_codes text[],
  p_from date,
  p_to date
)
returns table (
  upload_id uuid,
  file_name text,
  dataset_key text,
  template_name text,
  template_version integer,
  published_at timestamptz,
  months date[]
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_app_user();

  -- The version of a deleted template (kept on the upload as history) is left out: it names
  -- nothing the reader could look up.
  return query
  select u.id, u.file_name, d.key, t.name,
    case when t.id is null then null else u.template_version end,
    u.published_at, array_agg(distinct s.month order by s.month)
  from public.upload_slices s
  join public.uploads u on u.id = s.upload_id
  join public.datasets d on d.id = s.dataset_id
  join public.companies c on c.id = s.company_id
  left join public.import_templates t on t.id = u.template_id
  where s.is_current
    and s.month between p_from and p_to
    and (p_company_codes is null or c.code = any (p_company_codes))
    and s.dataset_id in (
      select m.dataset_id from public.metrics m
      where m.key = any (p_metric_keys) and m.dataset_id is not null
    )
  group by u.id, u.file_name, d.key, t.id, t.name, u.template_version, u.published_at
  order by u.published_at desc, u.id;
end;
$$;

revoke execute on function public.metric_monthly(text[], text[], text, date, date, text[], jsonb)
  from public, anon;
revoke execute on function public.metric_distinct(text, text, text[], text, date, date, text[], jsonb, boolean)
  from public, anon;
revoke execute on function public.ledger_monthly(text[], text[], date, date, text[])
  from public, anon;
revoke execute on function public.metric_coverage(text[], text[], text, date, date)
  from public, anon;
revoke execute on function public.metric_sources(text[], text[], date, date)
  from public, anon;
grant execute on function public.metric_monthly(text[], text[], text, date, date, text[], jsonb)
  to authenticated;
grant execute on function public.metric_distinct(text, text, text[], text, date, date, text[], jsonb, boolean)
  to authenticated;
grant execute on function public.ledger_monthly(text[], text[], date, date, text[])
  to authenticated;
grant execute on function public.metric_coverage(text[], text[], text, date, date)
  to authenticated;
grant execute on function public.metric_sources(text[], text[], date, date)
  to authenticated;

-- ===================================================================
-- 0007_dimension_report_rpcs
-- ===================================================================

-- Dimension value resolution/merging and freezing board reports.

-- Display form of a label: NFC, whitespace collapsed and trimmed, case kept. Mirrors
-- cleanLabel() in src/lib/db/repo/shared.ts. The character classes are built with chr() so
-- the SQL contains no backslashes or invisible characters (it is sent to Supabase as text).
create or replace function private.clean_label(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        normalize(p_text, NFC),
        '[' || chr(8203) || '-' || chr(8205) || chr(8288) || ']',
        '',
        'g'
      ),
      '[' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || ' ' || chr(160) || chr(5760)
        || chr(8192) || '-' || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287)
        || chr(12288) || chr(65279) || ']+',
      ' ',
      'g'
    ),
    ' '
  )
$$;

-- Serves the normalized-label fallback in ensure_dimension_values.
create index dimension_values_norm_label_idx
  on public.dimension_values (dimension_id, private.normalize_label(label)) where active;

-- Resolve labels to dimension_values ids: alias first, then code, then an active
-- value with the same normalized label. Unknown labels are created for auto_create
-- dimensions (or any dimension when p_force); otherwise their id is null so the
-- caller can ask the user. A kostnadsställe is only created from a company-scoped
-- label ("MBAB:100"): an unscoped one would never match the company's SIE objects.
-- Returns one row per distinct input label, as given.
create or replace function public.ensure_dimension_values(
  p_dimension text,
  p_labels text[],
  p_force boolean default false
)
returns table (label text, id bigint)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_dim public.dimensions%rowtype;
  v_create boolean;
  v_label text;
  v_norm text;
  v_code text;
  v_id bigint;
begin
  perform private.assert_app_user();
  select d.* into v_dim from public.dimensions d where d.key = p_dimension;
  if not found then
    raise exception 'Okänd dimension: %', p_dimension using errcode = 'invalid_parameter_value';
  end if;
  v_create := v_dim.unknown_policy = 'auto_create' or coalesce(p_force, false);

  -- Input order, so the first spelling of a new value becomes its label.
  for v_label in
    select u.l
    from unnest(coalesce(p_labels, '{}'::text[])) with ordinality as u(l, o)
    where u.l is not null
    group by u.l
    order by min(u.o)
  loop
    v_norm := private.normalize_label(v_label);
    v_id := null;
    if v_norm <> '' then
      v_code := private.dimension_code(v_dim.key, v_label);

      select a.value_id into v_id
      from public.dimension_aliases a
      where a.dimension_id = v_dim.id and a.alias_norm = v_norm;

      if v_id is null then
        select dv.id into v_id
        from public.dimension_values dv
        where dv.dimension_id = v_dim.id and dv.code = v_code;
      end if;

      if v_id is null then
        select dv.id into v_id
        from public.dimension_values dv
        where dv.dimension_id = v_dim.id and dv.active
          and private.normalize_label(dv.label) = v_norm
        order by dv.id
        limit 1;
      end if;

      if v_id is null and v_create and (
        v_dim.key <> 'kostnadsstalle'
        or (
          substr(v_code, strpos(v_code, ':') + 1) <> ''
          and exists (
            select 1 from public.companies c
            where left(v_code, length(c.code) + 1) = c.code || ':'
          )
        )
      ) then
        insert into public.dimension_values (dimension_id, code, label)
        values (v_dim.id, v_code, private.clean_label(v_label))
        on conflict (dimension_id, code) do nothing
        returning dimension_values.id into v_id;
        if v_id is null then
          select dv.id into v_id
          from public.dimension_values dv
          where dv.dimension_id = v_dim.id and dv.code = v_code;
        end if;
      end if;
    end if;

    label := v_label;
    id := v_id;
    return next;
  end loop;
end;
$$;

-- Replace p_from by p_into in the valueIds of every filter on p_dimension in a
-- SlideSpec/WidgetSpec array (saved dashboards and report templates keep working).
create or replace function private.rewrite_spec_filters(
  p_specs jsonb,
  p_dimension text,
  p_from bigint,
  p_into bigint
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_specs) <> 'array' then p_specs else (
    select coalesce(jsonb_agg(
      case when jsonb_typeof(sl.s -> 'filters') = 'array' then jsonb_set(sl.s, '{filters}', (
        select coalesce(jsonb_agg(
          case when fl.f ->> 'dimension' = p_dimension and jsonb_typeof(fl.f -> 'valueIds') = 'array'
            then jsonb_set(fl.f, '{valueIds}', (
              select coalesce(jsonb_agg(distinct
                case when x.v = to_jsonb(p_from) then to_jsonb(p_into) else x.v end), '[]'::jsonb)
              from jsonb_array_elements(fl.f -> 'valueIds') as x(v)
            ))
            else fl.f
          end order by fl.o), '[]'::jsonb)
        from jsonb_array_elements(sl.s -> 'filters') with ordinality as fl(f, o)
      )) else sl.s end
      order by sl.o), '[]'::jsonb)
    from jsonb_array_elements(p_specs) with ordinality as sl(s, o)
  ) end
$$;

-- Merge one dimension value into another: facts, ledger objects, aliases and saved
-- filters move to p_into, p_from's code and label become aliases of p_into and p_from
-- is deactivated. Frozen reports are untouched (they hold resolved labels).
create or replace function public.merge_dimension_values(p_from bigint, p_into bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.dimension_values%rowtype;
  v_into public.dimension_values%rowtype;
  v_key text;
  v_facts bigint;
  v_ledger bigint;
begin
  perform private.assert_app_user();
  if p_from = p_into then
    raise exception 'Ett värde kan inte slås ihop med sig självt' using errcode = 'invalid_parameter_value';
  end if;
  select dv.* into v_from from public.dimension_values dv where dv.id = p_from for update;
  if not found then
    raise exception 'Värdet finns inte' using errcode = 'no_data_found';
  end if;
  select dv.* into v_into from public.dimension_values dv where dv.id = p_into for update;
  if not found then
    raise exception 'Värdet finns inte' using errcode = 'no_data_found';
  end if;
  if v_from.dimension_id <> v_into.dimension_id then
    raise exception 'Värdena hör till olika dimensioner' using errcode = 'invalid_parameter_value';
  end if;
  -- An inactive target was itself merged away: its facts live on another value, so
  -- merging into it would split the data again.
  if not v_into.active then
    raise exception 'Det går inte att slå ihop till ett inaktivt värde'
      using errcode = 'invalid_parameter_value';
  end if;
  select d.key into v_key from public.dimensions d where d.id = v_from.dimension_id;
  -- Kostnadsställen are scoped per company ("MBAB:100"); publish_upload relies on it.
  if v_key = 'kostnadsstalle'
    and split_part(v_from.code, ':', 1) <> split_part(v_into.code, ':', 1) then
    raise exception 'Kostnadsställen i olika bolag kan inte slås ihop'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.metric_values mv
  set dims = jsonb_set(mv.dims, array[v_key], to_jsonb(p_into))
  where mv.dims @> jsonb_build_object(v_key, p_from);
  get diagnostics v_facts = row_count;

  update public.ledger_balances lb set object_value_id = p_into where lb.object_value_id = p_from;
  get diagnostics v_ledger = row_count;

  update public.dimension_aliases a set value_id = p_into where a.value_id = p_from;
  insert into public.dimension_aliases (dimension_id, alias_norm, value_id)
  select distinct v_from.dimension_id, private.normalize_label(x), p_into
  from unnest(array[v_from.code, v_from.label]) as x
  on conflict (dimension_id, alias_norm) do update set value_id = excluded.value_id;

  update public.report_templates rt
  set slides = private.rewrite_spec_filters(rt.slides, v_key, p_from, p_into)
  where rt.slides is distinct from private.rewrite_spec_filters(rt.slides, v_key, p_from, p_into);
  update public.dashboards db
  set spec = jsonb_set(db.spec, '{widgets}',
    private.rewrite_spec_filters(db.spec -> 'widgets', v_key, p_from, p_into))
  where jsonb_typeof(db.spec -> 'widgets') = 'array'
    and db.spec -> 'widgets' is distinct from
      private.rewrite_spec_filters(db.spec -> 'widgets', v_key, p_from, p_into);

  update public.dimension_values dv set active = false where dv.id = p_from;

  insert into public.audit_log (action, entity, entity_id, detail)
  values ('merge', 'dimension_value', p_from::text, jsonb_build_object(
    'dimension', v_key, 'into', p_into, 'facts', v_facts, 'ledger_rows', v_ledger));

  return jsonb_build_object('from', p_from, 'into', p_into, 'facts', v_facts, 'ledger_rows', v_ledger);
end;
$$;

-- Freeze a resolved report. p_snapshot is a ResolvedReport plus "specs" (SlideSpec[]);
-- the insert trigger rejects specs that group or filter by a personal dimension.
create or replace function public.freeze_report(
  p_title text,
  p_template_id uuid,
  p_anchor date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_app_user();
  insert into public.board_reports (template_id, title, anchor_month, snapshot, schema_version)
  values (
    p_template_id,
    btrim(p_title),
    date_trunc('month', p_anchor)::date,
    p_snapshot,
    case when (p_snapshot ->> 'schemaVersion') ~ '^[0-9]{1,6}$'
      then (p_snapshot ->> 'schemaVersion')::integer else 1 end
  )
  returning id into v_id;

  insert into public.audit_log (action, entity, entity_id, detail)
  values ('freeze', 'board_report', v_id::text,
    jsonb_build_object('title', btrim(p_title), 'anchor_month', to_char(p_anchor, 'YYYY-MM')));

  return v_id;
end;
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.clean_label(text) to authenticated;

revoke execute on function public.ensure_dimension_values(text, text[], boolean) from public, anon;
revoke execute on function public.merge_dimension_values(bigint, bigint) from public, anon;
revoke execute on function public.freeze_report(text, uuid, date, jsonb) from public, anon;
grant execute on function public.ensure_dimension_values(text, text[], boolean) to authenticated;
grant execute on function public.merge_dimension_values(bigint, bigint) to authenticated;
grant execute on function public.freeze_report(text, uuid, date, jsonb) to authenticated;

-- ===================================================================
-- 0008_login_throttle
-- ===================================================================

-- Login throttle. login_gate/login_record live in public so PostgREST can reach them,
-- but only service_role may execute them (src/lib/db/admin.ts).
--
-- The gate is atomic: under a per-ip_hash advisory lock it decides and, when it lets an
-- attempt through, inserts that attempt as pending (ok null). A pending attempt counts
-- as a failure until login_record(attempt_id, ok) finalizes it, so a burst of parallel
-- requests cannot all pass the gate before the first of them is recorded: the sixth
-- gate of a burst already sees five failures. An attempt that is never finalized (the
-- server died, Auth was unreachable) stays a failure, which fails closed.
--
-- Rules:
-- * per ip_hash: 5 failures within 15 minutes lock that hash for 15 minutes, doubling
--   with every further lockout in the last 24 hours (cap 24 hours); a successful login
--   resets the history;
-- * more than 50 failures in the last hour across all hashes add delay_ms (up to
--   3000) for everyone, never a hard global lock;
-- * attempts older than 24 hours are deleted opportunistically.
-- ip_hash must look like a hash (no dots or colons), so a raw IP is never stored.

grant select, insert, update, delete on private.login_attempts to service_role;

-- Lock state of one ip_hash at p_now. Failed and pending attempts after the last success
-- (within 24 hours) are replayed in order; attempts made while locked do not count.
create or replace function private.login_lock_state(p_ip_hash text, p_now timestamptz)
returns table (locked_until timestamptz, lockouts integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_since timestamptz := p_now - interval '24 hours';
  v_last_ok timestamptz;
  v_until timestamptz;
  v_count integer := 0;
  v_window timestamptz[] := '{}';
  v_at timestamptz;
begin
  select max(a.at) into v_last_ok
  from private.login_attempts a
  where a.ip_hash = p_ip_hash and a.ok and a.at > v_since and a.at <= p_now;

  for v_at in
    select a.at
    from private.login_attempts a
    where a.ip_hash = p_ip_hash
      and a.ok is not true
      and a.at > coalesce(greatest(v_since, v_last_ok), v_since)
      and a.at <= p_now
    order by a.at
  loop
    if v_until is not null and v_at < v_until then
      continue;
    end if;
    v_window := array(select w from unnest(v_window) as w where w > v_at - interval '15 minutes')
      || v_at;
    if cardinality(v_window) >= 5 then
      v_count := v_count + 1;
      v_until := v_at + least(interval '15 minutes' * power(2, v_count - 1), interval '24 hours');
      v_window := '{}';
    end if;
  end loop;

  locked_until := v_until;
  lockouts := v_count;
  return next;
end;
$$;

-- Decide on one login attempt and, when allowed, register it as pending.
-- Returns {allowed, retry_after_s, delay_ms, attempt_id}; attempt_id is null when the
-- attempt is refused (nothing is registered for a refused attempt).
create or replace function public.login_gate(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_until timestamptz;
  v_failures bigint;
  v_delay integer := 0;
  v_attempt uuid;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[A-Za-z0-9+/=_-]{16,128}$' then
    raise exception 'Ogiltig ip-hash' using errcode = 'invalid_parameter_value';
  end if;

  -- One gate per ip_hash at a time; the lock is held until this transaction commits, so
  -- the next gate for the hash sees the pending attempt inserted here.
  perform pg_advisory_xact_lock(hashtext('login:' || p_ip_hash));
  -- Taken after the lock: now() is the transaction start, which can predate an attempt
  -- committed by a gate that held the lock while this one waited.
  v_now := clock_timestamp();

  select st.locked_until into v_until from private.login_lock_state(p_ip_hash, v_now) st;

  select count(*) into v_failures
  from private.login_attempts a
  where a.ok is not true and a.at > v_now - interval '1 hour';
  if v_failures > 50 then
    v_delay := least(3000, 1000 + (v_failures - 51) * 50)::integer;
  end if;

  delete from private.login_attempts a where a.at < v_now - interval '24 hours';

  if v_until is not null and v_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_s', ceil(extract(epoch from v_until - v_now))::integer,
      'delay_ms', v_delay,
      'attempt_id', null
    );
  end if;

  insert into private.login_attempts (ip_hash, at, ok)
  values (p_ip_hash, v_now, null)
  returning id into v_attempt;
  return jsonb_build_object(
    'allowed', true,
    'retry_after_s', 0,
    'delay_ms', v_delay,
    'attempt_id', v_attempt
  );
end;
$$;

-- Finalize a pending attempt with the answer from Auth (true = signed in).
create or replace function public.login_record(p_attempt_id uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attempt_id is null then
    raise exception 'Inloggningsförsök saknas' using errcode = 'invalid_parameter_value';
  end if;
  if p_ok is null then
    raise exception 'Utfall saknas' using errcode = 'invalid_parameter_value';
  end if;
  update private.login_attempts a set ok = p_ok where a.id = p_attempt_id and a.ok is null;
  if not found then
    raise exception 'Inloggningsförsöket finns inte eller är redan avslutat'
      using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.login_gate(text) from public, anon, authenticated;
revoke execute on function public.login_record(uuid, boolean) from public, anon, authenticated;
grant execute on function public.login_gate(text) to service_role;
grant execute on function public.login_record(uuid, boolean) to service_role;

-- ===================================================================
-- 0009_seed
-- ===================================================================

-- Day-one data. Mirrors src/lib/contracts/catalog.ts exactly (supabase/tests/seed.test.ts
-- compares every field) plus companies, verksamhet/kontogrupp values and settings.

insert into public.companies (id, code, legal_name, short_name, org_nr, fiscal_start_month) values
  (1, 'MBAB', 'Miljonbemanning AB', 'MB AB', '556959-9318', 1),
  (2, 'MBR', 'Miljonbemanning Restart AB', 'MB Restart', '559208-9071', 1);

insert into public.dimensions (key, label, is_personal, unknown_policy) values
  ('verksamhet', 'Verksamhet', false, 'ask'),
  ('kund', 'Kund', false, 'ask'),
  ('uppdrag', 'Uppdrag', false, 'auto_create'),
  ('kostnadsstalle', 'Kostnadsställe', false, 'auto_create'),
  ('ort', 'Ort', false, 'auto_create'),
  ('konsult', 'Konsult', true, 'auto_create'),
  ('franvarotyp', 'Frånvarotyp', false, 'auto_create'),
  ('resultattyp', 'Resultat', false, 'auto_create'),
  ('ordertyp', 'Ordertyp', false, 'auto_create'),
  ('kontogrupp', 'Kontogrupp', false, 'ask');

insert into public.datasets (key, name, kind) values
  ('ip_timmar', 'Intelliplan – timmar och pass', 'table'),
  ('ip_franvaro', 'Intelliplan – frånvaro', 'table'),
  ('ip_fakturering', 'Intelliplan – fakturerat och lön', 'table'),
  ('ip_konsulter', 'Intelliplan – konsultlista', 'cases'),
  ('wb_deltagare', 'Workbuster – deltagare', 'cases'),
  ('wb_ordrar', 'Workbuster – ordrar', 'table'),
  ('fx_bokforing', 'Fortnox – bokföring (SIE4)', 'ledger'),
  ('fx_kundforsaljning', 'Fortnox – försäljning per kund', 'table'),
  ('budget', 'Budget', 'table');

insert into public.dataset_dimensions (dataset_id, dimension_id)
select ds.id, dim.id
from (values
  ('ip_timmar', 'kund'),
  ('ip_timmar', 'uppdrag'),
  ('ip_timmar', 'konsult'),
  ('ip_timmar', 'verksamhet'),
  ('ip_franvaro', 'kund'),
  ('ip_franvaro', 'uppdrag'),
  ('ip_franvaro', 'konsult'),
  ('ip_franvaro', 'franvarotyp'),
  ('ip_fakturering', 'kund'),
  ('ip_fakturering', 'uppdrag'),
  ('ip_fakturering', 'konsult'),
  ('ip_konsulter', 'ort'),
  ('wb_deltagare', 'verksamhet'),
  ('wb_deltagare', 'ort'),
  ('wb_deltagare', 'resultattyp'),
  ('wb_ordrar', 'verksamhet'),
  ('wb_ordrar', 'ordertyp'),
  ('wb_ordrar', 'ort'),
  ('fx_bokforing', 'kostnadsstalle'),
  ('fx_kundforsaljning', 'kund'),
  ('budget', 'kontogrupp'),
  ('budget', 'kostnadsstalle')
) as v (dataset_key, dimension_key)
join public.datasets ds on ds.key = v.dataset_key
join public.dimensions dim on dim.key = v.dimension_key;

insert into public.account_groups (key, name, sign, sort) values
  ('intakter', 'Intäkter', -1, 1),
  ('varor_ul', 'Varor och underleverantörer', 1, 2),
  ('ovriga_externa', 'Övriga externa kostnader', 1, 3),
  ('personal', 'Personalkostnader', 1, 4),
  ('avskrivningar', 'Avskrivningar', 1, 5),
  ('ovriga_rorelse', 'Övriga rörelsekostnader', 1, 6),
  ('kostnader', 'Rörelsens kostnader', 1, 7),
  ('finansiella', 'Finansiella poster', -1, 8),
  ('bokslut_skatt', 'Bokslutsdispositioner och skatt', -1, 9),
  ('resultat', 'Resultat', -1, 10);

insert into public.account_group_ranges (group_key, from_account, to_account) values
  ('intakter', 3000, 3999),
  ('varor_ul', 4000, 4999),
  ('ovriga_externa', 5000, 6999),
  ('personal', 7000, 7699),
  ('avskrivningar', 7700, 7899),
  ('ovriga_rorelse', 7900, 7999),
  ('kostnader', 4000, 7999),
  ('finansiella', 8000, 8799),
  ('bokslut_skatt', 8800, 8999),
  ('resultat', 3000, 8999);

-- One statement per metric, in catalog order, so distinct metrics can look up their
-- base metric.
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'timmar', 'Fakturerade timmar', 'h', 'sum',
  (select id from public.datasets where key = 'ip_timmar'),
  true, 0,
  'Attesterade och exporterade timmar.',
  'TIMMARNA', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'pass', 'Pass', 'st', 'sum',
  (select id from public.datasets where key = 'ip_timmar'),
  true, 0,
  'Antal arbetade pass.',
  'PASSEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'konsulter', 'Konsulter i arbete', 'st', 'distinct',
  (select id from public.datasets where key = 'ip_timmar'),
  true, 0,
  'Unika konsulter (räknas på anställnings-id) med timmar i perioden.',
  'KONSULTERNA', null,
  (select id from public.metrics where key = 'timmar'),
  (select id from public.dimensions where key = 'konsult'),
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjuktimmar', 'Sjuktimmar', 'h', 'sum',
  (select id from public.datasets where key = 'ip_franvaro'),
  false, 0,
  'Timmar med sjukfrånvaro.',
  'SJUKTIMMARNA', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjukpass', 'Sjukpass', 'st', 'sum',
  (select id from public.datasets where key = 'ip_franvaro'),
  false, 0,
  'Antal pass med sjukfrånvaro.',
  'SJUKPASSEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'fakturerat_ip', 'Fakturerat (Intelliplan)', 'kr', 'sum',
  (select id from public.datasets where key = 'ip_fakturering'),
  true, 0,
  'Fakturerat belopp enligt fakturaunderlaget.',
  'FAKTURERINGEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'lonekostnad', 'Lönekostnad', 'kr', 'sum',
  (select id from public.datasets where key = 'ip_fakturering'),
  false, 0,
  'Lönekostnad enligt löneunderlaget.',
  'LÖNEKOSTNADEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'anstallda_konsulter', 'Anställda konsulter', 'st', 'snapshot',
  (select id from public.datasets where key = 'ip_konsulter'),
  true, 0,
  'Konsulter med aktiv anställning vid månadens slut.',
  'ANTALET ANSTÄLLDA', 'last',
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'nyanstallda', 'Nyanställda konsulter', 'st', 'sum',
  (select id from public.datasets where key = 'ip_konsulter'),
  true, 0,
  'Anställningar som startat under perioden.',
  'NYANSTÄLLNINGARNA', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avslutade_anstallningar', 'Avslutade anställningar', 'st', 'sum',
  (select id from public.datasets where key = 'ip_konsulter'),
  false, 0,
  'Anställningar som avslutats under perioden.',
  'AVSLUTEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'anstallningsmanader', 'Anställningsmånader', 'man', 'snapshot',
  (select id from public.datasets where key = 'ip_konsulter'),
  null, 0,
  'Summa anställningstid i månader för aktiva anställningar vid månadens slut.',
  'ANSTÄLLNINGSMÅNADERNA', 'last',
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'aktiva_deltagare', 'Aktiva deltagare', 'st', 'snapshot',
  (select id from public.datasets where key = 'wb_deltagare'),
  true, 0,
  'Deltagare utan avbrott med pågående placering vid månadens slut.',
  'DELTAGARNA', 'last',
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'nya_deltagare', 'Nya deltagare', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  true, 0,
  'Deltagare som startat under perioden.',
  'NYA DELTAGARE', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avslutade_deltagare', 'Avslutade deltagare', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  null, 0,
  'Deltagare som avslutat under perioden.',
  'AVSLUTEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avbrott_deltagare', 'Avbrott', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  false, 0,
  'Deltagare med avbrott under perioden.',
  'AVBROTTEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultat_deltagare', 'Till arbete eller studier', 'st', 'sum',
  (select id from public.datasets where key = 'wb_deltagare'),
  true, 0,
  'Avslutade deltagare med resultat arbete eller studier.',
  'RESULTATEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'af_intakt', 'AF-ersättning', 'kr', 'sum',
  (select id from public.datasets where key = 'wb_ordrar'),
  true, 0,
  'Ersättning från Arbetsförmedlingen enligt ordrarna.',
  'AF-ERSÄTTNINGEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'intakter', 'Intäkter', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  true, 0,
  'Konto 3000–3999.',
  'INTÄKTERNA', null,
  null,
  null,
  'intakter', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'varor_ul', 'Varor och underleverantörer', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 4000–4999.',
  'UL-KOSTNADERNA', null,
  null,
  null,
  'varor_ul', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'ovriga_externa', 'Övriga externa kostnader', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 5000–6999.',
  'DE EXTERNA KOSTNADERNA', null,
  null,
  null,
  'ovriga_externa', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'personal', 'Personalkostnader', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 7000–7699.',
  'PERSONALKOSTNADERNA', null,
  null,
  null,
  'personal', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'avskrivningar', 'Avskrivningar', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 7700–7899.',
  'AVSKRIVNINGARNA', null,
  null,
  null,
  'avskrivningar', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'ovriga_rorelse', 'Övriga rörelsekostnader', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 7900–7999.',
  'DE ÖVRIGA RÖRELSEKOSTNADERNA', null,
  null,
  null,
  'ovriga_rorelse', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'kostnader', 'Rörelsens kostnader', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  false, 0,
  'Konto 4000–7999.',
  'KOSTNADERNA', null,
  null,
  null,
  'kostnader', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'finansiella', 'Finansiella poster', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  true, 0,
  'Konto 8000–8799, netto.',
  'FINANSNETTOT', null,
  null,
  null,
  'finansiella', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultat', 'Resultat', 'kr', 'ledger',
  (select id from public.datasets where key = 'fx_bokforing'),
  true, 0,
  'Periodens resultat, konto 3000–8999.',
  'RESULTATET', null,
  null,
  null,
  'resultat', null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'fakturerat_kund', 'Fakturerat per kund', 'kr', 'sum',
  (select id from public.datasets where key = 'fx_kundforsaljning'),
  true, 0,
  'Kundfakturor exkl. moms enligt Fortnox.',
  'FAKTURERINGEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'budget_belopp', 'Budget', 'kr', 'sum',
  (select id from public.datasets where key = 'budget'),
  null, 0,
  'Budgeterat belopp per kontogrupp. Används som budget för bokföringsmåtten.',
  'BUDGETEN', null,
  null,
  null,
  null, null, true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'faktor', 'Faktor', 'faktor', 'formula',
  null,
  true, 2,
  'Fakturerat ÷ lönekostnad. Lönepåslaget ändras i formeln.',
  'FAKTORN', null,
  null,
  null,
  null, 'fakturerat_ip / (lonekostnad * 1.0)', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjukfranvaro', 'Sjukfrånvaro', 'pct', 'formula',
  null,
  false, 1,
  'Sjuktimmar ÷ (fakturerade timmar + sjuktimmar).',
  'SJUKFRÅNVARON', null,
  null,
  null,
  null, 'sjuktimmar / (timmar + sjuktimmar) * 100', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'sjukpass_per_konsult', 'Sjukpass per konsult', 'st', 'formula',
  null,
  false, 2,
  'Sjukpass ÷ konsulter i arbete.',
  'SJUKPASSEN PER KONSULT', null,
  null,
  null,
  null, 'sjukpass / konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'timmar_per_konsult', 'Timmar per konsult', 'h', 'formula',
  null,
  true, 1,
  'Fakturerade timmar ÷ konsulter i arbete.',
  'TIMMARNA PER KONSULT', null,
  null,
  null,
  null, 'timmar / konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'intakt_per_konsult', 'Fakturerat per konsult', 'kr', 'formula',
  null,
  true, 0,
  'Fakturerat (Intelliplan) ÷ konsulter i arbete.',
  'FAKTURERINGEN PER KONSULT', null,
  null,
  null,
  null, 'fakturerat_ip / konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultatmarginal', 'Resultatmarginal', 'pct', 'formula',
  null,
  true, 1,
  'Resultat ÷ intäkter.',
  'MARGINALEN', null,
  null,
  null,
  null, 'resultat / intakter * 100', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'anstallningstid', 'Genomsnittlig anställningstid', 'man', 'formula',
  null,
  true, 1,
  'Anställningsmånader ÷ anställda konsulter vid månadens slut.',
  'ANSTÄLLNINGSTIDEN', null,
  null,
  null,
  null, 'anstallningsmanader / anstallda_konsulter', true;
insert into public.metrics (key, name, unit, kind, dataset_id, higher_is_better, decimals,
  description, headline_subject, snapshot_rollup, base_metric_id, distinct_dimension_id,
  account_group_key, formula, is_system)
select 'resultatandel', 'Andel till arbete eller studier', 'pct', 'formula',
  null,
  true, 1,
  'Till arbete eller studier ÷ avslutade deltagare.',
  'ANDELEN TILL ARBETE ELLER STUDIER', null,
  null,
  null,
  null, 'resultat_deltagare / avslutade_deltagare * 100', true;

insert into public.dimension_values (dimension_id, code, label, sort)
select dim.id, v.code, v.label, v.sort
from (values
  ('verksamhet', 'rom2', 'ROM2', 1),
  ('verksamhet', 'krom', 'KROM', 2),
  ('verksamhet', 'kvl', 'KVL', 3),
  ('verksamhet', 'karriärvägledning', 'Karriärvägledning', 4),
  ('verksamhet', 'stöd och matchning', 'Stöd och matchning', 5),
  ('verksamhet', 'bemanning', 'Bemanning', 6),
  ('kontogrupp', 'intakter', 'Intäkter', 1),
  ('kontogrupp', 'varor_ul', 'Varor och underleverantörer', 2),
  ('kontogrupp', 'ovriga_externa', 'Övriga externa kostnader', 3),
  ('kontogrupp', 'personal', 'Personalkostnader', 4),
  ('kontogrupp', 'avskrivningar', 'Avskrivningar', 5),
  ('kontogrupp', 'ovriga_rorelse', 'Övriga rörelsekostnader', 6),
  ('kontogrupp', 'kostnader', 'Rörelsens kostnader', 7),
  ('kontogrupp', 'finansiella', 'Finansiella poster', 8),
  ('kontogrupp', 'bokslut_skatt', 'Bokslutsdispositioner och skatt', 9),
  ('kontogrupp', 'resultat', 'Resultat', 10)
) as v (dimension_key, code, label, sort)
join public.dimensions dim on dim.key = v.dimension_key;

insert into public.settings (key, value) values
  ('deviation_threshold_pct', '25'),
  ('min_engine_version', '1');

-- ===================================================================
-- 0010_keepalive
-- ===================================================================

-- Keep-alive for Supabase's free plan, which pauses projects after seven days without activity.
-- Vercel Cron calls /api/keepalive daily with the publishable key; this function is the only
-- thing anon may execute. It reads no data and returns the server time.

create or replace function public.keepalive()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select now()
$$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- Record the migrations in Supabase's migration history (same as the CLI/connector would).
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261012200000', '0005_upload_rpcs'),
  ('20261012200001', '0006_query_rpcs'),
  ('20261012200002', '0007_dimension_report_rpcs'),
  ('20261012200003', '0008_login_throttle'),
  ('20261012200004', '0009_seed'),
  ('20261012200005', '0010_keepalive')
on conflict (version) do nothing;

commit;
