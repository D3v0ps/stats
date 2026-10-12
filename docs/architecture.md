# MB Stats – architecture

Reference for everyone building MB Stats. UI is Swedish; code and comments are English.
The approved plan (Swedish) is the product spec; this file is the technical contract.

## Modules and ownership

| Path                                                                                                      | Owner           | What                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/contracts/`                                                                                      | frozen (step 0) | zod schemas + types shared by all modules. Change only with a cross-module update.                                                                                         |
| `src/lib/core/`                                                                                           | step 0 + A      | pure helpers: `month.ts`, `format-sv.ts` (step 0); `num-sv.ts`, `dates-sv.ts`, `encoding.ts`, `cp437.ts`, `pnr.ts`, `normalize.ts`, `hash.ts` (A; B may add to `cp437.ts`) |
| `src/lib/ingest/`                                                                                         | A               | readers (csv/xlsx/xls/html), header detection, recognition, pipeline steps, aggregation, cases, PII detection                                                              |
| `src/lib/sie/`                                                                                            | B               | SIE4 decode, tokenize, parse, ledger rows, checks                                                                                                                          |
| `src/lib/metrics/`                                                                                        | E               | metric engine over `MetricDataSource`, formula parser, comparisons, headline, report resolver                                                                              |
| `supabase/migrations/`, `supabase/tests/`, `src/lib/db/`                                                  | C               | schema, RLS, RPCs, PGlite tests, Supabase clients, repo adapters (incl. `MetricDataSource` impl)                                                                           |
| `src/app/(auth)`, `src/proxy.ts`, `src/components/brand/`, `src/app/globals.css`, app shell               | D               | design system, login, session, layout                                                                                                                                      |
| `src/workers/`, `src/components/import/`, `src/app/(app)/ladda-upp/`                                      | F               | upload → recognize → map → review → publish UI                                                                                                                             |
| `src/components/explore/`, `src/components/widgets/`, `src/app/(app)/page.tsx`, `src/app/(app)/utforska/` | H               | dashboard, drill-down, pivot                                                                                                                                               |
| `src/app/(app)/installningar/`                                                                            | J               | settings                                                                                                                                                                   |
| `src/components/present/`, `src/app/presentera/`, `src/app/(app)/rapporter/`                              | I               | report templates, presentation, freeze, archive                                                                                                                            |
| `fixtures/`, `scripts/fixtures/`                                                                          | A               | synthetic test files + ground truth                                                                                                                                        |
| `scripts/reconcile/`                                                                                      | V               | clean-room reconciliation (must not import `src/lib/ingest`)                                                                                                               |

`src/lib/**` is pure isomorphic TypeScript: no DOM, no `window`, no Next imports (except `src/lib/db`).
Phase 3 runs the same ingest code on the server.

## Data flow

```
File (browser) ─► readers ─► DetectedTable ─► pipeline(steps) ─► typed rows
   ─► aggregate (table) / cases (start/end) / sie (ledger)  ─► IngestResult (FactDraft[] | LedgerRow[])
   ─► resolve dims (aliases → dimension_values.id; unknowns flagged or auto-created)
   ─► create upload (status=staged) ─► insert facts/ledger in chunks (PostgREST, RLS)
   ─► review_compare(upload) ─► publish_upload(upload) [transaction, advisory lock]
Query: page (server component) ─► metrics engine ─► MetricDataSource (Supabase RPCs) ─► MetricResult
Report: SlideSpec[] ─► resolveReport ─► ResolvedReport JSON ─► deck / frozen / print / share
```

## Database schema (Postgres 17, Supabase)

All tables in `public` have RLS enabled. Helper `private.is_app_user()` (SECURITY DEFINER,
STABLE, `search_path = ''`) returns true when `auth.uid()` is in `public.app_users`.
Policies: `to authenticated using ((select private.is_app_user()))` for select/insert/update.
No DELETE policies on uploads, facts, ledger, board_reports. `anon` has no table grants.
Use built-ins only (`gen_random_uuid()`, `sha256()`); no pgcrypto.

### Reference data

- `companies(id smallint pk, code text unique check in ('MBAB','MBR'), legal_name, short_name, org_nr unique, fiscal_start_month smallint default 1)`
- `app_users(user_id uuid pk references auth.users on delete cascade, created_at)`
- `datasets(id smallint identity pk, key unique, name, kind check in ('table','cases','ledger'))`
- `dimensions(id smallint identity pk, key unique, label, is_personal bool, unknown_policy check in ('ask','auto_create'))`
- `dataset_dimensions(dataset_id, dimension_id, pk(both))`
- `dimension_values(id bigint identity pk, dimension_id, code text, label text, sort int, active bool default true, created_at, unique(dimension_id, code))`
  - `code` is the canonical normalized key (lowercased, trimmed, collapsed spaces) except `kostnadsstalle`, which is `MBAB:100` (scoped per company), and `kontogrupp`, which equals the account group key.
  - Trigger: reject `code`/`label` that look like a Swedish personnummer/samordningsnummer (10/12 digits, valid date or day+60, Luhn). Org numbers pass (month digits > 12 rule).
- `dimension_aliases(dimension_id, alias_norm text, value_id bigint references dimension_values, pk(dimension_id, alias_norm))`
- `metrics(id smallint identity pk, key unique, name, unit check in ('st','kr','h','pct','faktor','man'), kind check in ('sum','snapshot','distinct','ledger','formula'), dataset_id null, higher_is_better bool null, decimals smallint null, description text, headline_subject text, snapshot_rollup check in ('last','avg') null, base_metric_id null, distinct_dimension_id null, account_group_key text null, formula text null, is_system bool default false)`
  - CHECK constraints per kind (e.g. distinct ⇒ base + distinct dimension; ledger ⇒ account_group_key; formula ⇒ formula and dataset null).
- `account_groups(key text pk, name, sign smallint check in (1,-1), sort int)`
- `account_group_ranges(id identity pk, group_key references account_groups, from_account int, to_account int, check from<=to)`
- `settings(key text pk, value jsonb, updated_at)` – e.g. `deviation_threshold_pct` (25), `min_engine_version` (1).

Seed (migration) mirrors `src/lib/contracts/catalog.ts` exactly (datasets, dimensions,
dataset_dimensions, metrics, account groups) plus the two companies and the `verksamhet`
values (ROM2, KROM, KVL, Karriärvägledning, Stöd och matchning, Bemanning).

### Imports

- `import_templates(id uuid pk, dataset_id, name, kind check in ('table','cases','sie'), current_version int, header_signature jsonb, sheet_hint text, created_at, updated_at)`
- `import_template_versions(template_id, version int, config jsonb, created_at, pk(template_id, version))` – config validated client-side by `TemplateConfigSchema`.
- `uploads(id uuid pk, dataset_id, template_id null, template_version null, scenario check in ('utfall','budget'), file_name, file_sha256 text, file_size bigint, content_hash text, engine_version int, as_of_date date null, parse_report jsonb, totals jsonb, status check in ('staged','published','retracted','discarded'), created_at, published_at, retracted_at, retract_reason)`
  - Partial unique: `(dataset_id, file_sha256, coalesce(template_id,…), coalesce(template_version,0)) where status = 'published'` – same file + same template version cannot be published twice.
- `upload_slices(upload_id, dataset_id, company_id, scenario, month date check (extract(day from month)=1), priority smallint default 0, is_current bool default false, pk(upload_id, company_id, scenario, month))`
  - `unique (dataset_id, company_id, scenario, month) where is_current`.
  - priority: ledger rows with `year_offset = -1` get priority -1 (a file's own year wins).

### Facts

- `metric_values(id bigint identity pk, upload_id, metric_id, company_id, month date check first-of-month, dims jsonb not null default '{}', value numeric not null, source_rows int[] null)`
  - `dims` maps dimension key → `dimension_values.id` (number). Every mapped dimension present.
  - Indexes: `(metric_id, month, company_id)`, `(upload_id)`, GIN `dims jsonb_path_ops`.
- `ledger_balances(id bigint identity pk, upload_id, company_id, month date, account int, dim_no smallint null, object_value_id bigint null references dimension_values, amount numeric, year_offset smallint, source check in ('psaldo','trans'))`
  - Totals (`dim_no is null`) and object rows are kept apart; never sum both.
- `ledger_accounts(company_id, account int, name, pk(company_id, account))`

"Current" = rows whose `upload_id` has an `upload_slices` row with `is_current` for the same
company and month (and the upload's scenario).

### Periods, reports, audit

- `period_status(company_id, month date, closed_at, pk(company_id, month))` – optional manual close.
- `dashboards(id uuid pk, name, is_default bool, spec jsonb, updated_at)`
- `report_templates(id uuid pk, name, slides jsonb, updated_at)`
- `board_reports(id uuid pk, template_id null, title, anchor_month date, snapshot jsonb, schema_version int, frozen_at timestamptz)` – trigger blocks UPDATE/DELETE; insert trigger `private.assert_snapshot_nonpersonal()` rejects snapshots whose slides group/filter by a personal dimension.
- `share_links(id uuid pk, board_report_id, token_hash bytea unique, label, created_at, expires_at null, revoked_at null, view_count int default 0, last_viewed_at)` – phase 2.
- `audit_log(id bigint identity pk, at timestamptz default now(), action text, entity text, entity_id text, detail jsonb)` – append-only (no update/delete grants).
- `private.login_attempts(ip_hash text, at timestamptz, ok bool)` – only `service_role` can touch.

### RPCs (all `search_path = ''`, fully qualified names)

- `publish_upload(p_upload_id uuid) returns jsonb` – SECURITY INVOKER; `pg_advisory_xact_lock(hashtext('publish:'||dataset))`; validates status=staged, engine_version ≥ settings.min_engine_version, every fact's metric belongs to the dataset, months first-of-month, SIE company matches; marks previous current slices not current, inserts/updates this upload's slices as current (respecting priority); writes audit_log; returns summary.
- `retract_upload(p_upload_id uuid, p_reason text)` – sets status=retracted, restores for each slice the most recent other published upload covering it (by published_at, priority) as current.
- `discard_upload(p_upload_id uuid)` – only for staged uploads; deletes their staged facts/ledger rows (SECURITY DEFINER, checks is_app_user + status).
- `review_compare(p_upload_id uuid) returns jsonb` – per metric × company × month: staged total, current published total (same slice), previous-month total, deviation %.
- `metric_monthly(p_metric_keys text[], p_company_codes text[], p_scenario text, p_from date, p_to date, p_group_by text[], p_filters jsonb) returns table(metric_key text, month date, grp jsonb, value numeric)` – SECURITY INVOKER; current facts only; group key built with `jsonb_object_agg` over requested dimension keys (no dynamic SQL); "bolag" groups by company code.
- `metric_distinct(p_base_metric_key text, p_dimension text, p_company_codes text[], p_scenario text, p_from date, p_to date, p_group_by text[], p_filters jsonb, p_per_month bool) returns table(month date, grp jsonb, cnt bigint)` – counts distinct `dims->>p_dimension` over facts with value > 0.
- `ledger_monthly(p_group_keys text[], p_company_codes text[], p_from date, p_to date, p_group_by text[]) returns table(group_key text, month date, grp jsonb, value numeric)` – sums `amount * sign` over account ranges; totals rows (`dim_no is null`) unless grouping by `kostnadsstalle` (then object rows for dim 1 plus an "ofördelat" remainder = total − Σ objects, with `grp = {"kostnadsstalle": null}`).
  - Budget for ledger metrics: when scenario = 'budget' the adapter instead reads `metric_monthly(['budget_belopp'], …)` grouped by `kontogrupp` and maps `kontogrupp` value code → group key.
- `metric_coverage(p_metric_keys text[], p_company_codes text[], p_scenario text, p_from date, p_to date) returns table(metric_key text, month date)`
- `metric_sources(p_metric_keys text[], p_company_codes text[], p_from date, p_to date) returns table(upload_id uuid, file_name text, dataset_key text, template_name text, template_version int, published_at timestamptz, months date[])`
- `ensure_dimension_values(p_dimension text, p_labels text[]) returns table(label text, id bigint)` – creates missing values (only for `auto_create` dims unless `p_force`), resolves aliases.
- `merge_dimension_values(p_from bigint, p_into bigint)` – rewrites dims in metric_values, adds alias, deactivates `p_from`, audit.
- `freeze_report(p_title text, p_template_id uuid, p_anchor date, p_snapshot jsonb) returns uuid`.
- Phase 2: `get_shared_report(p_token text) returns jsonb` (SECURITY DEFINER, granted to anon), `create_share_link`, `revoke_share_link`.
- Login throttle: `public.login_gate(p_ip_hash text) returns jsonb {allowed bool, retry_after_s int, delay_ms int}` and `public.login_record(p_ip_hash text, p_ok bool)`. In `public` so PostgREST can reach them, but `revoke execute … from public, anon, authenticated; grant execute … to service_role` (called only from `src/lib/db/admin.ts`). They read/write `private.login_attempts`. Rules: per ip_hash 5 failures in 15 min ⇒ locked 15 min, doubling per repeated lockout (cap 24 h); > 50 failures/hour globally ⇒ `delay_ms` up to 3000 for everyone (never a hard global lock); rows older than 24 h deleted opportunistically.

## Metric semantics (tested in `src/lib/metrics`)

- sum: add over months and groups.
- snapshot: per month add over groups/companies; over a multi-month window take the last month with data (`last`) or the average of months with data (`avg`). Never add months.
- distinct: count distinct over the whole window and group (from `metric_distinct`), never add monthly counts. Monthly series use per-month counts.
- ledger: monthly sums × sign; add over months.
- formula: roll each operand up by its own rule for the same window/group, then evaluate. Division by zero → null. Operand null → null.
- Missing month ≠ 0: a window with no data → value null, status `no_data`; partial → coverage `withData < expected`.
- Filters/groups on a dimension not in a metric's dataset → status `not_applicable` (never a silent total).
- Comparisons: prev_period (`previousPeriod`), prev_year (`previousYear`), budget (scenario budget for the same window). `deltaPct` relative; for `pct` units use `deltaPp`.
- Headline: compare current vs prev_period (or prev_year if none); |deltaPct| < 2 (or |Δp.e.| < 1 for pct) = "OFÖRÄNDRAT". Templates: "{SUBJECT} ÖKAR." / "{SUBJECT} MINSKAR." / "{SUBJECT} ÄR OFÖRÄNDRAT.", subject derived from metric name + filter labels (e.g. "DELTAGARNA I KROM").

## Security invariants

- `proxy.ts` refreshes the session and redirects anonymous users to `/logga-in`; every protected server component and server action re-checks with `supabase.auth.getClaims()`/`getUser()` via `src/lib/db/session.ts` (`requireSession()`).
- No personnummer anywhere server-side (client strip + DB trigger + `scripts/db/scan-pii.sql`).
- Personal dimensions (`is_personal`) can be grouped/filtered in the workspace only; slide specs and frozen snapshots cannot reference them.
- No original files stored in phase 1. No payload logging.
- Secrets only in env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (server-only, login throttle), `STATS_LOGIN_EMAIL` (server-only).
