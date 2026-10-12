# Avstämning mot originalfilerna (`reconcile.py`)

Ett fristående Python-skript som räknar om totalerna **direkt ur originalfilen** och jämför dem
med det appen har räknat fram. Skriptet delar ingen kod med appen (inga importer från
`src/lib`), har en egen liten konfiguration per filtyp och egna läsare för xlsx, csv och
HTML-"xls". Stämmer två oberoende uträkningar överens är siffrorna rätt; gör de inte det visar
tabellen exakt var (mått × bolag × månad × grupp).

## Krav

Python 3.10+ med `pandas` och `openpyxl` (`pip install pandas openpyxl`). `xlrd` behövs bara för
riktiga gamla binära .xls-filer; Intelliplans ".xls" är oftast HTML och läses utan.

## Snabbstart

```bash
python3 scripts/reconcile/reconcile.py --selftest     # stämmer av alla fixtures mot facit

python3 scripts/reconcile/reconcile.py \
  --config scripts/reconcile/configs/intelliplan_timmar.json \
  --file "$HOME/OneDrive/Dokument/MB Puls/exempeldata/intelliplan_timmar_MBAB_2026-09.xlsx" \
  --app "$HOME/Downloads/app_timmar_2026-09.json" \
  --dim kund
```

Utskriften visar först vad som lästes ur filen (blad, rubrikrad, datarader, hur många rader som
hoppades över som summarader/sidfot och hur många som filtrerades bort och varför), sedan en
tabell med avvikelserna:

```
Mått/Metric  Bolag/Company  Månad/Month  Grupp/Group   Fil/File     App   Diff
timmar       MBAB           2026-09      PostNord AB     540,75  548,75     -8
AVVIKELSER / DIFFERENCES: 1 av / of 14
```

Slutkod 0 = inga avvikelser, 1 = avvikelser, 2 = fel (filen saknas eller gick inte att läsa,
kolumn saknas, ofullständig konfiguration, okänd budgetrad …). Ett fel ger aldrig slutkod 1, så
ett skript som kör avstämningen kan lita på att 1 betyder "siffrorna skiljer sig".

CSV-filer: avgränsaren gissas från de rader som delas upp likadant (titelrader ovanför rubriken
stör inte), och Excels `sep=;`-rad överst används om den finns.

| Flagga                       | Betydelse                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `--tolerance`                | tillåten skillnad per rad (standard 0,01)                                           |
| `--dim <nyckel>`             | jämför även per dimension (`kund`, `ort`, `verksamhet` …) eller `all` (alla dims)   |
| `--company`                  | bolag när filnamnet inte innehåller `_MBAB_`/`_MBR_` (budgetens blad behåller sina) |
| `--month`                    | månad för filer utan datumkolumn (t.ex. fakturaunderlaget)                          |
| `--from-month`, `--to-month` | jämför bara dessa månader (och styr månadsintervallet för deltagar-/konsultlistor)  |
| `--all`                      | visa alla rader, inte bara avvikelserna                                             |

## Så stäms Karims riktiga filer av

1. **Lägg filerna utanför repot**, t.ex. i OneDrive `Dokument/MB Puls/exempeldata/`. Riktiga
   filer innehåller personuppgifter och får aldrig checkas in (mappen `/exempeldata/` är
   gitignorerad om den ändå hamnar i repot).
2. **Välj konfiguration** i `configs/` efter filtyp:

   | Fil                                    | Konfiguration                  |
   | -------------------------------------- | ------------------------------ |
   | Intelliplan timmar (xlsx eller csv)    | `intelliplan_timmar.json`      |
   | Intelliplan frånvaro                   | `intelliplan_franvaro.json`    |
   | Intelliplan fakturerings-/löneunderlag | `intelliplan_fakturering.json` |
   | Intelliplan konsultlista               | `intelliplan_konsulter.json`   |
   | Workbuster deltagare                   | `workbuster_deltagare.json`    |
   | Workbuster ordrar                      | `workbuster_ordrar.json`       |
   | Fortnox kundfakturor                   | `fortnox_kundforsaljning.json` |
   | Budget (brett format)                  | `budget.json`                  |

3. **Anpassa kopian om den riktiga filen ser annorlunda ut.** Kopiera konfigurationen (t.ex. till
   `configs/karim_timmar.json`) och ändra bara det som skiljer:
   - `header`: några rubriker som måste finnas på rubrikraden (skriftläge och mellanslag spelar
     ingen roll).
   - `columns`: logiskt namn → möjliga rubriker. Byter Intelliplan namn på en kolumn lägger man
     till det nya namnet i listan (så hanteras `Timmar`/`Antal timmar`).
   - `skip`: rader som inte är data (summarader, sidfot), som reguljära uttryck.
   - `exclude`: rader som ska bort enligt mappningen (testkunden, obemannade pass, makulerat).
     Ska vara samma regler som i appens mall – annars jämför man äpplen och päron.
   - `aliases`: stavningsvarianter → kanoniskt namn (`Postnord` → `PostNord AB`).
   - `period`: `{"column": "datum"}`, `{"meta_regex": "..."}` (ur rubrikraderna),
     `{"filename_regex": "..."}` eller `{"fixed": "2026-09"}`.
   - `company`: `{"filename_regex": "_(MBAB|MBR)[_.]"}` eller `{"fixed": "MBAB"}`.
   - deltagar-/konsultlistor (`kind: "cases"`): `cases.from_month` och `cases.to_month`
     (standard: månaden före exportdatumet i filens metarad).
   - budget (`kind: "wide"`): bladnamn → bolag i `sheets`, radnamn → kontogrupp i `wide.rows`,
     summarader i `wide.ignore_rows`. En okänd rad ger fel i stället för att tyst försvinna.
4. **Hämta appens siffror som JSON** i samma form som `fixtures/truth` (en lista med
   `{metricKey, company, month, dims, value}`; en hel `IngestResult` med `facts` går också).
   Tills appen har en exportknapp: kör frågan nedan i Supabase SQL-editorn med uppladdningens
   id (syns i uppladdningshistoriken), kopiera resultatcellen och spara som `app.json`.

   ```sql
   select coalesce(jsonb_agg(fact order by fact->>'metricKey', fact->>'month'), '[]'::jsonb)
   from (
     select jsonb_build_object(
       'metricKey', m.key,
       'company', c.code,
       'month', to_char(mv.month, 'YYYY-MM'),
       'dims', coalesce((
         select jsonb_object_agg(d.key, case when d.key = 'kontogrupp' then dv.code else dv.label end)
         from jsonb_each_text(mv.dims) as e(dim_key, value_id)
         join public.dimensions d on d.key = e.dim_key
         join public.dimension_values dv on dv.id = e.value_id::bigint
       ), '{}'::jsonb),
       'value', mv.value
     ) as fact
     from public.metric_values mv
     join public.metrics m on m.id = mv.metric_id
     join public.companies c on c.id = mv.company_id
     where mv.upload_id = '00000000-0000-0000-0000-000000000000'  -- uppladdningens id
   ) facts;
   ```

5. **Kör skriptet**, först på totalnivå (bolag × månad), sedan med `--dim` för den dimension
   som avviker. Avvikelser betyder nästan alltid något av: en rad som borde filtrerats (eller
   inte), en stavningsvariant som saknar alias, en summarad som räknats som data, ett tal eller
   datum som tolkats fel, eller fel månad/bolag vid uppladdningen.
6. **Spara inte utskriften** med `--dim konsult` någonstans där andra kan se den: den visar
   anställnings-id. Skriptet skriver aldrig ut namn eller personnummer.

## Regler som skriptet räknar med

Samma som i `fixtures/README.md`: summa per bolag × månad × dimension för vanliga tabeller;
antal rader för räknare (pass, sjukpass); deltagare och anställningar räknas vid månadens sista
dag (aktiv om start ≤ månadsslut och slut tomt eller ≥ månadsslut, men inte om avbrottet skett
senast den dagen); anställningstid vägs med antalet aktiva när den summeras över grupper;
budgeten vänds i tecken (`negate`) så att den får bokföringens tecken (intäkter negativa,
kostnader positiva).

## Självtest

`--selftest` räknar om varje fil i `fixtures/files` med sin konfiguration och jämför med
`fixtures/truth` på totalnivå, per dimension och per hel dimensionskombination. Den kontrollerar
också att avsiktliga fel i facit (ett värde +1, en saknad rad, fel grupp) faktiskt upptäcks, och
att varje fixture har ett testfall. Körs före varje commit som rör fixtures eller skriptet.
