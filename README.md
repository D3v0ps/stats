# MB Stats

Statistik- och styrelsedashboard för Miljonbemanning AB och Miljonbemanning Restart AB.
Under uppbyggnad (fas 1). Lathund och driftinstruktioner skrivs när fas 1 är klar.

- Teknisk översikt: [`docs/architecture.md`](docs/architecture.md)
- Exempelfiler från Cowork: [`docs/cowork-exempeldata.md`](docs/cowork-exempeldata.md)

```bash
pnpm install
pnpm verify   # typer, lint, tester, bygge
pnpm dev
```

## Tester från början till slut

Playwright-sviten i `e2e/` kör appen i en riktig webbläsare mot en **lokal** Supabase. Den laddar
upp exempelfilerna i `fixtures/` genom uppladdningssidan, publicerar dem, ångrar en publicering i
Historik och kontrollerar sedan översikten, Utforska och inloggningen. Den rör aldrig det
driftsatta projektet: sviten bygger och startar appen själv med den lokala stackens värden, och
Supabase-adressen måste peka på den egna datorn (127.0.0.1, localhost eller ::1), annars avbryts
körningen innan något händer.

**Förutsättningar**

- Docker
- Supabase CLI 2.120 eller senare (`db query` behövs), på `PATH` eller angiven med `SUPABASE_CLI`
- Den lokala stacken igång: `supabase start` i repots rot (db, auth, rest och kong räcker)

**Köra**

```bash
pnpm e2e                     # alla projekt
pnpm e2e --project=laptop    # uppladdningarna (seed-*) och en skärmstorlek
```

Projekten körs i ordning. `seed-a` till `seed-e` publicerar exempelfilerna genom
uppladdningssidan och bygger på varandra, så ett steg som misslyckas hoppar över stegen efter.
`projektor`, `laptop` och `mobil` läser datan i tre skärmstorlekar, och `sist` byter lösenordet
fram och tillbaka och loggar ut alla enheter. Tester märkta `@once` ändrar data (rapporter,
inställningar, spärren) och körs bara i `laptop`.

**Kontroller på varje sida**

- Varje test misslyckas om webbläsaren rapporterar ett brott mot Content-Security-Policy, i alla
  fönster testet öppnar. `e2e/csp.spec.ts` kontrollerar dessutom att varje `<script>` i sidans
  HTML har svarets nonce.
- `e2e/visual.spec.ts` går igenom varje sida och några lägen (diagramtips, öppen lista, dialog,
  toast, mobilmenyn) i alla tre storlekar. Den underkänner sidor som är bredare än fönstret och
  färger utanför varumärkets palett (`src/components/brand/tokens.ts`), och bifogar en
  skärmbild per vy i `test-results/`.
- `e2e/personal-data.spec.ts` kontrollerar att inga namn eller personnummer från exempelfilerna
  och inga konsultvärden syns i presentationer, frysta rapporter, talarmanus eller utskrifter.
- Frysta rapporter kan aldrig tas bort, så de ligger kvar i den lokala databasen till nästa
  nollställning.

**Vad varje körning gör**

- Bygger om `.next` med den lokala stackens värden (`pnpm build && pnpm start`). Kör
  `pnpm build` igen innan du startar appen mot en annan miljö.
- Nollställer den lokala databasen med `supabase db reset --local`: all uppladdad data, alla
  mallar och användare försvinner och migreringarna körs om.
- Tömmer spärren för inloggningsförsök och skapar användaren `e2e@mbstats.test` med ett nytt
  slumpat lösenord. Lösenordet hamnar bara i spårningen (`test-results/`) när ett test
  misslyckas, och det byts vid nästa körning.
- Läser nycklarna från `supabase status`. Inga nycklar finns i repot, och `.env.local` används inte.

**Variabler (valfria)**

- `SUPABASE_CLI`: sökväg till Supabase CLI om den inte ligger på `PATH`.
- `E2E_PORT`: porten för appen (standard 3100).
- `E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_SECRET_KEY`: alla tre i
  stället för `supabase status`. De måste gälla samma stack som Supabase CLI startar från repots
  `supabase/config.toml`, eftersom CLI:n nollställer databasen och tömmer spärren för
  inloggningsförsök.
- `E2E_SKIP_DB_RESET=1`: hoppar över nollställningen, till exempel för att köra om bara läsande
  tester med `--no-deps`. Uppladdningstesterna kräver en nollställd databas.
