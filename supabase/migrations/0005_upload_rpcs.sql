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

  if exists (
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
revoke execute on function public.review_compare(uuid) from public, anon;
grant execute on function public.publish_upload(uuid) to authenticated;
grant execute on function public.retract_upload(uuid, text) to authenticated;
grant execute on function public.discard_upload(uuid) to authenticated;
grant execute on function public.review_compare(uuid) to authenticated;
