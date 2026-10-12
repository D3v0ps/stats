"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/db/client-browser";
import { formatNumber } from "@/lib/core/format-sv";
import {
  MIN_PASSWORD_LENGTH,
  newPasswordIssue,
  passwordChangeError,
} from "@/lib/settings-ui/password";
import { Field, SettingsCard, describedBy } from "./ui";

/**
 * Changes the shared password with supabase.auth.updateUser in the browser (the user's own
 * session, no service role). Nothing about the login e-mail is shown.
 */
export function PasswordForm() {
  const id = useId();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const issue = newPasswordIssue(password, repeat);
  const newError = submitted && issue?.field === "new" ? issue.message : null;
  const repeatError = submitted && issue?.field === "repeat" ? issue.message : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (issue) return;
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) {
          toast.error(passwordChangeError(authError));
          return;
        }
        setPassword("");
        setRepeat("");
        setSubmitted(false);
        toast.success(
          "Lösenordet är bytt. Nästa inloggning, på alla enheter, görs med det nya lösenordet.",
        );
      } catch (e) {
        toast.error(passwordChangeError(e));
      }
    });
  }

  return (
    <SettingsCard className="max-w-2xl">
      <form
        className="flex flex-col gap-5"
        onSubmit={submit}
        noValidate
        data-testid="password-form"
      >
        <Field
          id={`${id}-new`}
          label="Nytt lösenord"
          error={newError}
          hint={`Minst ${formatNumber(MIN_PASSWORD_LENGTH)} tecken. En mening med flera ord är lätt att komma ihåg och svår att gissa. (${formatNumber(password.length)} tecken)`}
        >
          <div className="flex gap-2">
            <Input
              id={`${id}-new`}
              type={visible ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              aria-invalid={newError ? true : undefined}
              aria-describedby={describedBy(`${id}-new`, { hint: true, error: newError })}
              data-testid="password-new"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? "Dölj lösenorden" : "Visa lösenorden"}
              aria-pressed={visible}
            >
              {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </div>
        </Field>
        <Field id={`${id}-repeat`} label="Upprepa nytt lösenord" error={repeatError}>
          <Input
            id={`${id}-repeat`}
            type={visible ? "text" : "password"}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            required
            aria-invalid={repeatError ? true : undefined}
            aria-describedby={describedBy(`${id}-repeat`, { error: repeatError })}
            data-testid="password-repeat"
          />
        </Field>
        <div>
          <Button type="submit" disabled={pending} data-testid="password-save">
            {pending ? "Byter…" : "Byt lösenord"}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
