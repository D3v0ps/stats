# MB Stats – conventions

Statistics and board dashboard for Miljonbemanning AB (MBAB) and Miljonbemanning Restart AB (MBR).
Technical contract: `docs/architecture.md`. Shared types: `src/lib/contracts/` (frozen – change only
as a coordinated cross-module change). Seeded catalog: `src/lib/contracts/catalog.ts`.

## Next.js 16 – read before writing Next code

This is Next.js 16.4 with breaking changes vs older versions. Read the relevant guide in
`node_modules/next/dist/docs/` first. Key facts:

- `middleware.ts` is now `src/proxy.ts` exporting `proxy` (Node runtime). Not a security boundary:
  re-check the session in every protected server component/action (`requireSession()`).
- `params`, `searchParams`, `cookies()`, `headers()` are async.
- `cacheComponents` is OFF (see `next.config.ts`); pages render dynamically.
- `next lint` is gone: `pnpm lint` runs the ESLint CLI. Turbopack is the default bundler.

## Commands

- `pnpm verify` = typecheck + lint + unit tests + SQL tests + build. Must pass before every commit.
- `pnpm test` (unit, Vitest), `pnpm test:sql` (PGlite, `supabase/tests`), `pnpm e2e` (Playwright 1.56.1).

## Language and style

- UI text Swedish (å, ä, ö). Code, identifiers, comments, commit messages English.
- Headings uppercase with letter spacing; brand red dot accent ("RESULTAT.").
- Numbers: always via `src/lib/core/format-sv.ts` (never `toLocaleString`). Months via `src/lib/core/month.ts`.
- Match surrounding code; comments explain why, sparingly. No dead code, no TODO without context.
- TypeScript strict with `noUncheckedIndexedAccess`. Validate external input with zod.

## Brand (mandatory)

Palette only: antracit #1E252B (+ #494E52 #8D9093 #C6C8C9), red #FF0C01 (+ #FE5D4A #FF998E #FFCCC6),
light grey #D1D3D3 (+ #D3D6D7 #E4E5E6 #F1F2F3), blue #6BA2B9 (+ #7EACC0 #AECBD7 #D7E5EB), white.
No green anywhere (no `green-*`/`emerald-*` classes). Up/down shown with ▲/▼ and sign, never color alone.
Red only for highlights and large text (contrast); blue only as fill with antracit labels.
Charts: primary series antracit, secondary blue, previous period light grey, red only to highlight.

## Data rules

- All data is monthly. Snapshot metrics are never summed across months.
- Personnummer are always stripped and can never be stored. AF participants: counts only.
- Personal dimensions (konsult) never appear in presentation, frozen reports, PDF or share links.
- No original files stored server-side. Never log file contents or payloads.
- `src/lib/**` (except `src/lib/db`) is pure TS: no DOM, no Next imports.

## Secrets

Never read, print, create or commit secrets. Env vars are listed in `.env.example`; Karim sets values.
