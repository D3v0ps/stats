// Service-role access to the LOCAL stack for setup: the e2e login user and its allowlist row.
// src/lib/db/admin.ts cannot be reused here because it imports "server-only".
import { createClient, isAuthApiError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { LocalSupabase } from "./local-supabase";

export type AdminClient = SupabaseClient<Database>;

export function createE2eAdminClient(env: LocalSupabase): AdminClient {
  return createClient<Database>(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function findUserId(admin: AdminClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Could not list Auth users (${error.code ?? error.name}).`);
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error("The e2e user exists but could not be found.");
  return user.id;
}

export async function setLoginPassword(admin: AdminClient, userId: string, password: string) {
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(`Could not set the e2e password (${error.code ?? error.name}).`);
}

/**
 * Creates the confirmed login user, or gives an existing one (a run without reset) the new
 * password, which also repairs a run that changed the password and crashed. Returns its id.
 */
export async function ensureLoginUser(
  admin: AdminClient,
  email: string,
  password: string,
): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error) return created.data.user.id;
  if (!isAuthApiError(created.error) || created.error.code !== "email_exists") {
    throw new Error(`Could not create the e2e user (${created.error.code ?? created.error.name}).`);
  }
  const userId = await findUserId(admin, email);
  await setLoginPassword(admin, userId, password);
  return userId;
}

/** Every RPC checks public.app_users, so the user must be on the allowlist to see any data. */
export async function allowlistUser(admin: AdminClient, userId: string) {
  const { error } = await admin.from("app_users").upsert({ user_id: userId });
  if (error) throw new Error(`Could not allowlist the e2e user (${error.code}).`);
}
