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
| `tests/integration/`, `supabase/tests/db-roundtrip.test.ts`                                               | X               | fixtures through the real ingest vs truth; SIE fixtures vs truth; SQL RPCs vs the in-memory reference over the same published data                                         |

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

Hosted project: **"Ekonomi mbimpact.se"**, ref `mmiuuwrfcumcpgyleufu`, region `eu-north-1`.
`supabase/config.toml` (project_id `mb-stats`) lets a checkout `supabase link --project-ref
mmiuuwrfcumcpgyleufu` and `supabase db push`. Migrations are edited in place until the first
push; after that every change is a new migration. Auth settings of the hosted project
(signups off, minimum password length 16, `jwt_expiry` 900 s) are set in the dashboard and
documented as comments in `config.toml`; never run `supabase config push` against the hosted
project while they are comments, because keys missing from the file take the CLI defaults
(signups on, 6-character passwords, 1-hour tokens). SQL tests run on PGlite
(`supabase/tests/harness.ts`).

All tables in `public` have RLS enabled. Helper `private.is_app_user()` (SECURITY DEFINER,
STABLE, `search_path = ''`) returns true when `auth.uid()` is in `public.app_users`.
Policies: `to authenticated using ((select private.is_app_user()))` for select/insert/update.
No DELETE policies on uploads, facts, ledger, board_reports or import template versions. `anon` has no table grants.
Use built-ins only (`gen_random_uuid()`, `sha256()`); no pgcrypto.

### Reference data

- `companies(id smallint pk, code text unique check in ('MBAB','MBR'), legal_name, short_name, org_nr unique, fiscal_start_month smallint default 1)`
- `app_users(user_id uuid pk references auth.users on delete cascade, created_at)`
- `datasets(id smallint identity pk, key unique, name, kind check in ('table','cases','ledger'))`
- `dimensions(id smallint identity pk, key unique, label, is_personal bool, unknown_policy check in ('ask','auto_create'))`
- `dataset_dimensions(dataset_id, dimension_id, pk(both))`
- `dimension_values(id bigint identity pk, dimension_id, code text, label text, sort int, active bool default true, created_at, unique(dimension_id, code))`
  - `code` is the canonical normalized key (lowercased, trimmed, collapsed spaces) except `kostnadsstalle`, which is `MBAB:100` (scoped per company), and `kontogrupp`, which equals the account group key.
  - Trigger: reject `code`/`label` that look like a Swedish personnummer/samordningsnummer (10/12 digits, optionally `-`, `+`, a space, NBSP or narrow NBSP between date and serial, valid date or day+60, Luhn). Org numbers pass (month digits > 12 rule). Same rule as `isPersonnummer()` in `src/lib/core/pnr.ts`; `src/lib/sie/pii.ts` reuses its shapes without the Luhn check (masks more, never less).
- `dimension_aliases(dimension_id, alias_norm text, value_id bigint references dimension_values, pk(dimension_id, alias_norm))`
- `metrics(id smallint identity pk, key unique, name, unit check in ('st','kr','h','pct','faktor','man'), kind check in ('sum','snapshot','distinct','ledger','formula'), dataset_id null, higher_is_better bool null, decimals smallint null, description text, headline_subject text, snapshot_rollup check in ('last','avg') null, base_metric_id null, distinct_dimension_id null, account_group_key text null, formula text null, is_system bool default false)`
  - CHECK constraints per kind (e.g. distinct ⇒ base + distinct dimension; ledger ⇒ account_group_key; formula ⇒ formula and dataset null).
- `account_groups(key text pk, name, sign smallint check in (1,-1), sort int)`
- `account_group_ranges(id identity pk, group_key references account_groups, from_account int, to_account int, check from<=to)`
- `settings(key text pk, value jsonb, updated_at)` – e.g. `deviation_threshold_pct` (25), `min_engine_version` (1).

Seed (migration) mirrors `src/lib/contracts/catalog.ts` exactly (datasets, dimensions,
dataset_dimensions, metrics, account groups) plus the two companies, the `verksamhet`
values (ROM2, KROM, KVL, Karriärvägledning, Stöd och matchning, Bemanning) and one
`kontogrupp` value per account group (code = group key, label = group name).
`supabase/tests/seed.test.ts` compares every field.

Leaf account groups are the groups whose ranges do not strictly contain another group's
ranges: `intakter`, `varor_ul`, `ovriga_externa`, `personal`, `avskrivningar`,
`ovriga_rorelse` (7900–7999), `finansiella`, `bokslut_skatt`. `kostnader` (4000–7999) and
`resultat` (3000–8999) are sums of leaves.

### Imports

- `import_templates(id uuid pk, dataset_id, name, kind check in ('table','cases','sie'), current_version int, header_signature jsonb, sheet_hint text, created_at, updated_at)`
- `import_template_versions(template_id, version int, config jsonb, created_at, pk(template_id, version))` – config validated client-side by `TemplateConfigSchema`. Table templates may set `budgetSign` (see "Budget sign"); table and cases templates may set `headerRow` (0-based sheet row picked by hand; `runTemplate` uses `RunContext.headerRow ?? config.headerRow ?? detection`). The mapping view always shows the header row field and saves a row only when the user changes it (`headerRowFromInput`: leaving the detected row as it is pins nothing; emptying the field returns to detection), and recognition matches such a template against the sheet read at that row (`templateHeaderRows`, `RecognizeResponse.signaturesAt`). Deleting a template in Inställningar is allowed while uploads use it (they keep their numbers; see `uploads`). Versions are immutable: `authenticated` may select and insert them but not delete one; they go only with their template (`on delete cascade`), so an upload's template link is never cut while the template exists.
- `uploads(id uuid pk, dataset_id, template_id null, template_version null, scenario check in ('utfall','budget'), file_name, file_sha256 text, file_size bigint, content_hash text, engine_version int, as_of_date date null, parse_report jsonb, totals jsonb, status check in ('staged','published','retracted','discarded'), created_at, published_at, retracted_at, retract_reason)`
  - Partial unique: `(dataset_id, file_sha256, coalesce(template_id,…), coalesce(template_version,0)) where status = 'published' and (template_id is not null or template_version is null)` – same file + same template version (or, for SIE, no template) cannot be published twice.
  - Templates can be deleted while uploads keep their data: FK `(template_id, template_version) → import_template_versions on delete set null (template_id)`, so deleting a template (versions cascade) nulls `template_id` and keeps `template_version` as history. Such uploads stay published/current, can still be reviewed, published (if staged) and retracted, and are left out of the partial unique index. `check (template_id is null or template_version is not null)`; clients may only stage both or neither (insert policy).
- `upload_slices(upload_id, dataset_id, company_id, scenario, month date check (extract(day from month)=1), priority smallint default 0, is_current bool default false, pk(upload_id, company_id, scenario, month))`
  - `unique (dataset_id, company_id, scenario, month) where is_current`.
  - priority: ledger rows with `year_offset = -1` get priority -1 (a file's own year wins).
- Staging is insert-only. `authenticated` may INSERT uploads only with `status = 'staged'`
  (no `published_at`/`retracted_at`), slices only with `is_current = false` and only into a
  staged upload, and facts/ledger rows only into a staged upload. There are no UPDATE or
  DELETE grants on uploads, upload_slices, metric_values or ledger_balances; `service_role`
  can only SELECT them. Status and `is_current` change only inside the SECURITY DEFINER RPCs
  below.

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
- `private.login_attempts(id uuid pk, ip_hash text, at timestamptz, ok bool null)` – `ok` null = pending (counted as a failure). Only `service_role` can touch it (through the login RPCs).

### RPCs (all `search_path = ''`, fully qualified names)

- `publish_upload(p_upload_id uuid) returns jsonb` – **SECURITY DEFINER** (with `retract_upload` the only code that may flip `uploads.status` and `upload_slices.is_current`, which clients cannot write). First statement `private.assert_app_user()`; then `pg_advisory_xact_lock(hashtext('publish:'||dataset_id))` and the upload row `for update`. Validates: status = staged; `engine_version ≥ settings.min_engine_version`; the template (if any) belongs to the dataset; at least one slice; every fact's metric belongs to the dataset and is `sum`/`snapshot`; facts lie inside the upload's company×month slices; every dims value is a `dimension_values.id` of a dimension of the dataset; kostnadsställe values (facts and dim-1 ledger object rows) are scoped to the fact's company (`MBAB:100`). A slice becomes current unless the current slice has higher priority; `published_at = clock_timestamp()` taken under the lock (publish order). Writes `audit_log`; returns a summary (slices, current, kept, superseded, facts, ledger_rows).
- `retract_upload(p_upload_id uuid, p_reason text)` – SECURITY DEFINER, same app-user check and advisory lock; only for published uploads. Releases its current slices and, per slice, makes current the upload that would be current had this one never been published (`priority desc, published_at desc, id desc`). Sets status = retracted, `retracted_at`, reason; writes `audit_log`.
- `discard_upload(p_upload_id uuid)` – SECURITY DEFINER; only for staged uploads; deletes their staged facts/ledger rows (the only DELETE on those tables), sets status = discarded, writes `audit_log`.
- `discard_stale_uploads(p_older_than_hours int default 24) returns int` – SECURITY DEFINER, app-user check; discards (via `discard_upload`) every upload still staged whose `created_at` is older than the threshold (at least 1 hour; rows locked by a running publish are skipped) and returns the count. Repo: `discardStaleUploads(db, hours)`; `/ladda-upp` calls it when it loads, alongside its catalog reads (errors ignored).
- `review_compare(p_upload_id uuid) returns jsonb` – per metric × company × month: staged total, current published total (same slice), previous-month total, deviation %.
- `metric_monthly(p_metric_keys text[], p_company_codes text[], p_scenario text, p_from date, p_to date, p_group_by text[], p_filters jsonb) returns table(metric_key text, month date, grp jsonb, value numeric)` – SECURITY INVOKER; current facts only; group key built with `jsonb_object_agg` over requested dimension keys (no dynamic SQL); "bolag" groups by company code.
- `metric_distinct(p_base_metric_key text, p_dimension text, p_company_codes text[], p_scenario text, p_from date, p_to date, p_group_by text[], p_filters jsonb, p_per_month bool) returns table(month date, grp jsonb, cnt bigint)` – counts distinct `dims->>p_dimension` over facts with value > 0.
- `ledger_monthly(p_group_keys text[], p_company_codes text[], p_from date, p_to date, p_group_by text[]) returns table(group_key text, month date, grp jsonb, value numeric)` – sums `amount * sign` over account ranges; totals rows (`dim_no is null`) unless grouping by `kostnadsstalle` (then object rows for dim 1 plus an "ofördelat" remainder = total − Σ objects, with `grp = {"kostnadsstalle": null}`).
  - Budget for ledger metrics: when scenario = 'budget' the adapter instead reads `metric_monthly(['budget_belopp'], …)` grouped by `kontogrupp` and applies the budget sign rule (see "Budget sign") in TypeScript (`budgetLedgerRows`, shared by `SupabaseMetricDataSource` and `MemoryMetricDataSource`).
- `metric_coverage(p_metric_keys text[], p_company_codes text[], p_scenario text, p_from date, p_to date) returns table(metric_key text, month date)`
- `metric_sources(p_metric_keys text[], p_company_codes text[], p_from date, p_to date) returns table(upload_id uuid, file_name text, dataset_key text, template_name text, template_version int, published_at timestamptz, months date[])` – `template_name` and `template_version` are both null for an upload whose template was deleted.
  - `SupabaseMetricDataSource` (one instance per request via `getMetricSource()`) memoizes definitions, account groups and the results of `coverage`, `labels` and `lastUpdated` per instance, keyed by the arguments the RPC reads (sorted key/company sets; grouping and filters ignored), so a dashboard's widgets send each identical RPC once. Failed calls are not cached.
- `ensure_dimension_values(p_dimension text, p_labels text[]) returns table(label text, id bigint)` – creates missing values (only for `auto_create` dims unless `p_force`), resolves aliases.
- `merge_dimension_values(p_from bigint, p_into bigint)` – rewrites dims in metric_values, adds alias, deactivates `p_from`, audit.
- `freeze_report(p_title text, p_template_id uuid, p_anchor date, p_snapshot jsonb) returns uuid`.
- Phase 2: `get_shared_report(p_token text) returns jsonb` (SECURITY DEFINER, granted to anon), `create_share_link`, `revoke_share_link`.
- Login throttle: `public.login_gate(p_ip_hash text) returns jsonb {allowed bool, retry_after_s int, delay_ms int, attempt_id uuid|null}` and `public.login_record(p_attempt_id uuid, p_ok bool)`. In `public` so PostgREST can reach them, but `revoke execute … from public, anon, authenticated; grant execute … to service_role` (called only through `createAdminClient()` in `src/lib/db/admin.ts` from the login action). The gate is atomic: under `pg_advisory_xact_lock(hashtext('login:'||ip_hash))` it decides and, when it allows, inserts a **pending** attempt (`ok` null) and returns its id; pending attempts count as failures, so a burst of parallel requests cannot all pass before any is recorded (the sixth gate of a burst is refused). Refused attempts are not registered. `login_record` finalizes a pending attempt exactly once with Auth's answer; an attempt that is never finalized (network trouble, crash) stays a failure (fails closed). Rules: per ip_hash 5 failures in 15 min ⇒ locked 15 min, doubling per repeated lockout within 24 h (cap 24 h), a success resets the history; > 50 failures/hour globally ⇒ `delay_ms` up to 3000 for everyone (never a hard global lock); rows older than 24 h deleted at the gate. The action fails closed when the gate errors or returns no attempt id.

## Metric semantics (tested in `src/lib/metrics`)

- sum: add over months and groups.
- snapshot: per month add over groups/companies; over a multi-month window take the last month with data (`last`) or the average of months with data (`avg`). Never add months.
- distinct: count distinct over the whole window and group (from `metric_distinct`), never add monthly counts. Monthly series use per-month counts.
- ledger: monthly sums × sign; add over months.
- formula: roll each operand up by its own rule for the same window/group, then evaluate. Division by zero → null. Operand null → null. Averages are formulas over additive parts, never stored averages: `anstallningstid` = `anstallningsmanader / anstallda_konsulter`, where `anstallningsmanader` (snapshot, last) is the sum of tenure months of the employments active at month end (cases ingest `tenureMonthsSum`; the old per-group average `tenureMonths` is deprecated and ignored with a warning).
- Missing month ≠ 0: a window with no data → value null, status `no_data`; partial → coverage `withData < expected`.
- Filters/groups on a dimension not in a metric's dataset → status `not_applicable` (never a silent total).
- Comparisons: prev_period (`previousPeriod`), prev_year (`previousYear`), budget (scenario budget for the same window). `deltaPct` relative; for `pct` units use `deltaPp`.
- Headline: compare current vs prev_period (or prev_year if none); |deltaPct| < 2 (or |Δp.e.| < 1 for pct) is flat. Templates: "{SUBJECT} ÖKAR." / "{SUBJECT} MINSKAR." / "{SUBJECT} LIGGER STILLA.", subject = the metric's `headlineSubject` + filter/company phrases (e.g. "DELTAGARNA I KROM ÖKAR."), at most 60 characters. Without a comparison, and always against budget, the headline states the value ("INTÄKTERNA I MB AB: 1,5 MKR.") and the delta shows "mot budget".

## Budget sign

`budget_belopp` facts are stored in bookkeeping (SIE) sign, exactly like `LedgerRow.amount`:
revenue negative, costs positive. The budget of a ledger metric with account group G is

    (Σ budget_belopp facts whose kontogrupp is a leaf group with ranges inside G's ranges) × G.sign

so revenue and the financial net read positive like actuals, and `kostnader` / `resultat`
budgets are derived from the leaves (a budget line on a non-leaf kontogrupp is ignored, never
counted twice). A ledger group without budget rows in a month is unknown (null), not 0.
Budget files say how they write amounts with the table template's optional `budgetSign`:
`result` (revenue +, costs −; ingest multiplies by −1), `positive` (all positive; ingest
multiplies by the kontogrupp's account-group sign from `RunContext.accountGroupSigns`, matching
the label by group key or name, case-insensitively; unknown groups are dropped with an error)
or `ledger` (already SIE sign; also the default). `fixtures/files/budget_2026.xlsx` is a
`result` budget.

In the upload flow the mapping view writes `budgetSign` ("Hur skrivs beloppen?",
`BUDGET_SIGN_LABELS`; `positive` needs a kontogrupp column). Templates saved before the field
wrote a result budget as a trailing `negate` step on the measure; opening such a template turns
that step into `budgetSign: "result"`. `/ladda-upp` loads the account groups server-side and
every `runTemplate` call (worker or main thread) gets `accountGroupSigns`/`accountGroupNames`.
The review warns ("Budget på summarader räknas inte – lägg budgeten på delraderna") when a
budget file has lines on a non-leaf kontogrupp (`leafAccountGroups`), and Inställningar ›
Kontogrupper warns when an edit makes a group stop (or start) being a budget leaf.

## Security invariants

- `proxy.ts` refreshes the session and redirects anonymous users to `/logga-in`; every protected server component and server action re-checks with `supabase.auth.getClaims()`/`getUser()` via `src/lib/db/session.ts` (`requireSession()`).
- The service-role client (`createAdminClient()`, typed `SupabaseClient<Database>`) is used only by the login action for `login_gate`/`login_record`. Server data access otherwise goes through `createSupabaseServerClient()` / `getMetricSource()` under RLS.
- No personnummer anywhere server-side (client strip + DB trigger). Recognised with `-`, `+`, a space, NBSP or narrow NBSP between date and serial, 10 or 12 digits; organisation numbers pass.
- Personal dimensions (`is_personal`) can be grouped/filtered in the workspace only; slide specs and frozen snapshots cannot reference them.
- No original files stored in phase 1. No payload logging.
- Secrets only in env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (server-only, login throttle), `STATS_LOGIN_EMAIL` (server-only).

## UI conventions settled in review

- shadcn `--accent` (focus/hover fill of menu items and options) is light grey `#E4E5E6` with
  antracit text; red stays for `--destructive` and the brand tokens.
- `CountUp` never shows a smaller number than the server rendered: a hydrated number is left as
  is, a client-side mount counts up from 0 before its first paint, a changed value counts from
  the old one; reduced motion and `[data-static]` ancestors keep it still.
- Error pages are Swedish and brand styled: `src/app/not-found.tsx` ("Sidan finns inte", link
  to Översikt), `src/app/error.tsx` and `src/app/global-error.tsx` (retry; the error digest at
  most, never a message or stack trace).
- One `<Toaster theme="light" />` for the signed-in app, in `src/app/(app)/layout.tsx`.
- `KpiCard` takes `actions` (bottom-right, above the stretched drill-down link; the Källa
  button), `secondaryDelta` (dashboard ledger KPIs: prev period first, then "mot budget"; none when the widget's own `compare` is budget) and
  passes other attributes (`data-testid`, `aria-*`) to its `<article>`.
- `MbBarChart` and `MbDonut` take `categoryHrefs` (aligned with the categories; dashboard
  widgets build them from `ChartData.categoryIds`): bars and slices open them on click, and a
  link list that is visually hidden until focused serves keyboard and screen reader users.
  Charts take `fontSize`/`yAxisWidth` (miniature slides, `miniatureChartText`); `MbDonut`
  `showTotal={false}` hides the hole's total (slides, where the big number is the total).
  Dashboard widgets show `ResolvedSlide.lastUpdatedAt`; no extra query for ids or dates.
- Pages that 404 on unknown route params decide it before any Suspense boundary
  (`/utforska/[dimension]/[value]` checks the dimension and value first): `notFound()` thrown
  while streaming keeps status 200. No `loading.tsx` in those segments for the same reason.

## Tests that tie the modules together

- `tests/integration/fixtures.test.ts`: every data file in `fixtures/truth/manifest.json`
  through `readWorkbook` → `runTemplate` (manifest template, choices, aliases) equals the truth
  exactly (same fact keys, values to 1e-6; only the explicit zeros of cases files are dropped,
  since the truth omits zeros); the drifted export gives an incompatible `SignatureDiff`; no
  personnummer (not even one with a wrong check digit) in any fact or report field, while the
  raw timmar, konsulter and deltagare files do hold them.
- `tests/integration/personnummer.test.ts`: personnummer written with a space, NBSP or narrow
  NBSP are refused in a stored column and kept out of every output of a removed one.
- `tests/integration/supabase-config.test.ts`: `supabase/config.toml` names `mb-stats`, keeps
  the hosted auth settings as comments (with the `config push` warning) and holds no secrets.
- `tests/integration/sie.test.ts`: every `fixtures/sie` file through `ingestSie` vs
  `fixtures/sie/truth` (result per month, per account, per kostnadsställe; unknown org →
  company null, nothing to stage).
- `tests/integration/budget.test.ts`: the budget truth as ledger budgets through the engine.
- `supabase/tests/db-roundtrip.test.ts`: fixtures + one SIE file staged and published through
  the repo functions into PGlite, then a query matrix (metrics × month/quarter/YTD/R12 ×
  MBAB/ALL × group by none/kund/verksamhet/bolag/ort/kostnadsställe, with prev period, prev
  year and budget) gives identical results over `SupabaseMetricDataSource` and
  `MemoryMetricDataSource` built from the same facts.
