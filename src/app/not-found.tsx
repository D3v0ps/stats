import Link from "next/link";
import { Heading } from "@/components/brand/Heading";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Unknown URLs and notFound(): a calm Swedish 404 with one way back. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16 text-foreground">
      <section
        aria-labelledby="not-found-title"
        className="w-full max-w-lg rounded-card bg-card p-8 shadow-soft md:p-12"
      >
        <p className="mb-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Fel 404
        </p>
        <Heading id="not-found-title" level={1} accent="dot">
          Sidan finns inte
        </Heading>
        <p className="mt-4 text-sm text-pretty text-muted-foreground">
          Adressen kan vara felstavad, eller så har sidan flyttats eller tagits bort.
        </p>
        <Link
          href="/"
          data-testid="not-found-home"
          className={cn(buttonVariants({ size: "lg" }), "mt-8 px-4")}
        >
          Till Översikt
        </Link>
      </section>
    </main>
  );
}
