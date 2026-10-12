// Supabase client for Client Components. The session lives in cookies (shared with the server)
// and @supabase/ssr reuses one client per browser tab.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getPublicEnv } from "./env";

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const env = getPublicEnv();
  return createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey);
}
