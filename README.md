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
upp exempelfilerna i `fixtures/` genom uppladdningssidan, publicerar dem och kontrollerar sedan
översikten, Utforska och inloggningen. Den rör aldrig det driftsatta projektet: både appens adress
och Supabase-adresserna måste peka på den egna datorn (127.0.0.1, localhost eller ::1), annars
avbryts körningen innan något händer.

**Förutsättningar**

- Docker
- Supabase CLI 2.120 eller senare (`db query` behövs), på `PATH` eller angiven med `SUPABASE_CLI`
- Den lokala stacken igång: `supabase start` i repots rot (db, auth, rest och kong räcker)

**Köra**

```bash
pnpm e2e                                    # alla projekt
pnpm e2e --project=seed --project=laptop    # uppladdningarna och en skärmstorlek
```

Projekten körs i ordning: `seed` publicerar exempelfilerna, `projektor`, `laptop` och `mobil`
läser dem i tre skärmstorlekar, och `sist` byter lösenordet fram och tillbaka och loggar ut alla
enheter.

**Vad varje körning gör**

- Bygger om `.next` med den lokala stackens värden (`pnpm build && pnpm start`). Kör
  `pnpm build` igen innan du startar appen mot en annan miljö.
- Nollställer den lokala databasen med `supabase db reset --local`: all uppladdad data, alla
  mallar och användare försvinner och migreringarna körs om.
- Tömmer spärren för inloggningsförsök och skapar användaren `e2e@mbstats.test` med ett nytt
  slumpat lösenord. Lösenordet sparas inte någonstans.
- Läser nycklarna från `supabase status`. Inga nycklar finns i repot, och `.env.local` används inte.

**Variabler (valfria)**

- `SUPABASE_CLI`: sökväg till Supabase CLI om den inte ligger på `PATH`.
- `E2E_PORT`: porten för appen (standard 3100).
- `E2E_BASE_URL`: en redan startad app på den egna datorn. Den måste vara byggd och startad med
  den lokala stackens värden och `STATS_LOGIN_EMAIL=e2e@mbstats.test`.
- `E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_SECRET_KEY`,
  `E2E_SUPABASE_DB_URL`: alla fyra i stället för `supabase status`. Supabase CLI behövs ändå för
  att nollställa databasen och tömma spärren för inloggningsförsök.
- `E2E_SKIP_DB_RESET=1`: hoppar över nollställningen, till exempel för att köra om bara läsande
  tester med `--no-deps`. Uppladdningstesterna kräver en nollställd databas.
