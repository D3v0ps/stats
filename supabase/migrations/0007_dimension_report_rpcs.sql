-- Dimension value resolution/merging and freezing board reports.

-- Display form of a label: NFC, whitespace collapsed and trimmed, case kept.
create or replace function private.clean_label(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(normalize(p_text, NFC), '[​-‍⁠]', '', 'g'),
      '[\t\n\v\f\r    -     　﻿]+',
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
-- caller can ask the user. Returns one row per distinct input label, as given.
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

      if v_id is null and v_create then
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
  select d.key into v_key from public.dimensions d where d.id = v_from.dimension_id;

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
