"use client";

import Link from "next/link";
import { Heading } from "@/components/brand/Heading";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Error boundary for every page under the root layout. Shows Swedish text and, when there is
 * one, the error's digest (to match the server log); never the message or a stack trace.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16 text-foreground">
      <section
        role="alert"
        aria-labelledby="error-title"
        className="w-full max-w-lg rounded-card bg-card p-8 shadow-soft md:p-12"
      >
        <Heading id="error-title" level={1} accent="dot">
          Något gick fel
        </Heading>
        <p className="mt-4 text-sm text-pretty text-muted-foreground">
          Sidan kunde inte visas just nu. Försök igen om en stund. Om felet finns kvar, gå till
          Översikt och börja om därifrån.
        </p>
        {error.digest ? (
          <p className="num mt-3 text-xs text-muted-foreground">Felkod: {error.digest}</p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" className="px-4" onClick={() => retry()} data-testid="error-retry">
            Försök igen
          </Button>
          <Link
            href="/"
            data-testid="error-home"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-4")}
          >
            Till Översikt
          </Link>
        </div>
      </section>
    </main>
  );
}
