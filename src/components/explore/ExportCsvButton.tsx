"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CSV_MIME } from "@/lib/dashboard/csv";

/** Downloads the table as CSV (built on the server: semicolons, decimal comma, UTF-8 BOM). */
export function ExportCsvButton({ csv, fileName }: { csv: string; fileName: string }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: CSV_MIME }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking in the same task can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={download}
      data-testid="export-csv"
      className="text-muted-foreground"
    >
      <Download aria-hidden="true" />
      Exportera CSV
    </Button>
  );
}
