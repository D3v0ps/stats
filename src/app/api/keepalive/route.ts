// Daily keep-alive for the Supabase project. Projects on Supabase's free plan pause after seven
// days without activity; a weekly board meeting could otherwise find the database asleep.
// Vercel Cron calls this route (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { checkPublicEnv } from "@/lib/db/env";
import type { Database } from "@/lib/db/types";
import { isAuthorizedCron } from "./auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const env = checkPublicEnv();
  if (!env.ok) {
    return NextResponse.json(
      { ok: false, error: "Supabase är inte konfigurerat" },
      { status: 503, headers: NO_STORE },
    );
  }
  const supabase = createClient<Database>(env.env.supabaseUrl, env.env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // A trivial SECURITY DEFINER function that anon may execute; it reads no data.
  const { error } = await supabase.rpc("keepalive");
  if (error) return NextResponse.json({ ok: false }, { status: 502, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
