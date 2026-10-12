"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button
      type="button"
      size="lg"
      className="gap-2"
      onClick={() => window.print()}
      data-testid="print-button"
    >
      <Printer aria-hidden="true" />
      Skriv ut eller spara som PDF
    </Button>
  );
}
