// Every metric of the catalog through every page loader: no combination of metric, breakdown,
// drill filter, period or company may throw (URLs are hand-edited and shared).
import { describe, expect, it } from "vitest";
import { VizKindSchema } from "@/lib/contracts/slides";
import { parseExploreState } from "./explore-state";
import { loadWidget } from "./load-dashboard";
import { loadEntity } from "./load-entity";
import { loadExplore } from "./load-explore";
import { selectableMetrics } from "./metrics-meta";
import { ANCHOR, DEFINITIONS, DIMENSIONS, FILTERS, T, buildSource } from "./test-data";

const source = buildSource({ budget: true });
const METRICS = selectableMetrics(DEFINITIONS);
const BREAKDOWNS = [
  "manad",
  "bolag",
  ...DIMENSIONS.map((d) => d.key),
  // Unknown keys come from hand-edited URLs.
  "finns_inte",
];

async function failures(run: () => Promise<unknown>, label: string): Promise<string[]> {
  try {
    await run();
    return [];
  } catch (e) {
    return [`${label}: ${e instanceof Error ? e.message : String(e)}`];
  }
}

describe("page loaders over the whole catalog", () => {
  it("Utforska loads every metric × breakdown × drill filter × period", async () => {
    const errors: string[] = [];
    for (const m of METRICS) {
      for (const groupBy of BREAKDOWNS) {
        for (const [grain, company, drill] of [
          ["month", "ALL", ""],
          ["ytd", "MBR", `&f=kund.${T.budbee}`],
          ["r12", "MBAB", `&f=verksamhet.${T.krom}&f=finns_inte.3`],
        ] as const) {
          const query = `matt=${m.key}&grupp=${groupBy}${drill}`;
          errors.push(
            ...(await failures(async () => {
              const view = await loadExplore(parseExploreState(new URLSearchParams(query)), {
                source,
                definitions: DEFINITIONS,
                dimensions: DIMENSIONS,
                filters: { ...FILTERS, grain, company },
                anchor: ANCHOR,
              });
              if (view.pivot && view.sortedRows.length > 0 && !view.csv) throw new Error("no csv");
            }, `${query} ${grain} ${company}`)),
          );
        }
      }
    }
    expect(errors).toEqual([]);
  }, 60_000);

  it("entity pages load for every dimension and breakdown", async () => {
    const values: Record<string, number> = {
      kund: T.budbee,
      uppdrag: T.budbeeSodertalje,
      konsult: T.anna,
      verksamhet: T.krom,
      ort: T.stockholm,
      franvarotyp: T.sjuk,
      kontogrupp: T.kgIntakter,
      bolag: 1,
    };
    const errors: string[] = [];
    for (const [dimension, valueId] of Object.entries(values)) {
      for (const breakdown of [null, ...BREAKDOWNS]) {
        errors.push(
          ...(await failures(
            () =>
              loadEntity(
                { dimension, valueId, breakdown, sort: { key: "m0", dir: "asc" } },
                {
                  source,
                  definitions: DEFINITIONS,
                  dimensions: DIMENSIONS,
                  filters: FILTERS,
                  anchor: ANCHOR,
                },
              ),
            `${dimension} ${breakdown}`,
          )),
        );
      }
    }
    expect(errors).toEqual([]);
  }, 60_000);

  it("dashboard widgets load for every metric and visualization", async () => {
    const errors: string[] = [];
    for (const m of METRICS) {
      for (const viz of VizKindSchema.options) {
        for (const groupBy of [null, "bolag", "kund", "verksamhet"]) {
          const widget = await loadWidget(
            {
              id: "w",
              title: null,
              viz,
              metricKey: m.key,
              company: null,
              groupBy,
              filters: [],
              topN: null,
              layout: { x: 0, y: 0, w: 4, h: 1 },
            },
            {
              source,
              definitions: DEFINITIONS,
              dimensions: DIMENSIONS,
              filters: FILTERS,
              anchor: ANCHOR,
            },
          );
          if (widget.status === "error") errors.push(`${m.key} ${viz} ${groupBy}: ${widget.error}`);
        }
      }
    }
    expect(errors).toEqual([]);
  }, 60_000);
});
