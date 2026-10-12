// Supabase client for Client Components. The session lives in cookies (shared with the server)
// and @supabase/ssr reuses one client per browser tab.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "./env";

export function createSupabaseBrowserClient(): SupabaseClient {
  const env = getPublicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
}
