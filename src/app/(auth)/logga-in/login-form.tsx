"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "../actions";
import { INITIAL_LOGIN_STATE, PASSWORD_MAX_LENGTH } from "../login-state";

/** One password field, one button. No e-mail, sign-up or reset by design. */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, INITIAL_LOGIN_STATE);
  const hasError = state.error !== null;

  return (
    <form action={formAction} className="flex w-full flex-col gap-5" aria-busy={pending}>
      <div className="flex flex-col gap-2">
        <Label
          htmlFor="password"
          className="text-xs font-medium tracking-[0.08em] text-antracit-100 uppercase"
        >
          Lösenord
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          autoFocus
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? "login-error" : undefined}
          className="h-12 rounded-xl border-antracit-200 bg-antracit-300/40 px-4 text-base text-white placeholder:text-antracit-100 focus-visible:border-bla focus-visible:ring-bla/50 aria-invalid:border-rod aria-invalid:ring-rod/30"
        />
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="h-12 rounded-xl bg-white text-sm font-semibold tracking-[0.08em] text-antracit uppercase hover:bg-ljusgra-100 focus-visible:ring-bla/60"
      >
        {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
        Logga in
      </Button>
      <p
        id="login-error"
        role="alert"
        className={hasError ? "border-l-2 border-rod pl-3 text-sm text-white" : "sr-only"}
      >
        {state.error}
      </p>
    </form>
  );
}
