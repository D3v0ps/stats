// The environment of the app server the e2e run builds and starts. Next loads .env files only
// for keys the process environment leaves undefined, so every variable the app reads (the ones
// .env.example lists) is set here and a .env.local, which may hold the hosted project, can fill
// none of them. An empty CRON_SECRET counts as set.
import { E2E_LOGIN_EMAIL, type LocalSupabase } from "./local-supabase";

export function serverEnv(supabase: LocalSupabase): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: supabase.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
    SUPABASE_SECRET_KEY: supabase.secretKey,
    STATS_LOGIN_EMAIL: E2E_LOGIN_EMAIL,
    CRON_SECRET: "",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
