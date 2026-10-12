"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Heading } from "@/components/brand/Heading";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { MetricDefinition } from "@/lib/contracts/metric-query";
import { formatNumber } from "@/lib/core/format-sv";
import {
  DIRECTION_LABELS,
  KIND_LABELS,
  UNIT_LABELS,
  groupMetrics,
  toDirection,
} from "@/lib/settings-ui/metrics";
import { SettingsCard } from "../ui";
import { MetricForm } from "./MetricForm";

const NEW = "__new";

export interface MetricsEditorProps {
  definitions: MetricDefinition[];
  datasets: { key: string; name: string }[];
  dimensionLabels: Record<string, string>;
}

export function MetricsEditor({ definitions, datasets, dimensionLabels }: MetricsEditorProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const groups = useMemo(() => groupMetrics(definitions, datasets), [definitions, datasets]);
  const metric =
    editing && editing !== NEW ? (definitions.find((d) => d.key === editing) ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          {formatNumber(definitions.length)} mått. Nyckeln (till exempel <code>timmar</code>)
          används i formler och kan inte ändras.
        </p>
        <Button onClick={() => setEditing(NEW)} data-testid="metric-new">
          <Plus aria-hidden="true" />
          Nytt formelmått
        </Button>
      </div>

      {groups.map((group) => (
        <SettingsCard key={group.key} data-testid={`metric-group-${group.key}`}>
          <Heading level={3} className="mb-2">
            {group.title}
          </Heading>
          <ul className="divide-y divide-border">
            {group.metrics.map((m) => (
              <MetricRow key={m.key} metric={m} onEdit={() => setEditing(m.key)} />
            ))}
          </ul>
        </SettingsCard>
      ))}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          {editing !== null && (editing === NEW || metric) ? (
            <MetricForm
              key={editing}
              metric={metric}
              definitions={definitions}
              dimensionLabels={dimensionLabels}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MetricRow({ metric, onEdit }: { metric: MetricDefinition; onEdit: () => void }) {
  const facts: [string, string][] = [
    ["Enhet", UNIT_LABELS[metric.unit]],
    ["Typ", KIND_LABELS[metric.kind]],
    ["Riktning", DIRECTION_LABELS[toDirection(metric.higherIsBetter)]],
    ["Decimaler", metric.decimals === null ? "Standard" : formatNumber(metric.decimals)],
  ];
  return (
    <li
      className="flex flex-col gap-3 py-4 last:pb-0 md:flex-row md:items-start md:justify-between md:gap-6"
      data-testid={`metric-row-${metric.key}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{metric.name}</p>
        <p className="text-xs text-muted-foreground">
          <code>{metric.key}</code>
          {metric.description ? ` · ${metric.description}` : null}
        </p>
        {metric.formula ? (
          <p className="font-mono text-xs break-all text-antracit-300">{metric.formula}</p>
        ) : null}
        <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-1">
              <dt className="text-muted-foreground">{label}:</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={onEdit}
        aria-label={`Ändra ${metric.name}`}
        data-testid={`metric-edit-${metric.key}`}
      >
        Ändra
      </Button>
    </li>
  );
}
