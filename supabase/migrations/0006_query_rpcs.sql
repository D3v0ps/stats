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

  return query
  select u.id, u.file_name, d.key, t.name, u.template_version, u.published_at,
    array_agg(distinct s.month order by s.month)
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
  group by u.id, u.file_name, d.key, t.name, u.template_version, u.published_at
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
