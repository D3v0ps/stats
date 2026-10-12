import Link from "next/link";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";

export interface DeckMessageProps {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}

/** Full-screen message in the presentation theme (empty report, report that cannot resolve). */
export function DeckMessage({ title, description, backHref, backLabel }: DeckMessageProps) {
  return (
    <main
      data-testid="deck-message"
      className="theme-present fixed inset-0 grid place-items-center overflow-auto px-6 py-10"
    >
      <div className="flex max-w-xl flex-col items-start gap-5">
        <Heading level={1} accent="dot">
          {title}
        </Heading>
        <p className="text-base text-pretty text-muted-foreground md:text-lg">{description}</p>
        <Button asChild variant="outline" size="lg">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </div>
    </main>
  );
}
