# Test fixtures: messy import files and their ground truth

Synthetic, deliberately messy versions of the files Karim exports from Intelliplan, Workbuster,
Fortnox and the budget workbook, plus the facts the app must produce from each of them.
**Every name, personnummer, amount and id is fictional** (seeded PRNG); the personnummer are
checksum-valid on purpose so the PII detection has something real to catch, and their
födelsenummer (the three digits before the check digit) is always 980–999, the series of
Skatteverket's published test personnummer, which is never assigned to a real person. A random
serial would coincide with a real person's number for roughly every third fake.

| Path                                | What                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| `fixtures/files/`                   | the raw files (committed, never hand-edited)                    |
| `fixtures/truth/<file stem>.json`   | expected facts per file                                         |
| `fixtures/truth/manifest.json`      | per file: dataset, layout, counts, aliases, import templates    |
| `scripts/fixtures/generate.ts`      | the generator (`pnpm fixtures`)                                 |
| `scripts/fixtures/fixtures.test.ts` | shape checks + "committed output equals a fresh generation"     |
| `scripts/reconcile/`                | clean-room Python recomputation; `--selftest` checks every file |

```bash
pnpm fixtures                                   # regenerate files + truth (byte-identical)
python3 scripts/reconcile/reconcile.py --selftest
```

## Why the truth can be trusted

The truth is computed **from the generator's model of each row** (this shift is real, that
customer record is a PostNord spelling variant, this case was interrupted on that date), not by
parsing the written files, and without any code from `src/lib/ingest` or `src/lib/sie`. The
Python reconciler then re-derives every truth file from the raw bytes with its own readers and
configs; `--selftest` requires both to agree at company × month level, per dimension and per
full dimension set, and checks that deliberate errors in the truth are detected. Two
independent implementations agreeing is the guarantee; the app is the third.

## Truth file format

```json
[
  {
    "metricKey": "timmar",
    "company": "MBAB",
    "month": "2026-09",
    "dims": {
      "konsult": "2036",
      "kund": "Budbee Kungsängen",
      "uppdrag": "5201 - Sortering kväll",
      "verksamhet": "Bemanning"
    },
    "value": 46.5
  }
]
```

- Same shape as `FactDraft` (`src/lib/contracts/import-payload.ts`) without `sourceRows`.
- Metric and dimension keys come from `src/lib/contracts/catalog.ts`; every fact of a metric
  carries every mapped dimension of the intended template (and only those).
- Dimension values are the **canonical labels after the intended mapping**:
  - `kund`: `Postnord` → `PostNord AB`; the test customer never appears.
  - `konsult`: the Anställnings id as text (`"2036"`). Never a name or personnummer.
  - `verksamhet`: the seeded labels (`ROM2`, `KROM`, `KVL`, `Karriärvägledning`,
    `Stöd och matchning`, `Bemanning`).
  - `kontogrupp`: the account group **key** (`intakter`, `varor_ul`, …), which equals
    `dimension_values.code` of the seeded kontogrupp values.
- Facts with value 0 are omitted (treat a missing key as 0). Exception: `anstallningstid`
  (an average) is present exactly when `anstallda_konsulter` > 0 for the same key, even if 0.
- Values are rounded to 6 decimals. Compare with a tolerance (≥ 0.000001; 0.01 is plenty).
- Sorted by metric, company, month, dims; dims keys sorted. Months are `YYYY-MM`.

## manifest.json

One entry per file. Integration tests should iterate it instead of hard-coding names.

| Field                   | Meaning                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datasetKey`, `kind`    | catalog dataset; `table`, `cases` or `reference` (no facts)                                                                                                                                                                                          |
| `companies`, `scenario` | companies in the truth; `utfall` or `budget`                                                                                                                                                                                                         |
| `months`                | months present in the truth                                                                                                                                                                                                                          |
| `choices`               | `UploadChoices` that reproduce the truth (`month`, `company`, `asOfDate`)                                                                                                                                                                            |
| `layout`                | xlsx: per sheet `headerRow`, `firstDataRow`, `lastDataRow`, `dataRows`, `metaRows`, `emptyRows`, `sumRows`, `footerRows`, `merges` (1-based Excel rows; `dataRows` includes rows the mapping filters). Text: `headerLine`, `dataLines`, `lineEnding` |
| `encoding`, `delimiter` | text files only                                                                                                                                                                                                                                      |
| `aliases`               | dimension → raw spelling → canonical label (for testing the `lookup` step)                                                                                                                                                                           |
| `templates`             | `ImportTemplate` objects (validated against `ImportTemplateSchema` in the test) that reproduce the truth                                                                                                                                             |
| `sameTruthAs`, `drift`  | identical data in another shape; expected signature diff for the drifted file                                                                                                                                                                        |
| `counts`                | rows by meaning, e.g. `filteredUnstaffed`, `duplicateRows`, `creditNotes`                                                                                                                                                                            |
| `reconcileConfig`       | `scripts/reconcile/configs/<name>` used by the selftest                                                                                                                                                                                              |

Suggested integration test per entry: read the file → detect the table (expect
`layout.headerRow`, the sum/footer rows skipped) → run `templates[i]` with `choices` → compare
`facts` (ignoring `sourceRows`, missing = 0, tolerance 0.005) with the truth. For cases files,
use `choices.asOfDate` (2026-09-30) or compare only months in `months`; see below.

Templates reference columns by their **normalized header** (lowercase, trimmed, whitespace
collapsed), as `pipeline.ts` specifies. They use a `replace` step (whole cell,
case-insensitive) for `Postnord` → `PostNord AB` so they work without a database; in the app the
same is done by a `lookup` on `kund` with the alias from `aliases`.

## Rules shared by all files

- Rows the intended mapping removes: empty rows, title/meta rows above the header, sum rows
  (`Totalt`, `Summa …`, `Rörelseresultat`, …), footers (`Utskrivet …`, `Sida 1 av 1`), plus the
  explicit filters listed per file. In-file totals include filtered rows and are **not** the truth.
- Personal columns (Konsult/Namn, Personnummer) are mapped `ignore` with `personal: true` and
  `keep: false`; they never reach a fact.
- Swedish numbers appear as `7,5`, `8,25 h`, `12 345,50 kr` (space or NBSP thousands), `4 500,00`.
- Dates appear as date-formatted cells, ISO text `2026-09-14` and Intelliplan's `30/9 2026`
  (day/month, never month/day).

## Cases rules (konsultlista and Workbuster deltagare)

Evaluated per company × group at each month's **last day ME**:

| Metric                                                   | Counted when                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| active (`anstallda_konsulter`, `aktiva_deltagare`)       | start ≤ ME and (end empty or end ≥ ME) and not interrupted on or before ME                                             |
| started (`nyanstallda`, `nya_deltagare`)                 | start date in the month                                                                                                |
| ended (`avslutade_anstallningar`, `avslutade_deltagare`) | end date (Slutdatum) in the month, interrupted or not                                                                  |
| interrupted (`avbrott_deltagare`)                        | Avbrott is truthy and Slutdatum in the month (the interruption date is Slutdatum; there is no separate column)         |
| results (`resultat_deltagare`)                           | Resultat maps to Arbete/Studier and Resultatdatum (or, when empty, Slutdatum) is in the month; extra dim `resultattyp` |
| tenure (`anstallningstid`)                               | mean over active cases of (ME − start) in days ÷ (365.25 / 12)                                                         |

Consequences the files exercise on purpose: a case ending exactly on ME is still active at ME
and also counts as ended that month; an interrupted case ending on ME is **not** active at ME;
a case starting on ME is active (tenure 0) and started. Rows with the same key (Anställnings id
or GEN-nummer) **and** the same start date count once; the same id with another start date is a
second employment (rehire) and counts separately. Truth months end at **2026-09** (the last
complete month): pass `asOfDate: "2026-09-30"`, or compare only the truth months if the app
uses the export date (which would add a partial October).

## Files

### 1. `intelliplan_timmar_MBAB_2026-09.xlsx`, `…_2026-08.xlsx` → `ip_timmar`

Sheet `Tidrapport`. Rows 1–3: title (merged `A1:H1`), `Period: 2026-09-01 - 2026-09-30`,
`Miljonbemanning AB` + `Org.nr: 556959-9318` (C3). Header on **row 4**:
`Kund | Uppdrag | Anställnings id | Konsult | Personnummer | Datum | Timmar | Status`. One row
per shift (~420), sorted by customer with an empty row between customers, then an empty row,
`Totalt` (sum of every listed row), an empty row and the footer `Utskrivet 2026-10-01 08:12` …
`Sida 1 av 1` (H). August is the same report for 2026-08 (printed `2026-09-01 07:55`).

Mess: hours as numbers, `7,5` or `8,25 h`; dates as date cells, `30/9 2026` or ISO text;
Anställnings id sometimes text; customers `Postnord` (uppdrag 5702) and `PostNord AB` (5701)
are one customer; test customer `Miljonbemanning Presentation (Stockholm)`; 10 unstaffed rows
(`Okänd arbetstagare`, no id, no personnummer, status `Obemannad`, planned hours filled in); 6
cancelled rows (status `Makulerad`).

Intended mapping (template `Intelliplan – timmar (fixture)`):

| Column          | Type  | Usage            | Metric / dimension |
| --------------- | ----- | ---------------- | ------------------ |
| kund            | text  | dimension        | `kund`             |
| uppdrag         | text  | dimension        | `uppdrag`          |
| anställnings id | text  | dimension        | `konsult`          |
| konsult         | text  | ignore, personal |                    |
| personnummer    | text  | ignore, personal |                    |
| datum           | date  | period           |                    |
| timmar          | hours | measure          | `timmar`           |
| status          | text  | ignore           |                    |
| verksamhet      | text  | dimension        | `verksamhet`       |

Steps, in order: `filter kund equals "Miljonbemanning Presentation (Stockholm)"` ·
`filter anställnings id empty` (unstaffed shifts are **excluded**: no pass, no hours) ·
`filter status equals "Makulerad"` · `clean timmar as hours` · `replace kund "Postnord" →
"PostNord AB"` (whole cell) · `constant verksamhet = "Bemanning"`. Counter: `pass` =
`count_rows`. Period: column `datum` (every date is in the file's month, so `per_upload` with
the month gives the same result). Company: fixed `MBAB`.

Truth: `timmar` = Σ hours, `pass` = number of remaining rows, per kund × uppdrag × konsult ×
verksamhet.

### 2. `intelliplan_timmar_MBAB_2026-09_andrad.xlsx` → `ip_timmar` (drift)

The September data after a report change: `Timmar` is renamed `Antal timmar` and `Avdelning`
is inserted after `Uppdrag` (merge `A1:I1`). Against the v1 signature: removed `timmar`, added
`avdelning` and `antal timmar`, so the signature is **not compatible** (`drift.compatible:
false`). `drift.renamed` is the rename a person sees (`timmar` → `antal timmar`); a
similarity-based detector may report it only as removed + added (the ingest engine at the time
of writing does), so tests should require `added`, `removed` and `compatible` and treat
`renamed` as a hint. Template v2 starts with `rename antal timmar → timmar` and maps
`avdelning` as ignore; everything else is v1. Truth: identical to the September file.

### 3. `intelliplan_timmar_MBAB_2026-09_utf16.csv` → `ip_timmar`

The September rows as UTF-16LE text with BOM (`FF FE`), tab-separated, CRLF, header on line 1,
no title/total/footer, every value text (`7,5`, `8,25 h`, `30/9 2026`). Same template v1,
identical truth.

### 4. `intelliplan_franvaro_MBAB_2026-09.csv` → `ip_franvaro`

Windows-1252, `;`-separated, CRLF, header line 1:
`Kund;Anställnings id;Konsult;Datum;Frånvaroorsak;Timmar`. Konsult quoted as
`"Efternamn, Förnamn"`, hours `8,00`/`7,50`, dates ISO. Causes `SJUK LO`, `SJUK UNI`,
`Olovlig frånvaro`.

Mapping: kund → `kund`, anställnings id → `konsult`, konsult ignore/personal, datum → period,
frånvaroorsak → `franvarotyp`, timmar → measure `sjuktimmar` (hours); counter `sjukpass` =
`count_rows`. Steps: `filter frånvaroorsak equals "Olovlig frånvaro"` (no catalog metric for it)
· `clean timmar as hours` · `replace kund Postnord → PostNord AB`. Company fixed `MBAB`.

Truth: `sjuktimmar` = Σ hours, `sjukpass` = rows, per kund × konsult × franvarotyp.

### 5. `intelliplan_fakturering_MBAB_2026-09.xlsx` → `ip_fakturering`

Sheet `Underlag`: title (merged `A1:F1`), `Period: 2026-09-01 - 2026-09-30`, company line,
empty row, header on **row 5**: `Kund | Anställnings id | Konsult | Timmar | Fakturerat belopp
| Lönekostnad`. Grouped report: the customer name only on a group's first row, then
`Summa <kund>` and an empty row after each group, `Totalt` at the end. Some amounts are text
(`12 345,50 kr`, NBSP or space). The presentation customer has two lines.

Mapping: kund → `kund`, anställnings id → `konsult`, konsult ignore/personal, timmar ignore,
fakturerat belopp → `fakturerat_ip` (amount), lönekostnad → `lonekostnad` (amount). Steps,
**order matters**: `filter kund contains "summa"` · `filter kund equals "totalt"` ·
`fill_down kund` · `filter kund equals "Miljonbemanning Presentation (Stockholm)"` (after the
fill-down, otherwise its second line survives) · `clean` both amounts · `replace kund Postnord →
PostNord AB`. Period: `per_upload` (month 2026-09, from the `Period:` line). Company fixed `MBAB`.

Truth: Σ per kund × konsult. Billing = hours × the uppdrag's rate; wage cost = hours × hourly
wage × 1.47; both rounded to öre per line before summing.

### 6. `intelliplan_konsulter_MBAB.xlsx` → `ip_konsulter` (cases)

Sheet `Konsulter`: title (merged `A1:G1`), company, `Utdrag: 2026-10-01 07:40`, empty row,
header on **row 5**: `Anställnings id | Namn | Personnummer | Anställningsform |
Organisationsenhet | Startdatum | Slutdatum`. One row per employment, 2023-01-09 … 2026-09:
145 people, 5 rehires (same id, later start), 2 exact duplicate rows. Slutdatum empty =
active. Organisationsenhet is `MBAB / <ort>`. Anställningsform uses today's forms
(`Särskild visstidsanställning`, `Tillsvidareanställning`, `Behovsanställning`,
`Provanställning`). Dates as date cells or ISO text.

Mapping: anställnings id → `case_key`, namn/personnummer ignore/personal, anställningsform
ignore, organisationsenhet → dimension `ort` after `replace organisationsenhet contains
"MBAB / " → ""`, startdatum → `case_start`, slutdatum → `case_end`. Cases: groupBy
`organisationsenhet`, metrics active `anstallda_konsulter`, started `nyanstallda`, ended
`avslutade_anstallningar`, tenureMonths `anstallningstid`, fromMonth `2023-01`. Company fixed
`MBAB`, asOfDate `2026-09-30`.

Truth: months 2023-01 … 2026-09 by `ort` (Södertälje, Stockholm, Kungsängen, Uppsala).

### 7. `workbuster_deltagare_MBAB.xlsx`, `workbuster_deltagare_MBR.xlsx` → `wb_deltagare` (cases)

Sheet `Deltagare`: `Export från Workbuster 2026-10-05 06:30`, a selection line, empty row,
header on **row 4**: `GEN-nummer | Namn | Personnummer | Tjänst | Ort | Startdatum | Slutdatum
| Avbrott | Avbrottsorsak | Resultat | Resultatdatum`. MBAB 300 cases (ROM2, KROM, KVL,
Karriärvägledning; Stockholm, Södertälje, Botkyrka, Uppsala), MBR 200 cases (Stöd och
matchning, KROM, ROM2, KVL; Norrköping, Linköping, Stockholm), every case active at some point
since 2025-01-01 (some started in 2024). Avbrott `Ja`/`ja`/`JA` or empty; interrupted cases
have Slutdatum = interruption date and no result. Resultat `Arbete`/`Studier` (sometimes
lowercase) or empty; three results lack Resultatdatum. One case per file starts 2026-10-02
(after the truth window). MBR has one duplicated row.

Mapping: gen-nummer → `case_key`, namn/personnummer ignore/personal, tjänst → dimension
`verksamhet`, ort → `ort`, startdatum/slutdatum → `case_start`/`case_end`, avbrott →
`case_interrupt`, avbrottsorsak ignore, resultat → `case_result` with resultMap
`{ "arbete": "Arbete", "studier": "Studier" }`, resultatdatum → `case_result_date`. Cases:
groupBy `tjänst`, `ort`; metrics active `aktiva_deltagare`, started `nya_deltagare`, ended
`avslutade_deltagare`, interrupted `avbrott_deltagare`, results `resultat_deltagare`; fromMonth
`2025-01`. Company fixed per file; asOfDate `2026-09-30`.

Truth: months 2025-01 … 2026-09 by verksamhet × ort (+ resultattyp for results).

### 8. `workbuster_ordrar_MBAB.xlsx` → `wb_ordrar`

Sheet `Ordrar`: two meta lines (`Exportdatum 2026-10-05`), empty row, header on **row 4**:
`Ordernummer | Tjänst | Ordertyp | Belopp | Datum | Ort`; ~800 orders 2025-01 … 2026-09, some
negative (credits), ~10 % of amounts as text `4 500,00`, ~10 % of dates as ISO text; `Summa`
in Ordernummer on the last row.

Mapping: ordernummer ignore, tjänst → `verksamhet`, ordertyp → `ordertyp`, belopp →
`af_intakt` (amount), datum → period, ort → `ort`. Steps: `filter ordernummer equals "summa"` ·
`clean belopp as amount`. Truth: Σ Belopp (credits included, negative) per month of Datum ×
verksamhet × ordertyp × ort.

### 9. `fortnox_kundforsaljning_MBAB_2026.xlsx` → `fx_kundforsaljning`

Sheet `Kundfakturor`: title, company, `Fakturadatum 2026-01-01 – 2026-09-30`, empty row,
header on **row 5**: `Fakturanr | Kundnr | Kund | Fakturadatum | Förfallodatum | Belopp exkl.
moms | Moms | Totalt`. ~165 invoices incl. 6 credit notes (negative), two customer records for
PostNord (`PostNord AB` 1007, `Postnord` 1008), `Arbetsförmedlingen` as a customer, `Summa`
row last.

Mapping: kund → `kund`, fakturadatum → period, belopp exkl. moms → `fakturerat_kund`; the
rest ignore. Steps: `filter fakturanr equals "summa"` · `replace kund Postnord → PostNord AB`.
Truth: Σ Belopp exkl. moms per month of Fakturadatum × kund.

### 10. `budget_2026.xlsx` → `budget` (scenario **budget**)

Sheets `MB AB` (→ MBAB) and `MB Restart` (→ MBR). Title (merged `A1:N1`), company,
`Belopp i kronor, kostnader med minustecken`, empty row, header on **row 5**:
`Post | Jan | Feb | Mar | Apr | Maj | Jun | Jul | Aug | Sep | Okt | Nov | Dec | Helår`. Rows:
Intäkter, Varor och underleverantörer, Övriga externa kostnader, Personalkostnader,
Avskrivningar, `Rörelseresultat` (formula sum row), empty row, Finansiella poster,
`Resultat efter finansiella poster` (formula). Helår is a `SUM` formula with cached values.
Revenue is positive; costs and the net financial cost are negative.

Mapping (one template per sheet, `sheetHint` = sheet name, company fixed): steps
`filter post equals "Rörelseresultat"` · `filter post equals "Resultat efter finansiella
poster"` · `drop helår` · `unpivot jan … dec → månad, belopp` · `constant år = "2026"` ·
`merge månad + år (" ") → period` (`"jan 2026"`) · `negate belopp` · six `replace post`
(whole cell) label → group key (`Intäkter` → `intakter`, …, `Finansiella poster` →
`finansiella`; alternatively a `lookup` on `kontogrupp` with `aliases`). Columns: post →
dimension `kontogrupp`, period → period, belopp → measure `budget_belopp` (amount).

Truth: 2 companies × 12 months × 6 groups = 144 facts, `value = −(cell)`, i.e. **ledger (SIE)
sign**: revenue negative, costs positive, net financial cost positive — the same convention as
`LedgerRow.amount`, so budget × account-group sign gives the presentation value exactly like
actuals, and `kostnader`/`resultat` budgets can be derived by range like the ledger. A
column-wide step cannot produce "revenue and costs both positive" from this layout, because
only the cost rows would need flipping.

**Open cross-module decision.** The budget readers in `src/lib/db/repo/metrics.ts` (module C)
and `src/lib/metrics/memory-source.ts` (module E) currently assume budget amounts are already in
presentation sign and apply no account-group sign. With this file and this truth, the revenue
and financial-net budgets would then show with the wrong sign (the four cost groups match only
because their sign is +1), and the `kostnader`/`resultat` budgets would be missing because the
file has no rows for them. Either those readers multiply `budget_belopp` by the account group's
sign and derive the range groups (as `ledger_monthly` does for actuals; recommended, one sign
convention for everything ledger-like), or the step contract gains a row-conditional negate.
Until then an end-to-end budget-vs-actual test over this file fails on purpose.

### 11. `intelliplan_kundlista.xls` (reference, no facts)

An "Excel" file that is an HTML table (UTF-8, CRLF, `&ouml;`-style entities, `&nbsp;` padding,
`x:num`): `Kundnummer | Kundnamn | Arbetsställe`, 11 rows, 9 customer numbers, including
`1008 Postnord` beside `1007 PostNord AB` and the presentation customer. It feeds the `kund`
aliases; the truth is `[]`.
