"use client";

import { Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  RetractInputSchema,
  type HistoryRow,
  type HistoryStatus,
} from "@/lib/import-ui/upload-history";
import { cn } from "@/lib/utils";
import { retractUploadAction } from "@/app/(app)/ladda-upp/historik/actions";
import { ImportDialog } from "../ImportDialog";
import { StatusChip } from "../StatusChip";

const TONE: Record<HistoryStatus, "done" | "ready" | "muted" | "error"> = {
  published: "done",
  partly_replaced: "ready",
  replaced: "muted",
  retracted: "muted",
  staged: "muted",
  discarded: "muted",
};

/** Uploads with status and "Ångra publicering" (with a reason). */
export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const [target, setTarget] = useState<HistoryRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    if (!target) return;
    const parsed = RetractInputSchema.safeParse({ uploadId: target.id, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Kontrollera förklaringen.");
      return;
    }
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof retractUploadAction>>;
      try {
        res = await retractUploadAction(parsed.data);
      } catch {
        res = { ok: false, error: "Publiceringen kunde inte ångras. Försök igen." };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`${target.fileName}: ${res.data}`);
      setTarget(null);
      setReason("");
      setError(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <p
          role="status"
          className="rounded-card bg-bla-100 p-4 text-sm"
          data-testid="retract-notice"
        >
          {notice}
        </p>
      ) : null}
      <div className="rounded-card bg-card shadow-soft">
        {/* Columns from xl: beside the sidebar, narrower screens stack the rows instead. */}
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_6rem_7rem_8rem_6.5rem_10rem] gap-3 border-b border-border px-5 py-3 text-[11px] tracking-[0.06em] text-antracit-300 uppercase xl:grid">
          <span>Fil</span>
          <span>Rapport</span>
          <span>Bolag</span>
          <span>Månader</span>
          <span>Status</span>
          <span>Publicerad</span>
          <span className="sr-only">Åtgärd</span>
        </div>
        <ul className="divide-y divide-border" data-testid="history-list">
          {rows.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-1 gap-2 px-5 py-4 text-sm xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_6rem_7rem_8rem_6.5rem_10rem] xl:items-center xl:gap-3"
              data-testid="history-row"
              data-status={r.status}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium" title={r.fileName}>
                  {r.fileName}
                </span>
                {r.retracted ? (
                  <span className="block text-xs text-muted-foreground">
                    Återkallad {r.retracted}
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground xl:text-foreground">{r.report}</span>
              <span>{r.companies}</span>
              <span className="num">{r.months}</span>
              <span>
                <StatusChip tone={TONE[r.status]}>{r.statusLabel}</StatusChip>
              </span>
              <span className={cn("num", "text-muted-foreground xl:text-foreground")}>
                {r.publishedAt}
              </span>
              <span className="xl:text-right">
                {r.canRetract ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTarget(r);
                      setReason("");
                      setError(null);
                    }}
                    data-testid="retract-button"
                  >
                    <Undo2 aria-hidden="true" />
                    Ångra publicering
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ImportDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Ångra publicering"
        description={
          target
            ? `${target.fileName} (${target.months}) tas bort ur siffrorna. Den tidigare versionen av samma månader gäller igen. Ingenting raderas.`
            : undefined
        }
        submitLabel="Ångra publiceringen"
        busy={pending}
        onSubmit={confirm}
        testId="retract-dialog"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium tracking-[0.06em] text-antracit-300 uppercase">
            Varför?
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-input bg-card p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="Till exempel: fel månad vald"
            data-testid="retract-reason"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm">
            {error}
          </p>
        ) : null}
      </ImportDialog>
    </div>
  );
}
