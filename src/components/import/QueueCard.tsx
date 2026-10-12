"use client";

import { FileSpreadsheet, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadChoices } from "@/lib/contracts";
import { formatNumber } from "@/lib/core/format-sv";
import { missingChoicesText, statusLabel, statusTone, type QueueItem } from "@/lib/import-ui/queue";
import { ChoiceChips } from "./ChoiceChips";
import { StatusChip } from "./StatusChip";

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
  return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} kB`;
}

export interface QueueCardActions {
  onChoices: (choices: UploadChoices) => void;
  onMap: () => void;
  onDrift: () => void;
  onReview: () => void;
  onEditTemplate: () => void;
  onRemove: () => void;
}

export function QueueCard({
  item,
  now,
  actions,
}: {
  item: QueueItem;
  now: Date;
  actions: QueueCardActions;
}) {
  const tone = statusTone(item.status);
  const missing = item.status === "needs_choices" ? missingChoicesText(item) : null;
  const removable = item.status !== "reading" && item.status !== "running";
  const Icon = item.format === "sie" || item.format === "csv" ? FileText : FileSpreadsheet;
  return (
    <li
      data-testid="queue-card"
      data-status={item.status}
      className="flex flex-col gap-4 rounded-card bg-card p-5 shadow-soft md:flex-row md:items-start md:gap-6"
    >
      <div className="flex min-w-0 flex-1 gap-4">
        <div
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ljusgra-100 text-antracit-300"
        >
          <Icon className="size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-medium text-foreground" title={item.fileName}>
              {item.fileName}
            </p>
            <p className="num text-xs text-muted-foreground">
              {fileSize(item.fileSize)}
              {item.sheetName ? ` · blad ${item.sheetName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <StatusChip tone={tone}>{statusLabel(item)}</StatusChip>
            {missing ? <span className="text-sm text-foreground">{missing}</span> : null}
          </div>
          {item.message && item.status !== "published" ? (
            <p className="text-sm text-foreground" data-testid="queue-message">
              {item.message}
            </p>
          ) : null}
          {item.summary ? (
            <p className="text-sm text-foreground" data-testid="publish-summary">
              {item.summary}
            </p>
          ) : null}
          {["needs_choices", "running", "ready", "error"].includes(item.status) &&
          (item.template || item.format === "sie") ? (
            <ChoiceChips item={item} now={now} onChange={actions.onChoices} />
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
        {item.status === "new" ? (
          <Button onClick={actions.onMap} data-testid="map-button">
            Mappa
          </Button>
        ) : null}
        {item.status === "drift" ? (
          <Button onClick={actions.onDrift} data-testid="drift-button">
            Se skillnaden
          </Button>
        ) : null}
        {item.status === "ready" ? (
          <Button onClick={actions.onReview} data-testid="review-button">
            Granska
          </Button>
        ) : null}
        {item.template &&
        item.template.kind !== "sie" &&
        ["ready", "needs_choices", "error"].includes(item.status) ? (
          <Button
            variant="ghost"
            onClick={actions.onEditTemplate}
            data-testid="edit-template-button"
          >
            Ändra mallen
          </Button>
        ) : null}
        {removable ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={actions.onRemove}
            aria-label={`Ta bort ${item.fileName} ur listan`}
            data-testid="remove-button"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
