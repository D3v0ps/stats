-- Period close, dashboards, report templates, frozen board reports, share links
-- (phase 2), the append-only audit log and the login throttle's attempt log.

create table public.period_status (
  company_id smallint not null references public.companies (id),
  month date not null check (month = date_trunc('month', month)::date),
  closed_at timestamptz not null default now(),
  primary key (company_id, month)
);

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name <> ''),
  is_default boolean not null default false,
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  updated_at timestamptz not null default now()
);
create unique index dashboards_single_default on public.dashboards (is_default) where is_default;
create trigger dashboards_touch
  before update on public.dashboards
  for each row execute function private.touch_updated_at();

create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name <> ''),
  slides jsonb not null default '[]' check (jsonb_typeof(slides) = 'array'),
  updated_at timestamptz not null default now()
);
create trigger report_templates_touch
  before update on public.report_templates
  for each row execute function private.touch_updated_at();

-- template_id is informational (no FK): deleting a template must not touch frozen
-- reports, which can never be updated.
create table public.board_reports (
  id uuid primary key default gen_random_uuid(),
  template_id uuid,
  title text not null check (title <> ''),
  anchor_month date not null check (anchor_month = date_trunc('month', anchor_month)::date),
  -- ResolvedReport JSON plus "specs": the SlideSpec[] it was resolved from.
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  schema_version integer not null default 1,
  frozen_at timestamptz not null default now()
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  board_report_id uuid not null references public.board_reports (id),
  token_hash bytea not null unique,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz
);
create index share_links_report_idx on public.share_links (board_report_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'
);
create index audit_log_at_idx on public.audit_log (at desc);

-- Only service_role (via login_gate/login_record) touches this table.
create table private.login_attempts (
  ip_hash text not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index login_attempts_ip_at_idx on private.login_attempts (ip_hash, at);
create index login_attempts_at_idx on private.login_attempts (at);
revoke all on private.login_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Personal-dimension guard for slide specs
-- ---------------------------------------------------------------------------

-- True when any SlideSpec in the array groups or filters by a personal dimension.
create or replace function private.specs_reference_personal(p_specs jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(p_specs) = 'array' then p_specs else '[]'::jsonb end) s
    join public.dimensions d on d.is_personal
    where s ->> 'groupBy' = d.key
      or exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(s -> 'filters') = 'array' then s -> 'filters' else '[]'::jsonb end
        ) f
        where f ->> 'dimension' = d.key
      )
  )
$$;

create or replace function private.assert_snapshot_nonpersonal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.snapshot -> 'specs') is distinct from 'array' then
    raise exception 'Rapportens ögonblicksbild saknar bildspecifikationer (specs)'
      using errcode = 'check_violation';
  end if;
  if private.specs_reference_personal(new.snapshot -> 'specs') then
    raise exception 'Personliga dimensioner får inte förekomma i en fryst rapport'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger board_reports_nonpersonal
  before insert on public.board_reports
  for each row execute function private.assert_snapshot_nonpersonal();

create or replace function private.assert_slides_nonpersonal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.specs_reference_personal(new.slides) then
    raise exception 'Personliga dimensioner får inte användas i rapportmallar'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger report_templates_nonpersonal
  before insert or update of slides on public.report_templates
  for each row execute function private.assert_slides_nonpersonal();

-- Frozen reports and the audit log are append-only, even for table owners.
create or replace function private.reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% kan inte ändras eller tas bort', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;
create trigger board_reports_immutable
  before update or delete on public.board_reports
  for each row execute function private.reject_change();
create trigger board_reports_no_truncate
  before truncate on public.board_reports
  for each statement execute function private.reject_change();
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.reject_change();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.reject_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.period_status enable row level security;
alter table public.dashboards enable row level security;
alter table public.report_templates enable row level security;
alter table public.board_reports enable row level security;
alter table public.share_links enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.period_status, public.dashboards, public.report_templates,
  public.board_reports, public.share_links, public.audit_log from anon, authenticated;

revoke all on public.board_reports, public.audit_log from service_role;
grant select on public.board_reports, public.audit_log to service_role;

grant select, insert, update, delete on public.period_status, public.dashboards,
  public.report_templates to authenticated;
grant select, insert, update on public.share_links to authenticated;
grant select, insert on public.board_reports, public.audit_log to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'period_status', 'dashboards', 'report_templates', 'share_links', 'board_reports', 'audit_log'
  ] loop
    execute format(
      'create policy "app users select" on public.%I for select to authenticated using ((select private.is_app_user()))',
      v_table);
    execute format(
      'create policy "app users insert" on public.%I for insert to authenticated with check ((select private.is_app_user()))',
      v_table);
  end loop;

  foreach v_table in array array['period_status', 'dashboards', 'report_templates', 'share_links'] loop
    execute format(
      'create policy "app users update" on public.%I for update to authenticated using ((select private.is_app_user())) with check ((select private.is_app_user()))',
      v_table);
  end loop;

  foreach v_table in array array['period_status', 'dashboards', 'report_templates'] loop
    execute format(
      'create policy "app users delete" on public.%I for delete to authenticated using ((select private.is_app_user()))',
      v_table);
  end loop;
end;
$$;

revoke execute on all functions in schema private from public;
