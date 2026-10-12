// Supabase client for Server Components, Server Actions and Route Handlers. Create one per
// request; never share it. RLS applies (the user's JWT is used, not the service role).
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "./env";

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  // cookies() first: it opts the route into dynamic rendering before the environment is read,
  // so builds without Supabase variables never try to prerender authenticated pages.
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; src/proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
