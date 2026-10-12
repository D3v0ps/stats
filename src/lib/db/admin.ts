import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv, getSecretKey } from "./env";

/**
 * Service-role client (bypasses RLS). Only for the login throttle RPCs (login_gate,
 * login_record), which only service_role may execute. Returns null when SUPABASE_SECRET_KEY is
 * not configured. Never pass the client, its key or its raw results to the browser.
 */
export function createAdminClient(): SupabaseClient | null {
  const secretKey = getSecretKey();
  if (!secretKey) return null;
  const env = getPublicEnv();
  return createClient(env.supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
