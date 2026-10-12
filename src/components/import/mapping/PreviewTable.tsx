"use client";

import { Heading } from "@/components/brand/Heading";
import { formatNumber, MISSING } from "@/lib/core/format-sv";
import type { PreviewResponse } from "@/lib/import-ui/ingest-service";
import type { MappingState } from "@/lib/import-ui/mapping";
import { cn } from "@/lib/utils";
import { Panel } from "../fields";

/** The first 20 rows after the steps, with a sums row per measure. */
export function PreviewTable({
  preview,
  busy,
  state,
  dimensionLabel,
}: {
  preview: PreviewResponse | null;
  busy: boolean;
  state: MappingState;
  dimensionLabel: (key: string) => string;
}) {
  const measureCols = new Set(
    Object.entries(state.fields)
      .filter(([, f]) => f.usage === "measure")
      .map(([c]) => c),
  );
  return (
    <section aria-labelledby="preview-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading id="preview-heading" level={3}>
          Förhandsgranskning
        </Heading>
        <p className="num text-sm text-muted-foreground" aria-live="polite">
          {preview
            ? `Visar ${Math.min(preview.rows.length, preview.rowCount)} av ${formatNumber(preview.rowCount)} rader efter stegen${
                preview.skippedCount
                  ? `, ${formatNumber(preview.skippedCount)} rader bortfiltrerade`
                  : ""
              }${busy ? " – uppdaterar…" : ""}.`
            : "Läser förhandsgranskningen…"}
        </p>
      </div>
      <Panel className="p-0 md:p-0" aria-busy={busy}>
        {preview ? (
          <div className="max-h-[32rem] overflow-auto rounded-card" data-testid="preview-table">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">
                Förhandsgranskning av de första raderna efter stegen
              </caption>
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th
                    scope="col"
                    className="border-b border-border px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-antracit-300 uppercase"
                  >
                    Rad
                  </th>
                  {preview.columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn(
                        "border-b border-border px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] whitespace-nowrap text-antracit-300 uppercase",
                        measureCols.has(c) && "text-right",
                      )}
                    >
                      {preview.headers[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={`${row.sourceRow}-${i}`} className="even:bg-ljusgra-100/50">
                    <td className="num px-3 py-1.5 text-muted-foreground">{row.sourceRow}</td>
                    {preview.columns.map((c) => (
                      <td
                        key={c}
                        className={cn(
                          "max-w-[16rem] truncate px-3 py-1.5 whitespace-nowrap",
                          measureCols.has(c) && "num text-right",
                        )}
                        title={row.values[c]}
                      >
                        {row.values[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {measureCols.size > 0 ? (
                <tfoot className="sticky bottom-0 bg-card">
                  <tr>
                    <th
                      scope="row"
                      className="border-t border-border px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] uppercase"
                    >
                      Summa
                    </th>
                    {preview.columns.map((c) => {
                      const s = preview.sums[c];
                      return (
                        <td
                          key={c}
                          className="num border-t border-border px-3 py-2 text-right font-medium whitespace-nowrap"
                        >
                          {measureCols.has(c)
                            ? s?.sum !== null && s?.sum !== undefined
                              ? formatNumber(s.sum, Number.isInteger(s.sum) ? 0 : 2)
                              : MISSING
                            : ""}
                          {measureCols.has(c) && s && s.unreadable > 0 ? (
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              {s.unreadable === 1
                                ? "1 cell är inte ett tal"
                                : `${formatNumber(s.unreadable)} celler är inte tal`}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Läser…</p>
        )}
        {preview && preview.issueCount > 0 ? (
          <div className="border-t border-border p-4 text-sm">
            <p className="font-medium">
              {preview.issueCount === 1 ? "1 sak" : `${formatNumber(preview.issueCount)} saker`}{" "}
              behöver uppmärksamhet:
            </p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {preview.issues.slice(0, 5).map((i, k) => (
                <li key={k}>
                  {i.sourceRow > 0 ? `Rad ${i.sourceRow}: ` : ""}
                  {i.message}
                  {i.value ? ` (”${i.value}”)` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {preview && Object.keys(preview.unknownLookups).length > 0 ? (
          <div className="border-t border-border p-4 text-sm" data-testid="unknown-lookups">
            <p className="font-medium">Värden som inte finns i uppslagstabellen</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {Object.entries(preview.unknownLookups).map(([dim, values]) => (
                <li key={dim}>
                  {dimensionLabel(dim)}: {values.slice(0, 10).join(", ")}
                  {values.length > 10 ? ` och ${values.length - 10} till` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-muted-foreground">
              Du lägger till dem eller kopplar dem till befintliga värden när du granskar.
            </p>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}
