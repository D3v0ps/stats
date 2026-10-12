import type { Metadata } from "next";
import { connection } from "next/server";
import { Logo } from "@/components/brand/Logo";
import { checkServerEnv } from "@/lib/db/env";
import { loginNotice } from "../login-security";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logga in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read the environment per request: a build without variables must not bake in the notice.
  await connection();
  const env = checkServerEnv();
  const notice = loginNotice(await searchParams);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-antracit px-4 py-16 text-white">
      <div className="flex w-full max-w-sm flex-col items-center gap-12">
        <Logo variant="white" size="lg" eager />
        <h1 className="sr-only">Logga in på MB Stats</h1>
        {notice ? (
          <p role="status" className="w-full border-l-2 border-rod pl-4 text-sm text-white">
            {notice}
          </p>
        ) : null}
        {env.ok ? (
          <LoginForm />
        ) : (
          <div
            role="status"
            className="w-full border-l-2 border-rod pl-4 text-sm text-antracit-100"
          >
            <p className="mb-2 font-medium tracking-[0.08em] text-white uppercase">
              Konfiguration saknas
            </p>
            <p>{env.message}</p>
          </div>
        )}
      </div>
    </main>
  );
}
