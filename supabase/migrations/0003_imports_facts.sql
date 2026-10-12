-- Import templates, uploads with their month slices, facts and SIE ledger balances.
--
-- "Current" data = rows whose upload has an upload_slices row with is_current for the
-- same company and month (and the upload's scenario). Only publish_upload and
-- retract_upload (SECURITY DEFINER) move is_current or an upload's status; clients can
-- only create staged uploads and stage rows into them.

create table public.import_templates (
  id uuid primary key default gen_random_uuid(),
  dataset_id smallint not null references public.datasets (id),
  name text not null check (name <> ''),
  kind text not null check (kind in ('table', 'cases', 'sie')),
  current_version integer not null default 1 check (current_version >= 1),
  header_signature jsonb not null default '[]' check (jsonb_typeof(header_signature) = 'array'),
  sheet_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_templates_dataset_idx on public.import_templates (dataset_id);
create trigger import_templates_touch
  before update on public.import_templates
  for each row execute function private.touch_updated_at();

-- Versions are immutable: a changed mapping is a new version.
create table public.import_template_versions (
  template_id uuid not null references public.import_templates (id) on delete cascade,
  version integer not null check (version >= 1),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  primary key (template_id, version)
);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  dataset_id smallint not null references public.datasets (id),
  template_id uuid,
  template_version integer,
  scenario text not null check (scenario in ('utfall', 'budget')),
  file_name text not null check (file_name <> ''),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size bigint not null check (file_size >= 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  engine_version integer not null check (engine_version >= 1),
  as_of_date date,
  parse_report jsonb not null default '{}',
  totals jsonb not null default '[]',
  status text not null default 'staged'
    check (status in ('staged', 'published', 'retracted', 'discarded')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  retracted_at timestamptz,
  retract_reason text,
  -- A template version needs its template. A version without a template is the history of
  -- a deleted template (see the foreign key); clients can only stage both or neither.
  check (template_id is null or template_version is not null),
  check ((status = 'staged') = (published_at is null) or status = 'discarded'),
  -- Templates can be deleted while their uploads keep their data: deleting a template
  -- cascades to its versions, which nulls template_id here and keeps template_version.
  foreign key (template_id, template_version)
    references public.import_template_versions (template_id, version)
    on delete set null (template_id),
  -- Target of the composite FK from upload_slices.
  unique (id, dataset_id, scenario)
);
-- File names and parse reports come from the client; neither may carry a personnummer.
create trigger uploads_no_personnummer
  before insert or update of file_name, parse_report on public.uploads
  for each row execute function private.reject_personnummer('file_name', 'parse_report');
create index uploads_dataset_status_idx on public.uploads (dataset_id, status);
create index uploads_template_idx on public.uploads (template_id, template_version);
-- The same file through the same template version (or, for SIE, without a template) can
-- only be published once. Uploads of a deleted template (template_id null, version kept)
-- are left out: no one can publish through that template again, and two versions of it
-- may have published the same file.
create unique index uploads_published_file_uniq on public.uploads (
  dataset_id,
  file_sha256,
  coalesce(template_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(template_version, 0)
) where status = 'published' and (template_id is not null or template_version is null);

create table public.upload_slices (
  upload_id uuid not null,
  dataset_id smallint not null,
  company_id smallint not null references public.companies (id),
  scenario text not null check (scenario in ('utfall', 'budget')),
  month date not null check (month = date_trunc('month', month)::date),
  -- < 0 = lower precedence (previous-year rows inside a SIE file).
  priority smallint not null default 0 check (priority <= 0),
  is_current boolean not null default false,
  primary key (upload_id, company_id, scenario, month),
  foreign key (upload_id, dataset_id, scenario)
    references public.uploads (id, dataset_id, scenario)
);
create unique index upload_slices_current_uniq
  on public.upload_slices (dataset_id, company_id, scenario, month) where is_current;
create index upload_slices_lookup_idx
  on public.upload_slices (dataset_id, company_id, scenario, month, priority);

create table public.metric_values (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads (id),
  metric_id smallint not null references public.metrics (id),
  company_id smallint not null references public.companies (id),
  month date not null check (month = date_trunc('month', month)::date),
  -- dimension key -> dimension_values.id
  dims jsonb not null default '{}' check (jsonb_typeof(dims) = 'object'),
  value numeric not null,
  source_rows integer[]
);
create index metric_values_metric_month_idx on public.metric_values (metric_id, month, company_id);
create index metric_values_upload_idx on public.metric_values (upload_id);
create index metric_values_company_idx on public.metric_values (company_id);
create index metric_values_dims_idx on public.metric_values using gin (dims jsonb_path_ops);

create table public.ledger_balances (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads (id),
  company_id smallint not null references public.companies (id),
  month date not null check (month = date_trunc('month', month)::date),
  account integer not null check (account between 1000 and 9999),
  -- null = account total; otherwise the SIE dimension of the object row.
  dim_no smallint check (dim_no > 0),
  object_value_id bigint references public.dimension_values (id),
  -- Signed as in SIE: revenue negative (credit), costs positive (debit).
  amount numeric not null,
  year_offset smallint not null default 0 check (year_offset <= 0),
  source text not null check (source in ('psaldo', 'trans')),
  check ((dim_no is null) = (object_value_id is null))
);
create index ledger_balances_upload_idx on public.ledger_balances (upload_id);
create index ledger_balances_company_month_idx
  on public.ledger_balances (company_id, month, account);
create index ledger_balances_object_idx on public.ledger_balances (object_value_id);

create table public.ledger_accounts (
  company_id smallint not null references public.companies (id),
  account integer not null check (account between 1000 and 9999),
  name text not null,
  primary key (company_id, account)
);

-- RLS
alter table public.import_templates enable row level security;
alter table public.import_template_versions enable row level security;
alter table public.uploads enable row level security;
alter table public.upload_slices enable row level security;
alter table public.metric_values enable row level security;
alter table public.ledger_balances enable row level security;
alter table public.ledger_accounts enable row level security;

revoke all on public.import_templates, public.import_template_versions, public.uploads,
  public.upload_slices, public.metric_values, public.ledger_balances, public.ledger_accounts
  from anon, authenticated;

-- service_role (the server secret key) is only used by the login throttle; it must
-- not be able to rewrite history either.
revoke all on public.uploads, public.upload_slices, public.metric_values,
  public.ledger_balances from service_role;
grant select on public.uploads, public.upload_slices, public.metric_values,
  public.ledger_balances to service_role;

grant select, insert, update, delete on public.import_templates to authenticated;
grant select, insert, delete on public.import_template_versions to authenticated;
grant select, insert on public.uploads, public.upload_slices, public.metric_values,
  public.ledger_balances to authenticated;
grant select, insert, update on public.ledger_accounts to authenticated;

create policy "app users select" on public.import_templates
  for select to authenticated using ((select private.is_app_user()));
create policy "app users insert" on public.import_templates
  for insert to authenticated with check ((select private.is_app_user()));
create policy "app users update" on public.import_templates
  for update to authenticated
  using ((select private.is_app_user())) with check ((select private.is_app_user()));
create policy "app users delete" on public.import_templates
  for delete to authenticated using ((select private.is_app_user()));

create policy "app users select" on public.import_template_versions
  for select to authenticated using ((select private.is_app_user()));
create policy "app users insert" on public.import_template_versions
  for insert to authenticated with check ((select private.is_app_user()));
create policy "app users delete" on public.import_template_versions
  for delete to authenticated using ((select private.is_app_user()));

create policy "app users select" on public.uploads
  for select to authenticated using ((select private.is_app_user()));
create policy "app users stage" on public.uploads
  for insert to authenticated
  with check (
    (select private.is_app_user())
    and status = 'staged' and published_at is null and retracted_at is null
    and (template_id is null) = (template_version is null)
  );

create policy "app users select" on public.upload_slices
  for select to authenticated using ((select private.is_app_user()));
create policy "app users stage" on public.upload_slices
  for insert to authenticated
  with check (
    (select private.is_app_user())
    and not is_current
    and exists (select 1 from public.uploads u where u.id = upload_id and u.status = 'staged')
  );

create policy "app users select" on public.metric_values
  for select to authenticated using ((select private.is_app_user()));
create policy "app users stage" on public.metric_values
  for insert to authenticated
  with check (
    (select private.is_app_user())
    and exists (select 1 from public.uploads u where u.id = upload_id and u.status = 'staged')
  );

create policy "app users select" on public.ledger_balances
  for select to authenticated using ((select private.is_app_user()));
create policy "app users stage" on public.ledger_balances
  for insert to authenticated
  with check (
    (select private.is_app_user())
    and exists (select 1 from public.uploads u where u.id = upload_id and u.status = 'staged')
  );

create policy "app users select" on public.ledger_accounts
  for select to authenticated using ((select private.is_app_user()));
create policy "app users insert" on public.ledger_accounts
  for insert to authenticated with check ((select private.is_app_user()));
create policy "app users update" on public.ledger_accounts
  for update to authenticated
  using ((select private.is_app_user())) with check ((select private.is_app_user()));
