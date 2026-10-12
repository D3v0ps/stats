// Budget sign end to end: the same budget written three ways (result, all positive, ledger
// sign) goes through the upload flow as the app runs it (account groups from the database ->
// accountGroupContext -> runTemplate -> labels resolved -> staged -> published) and must read
// back as the same ledger budgets: revenue positive, costs positive, kostnader and resultat
// derived from the leaves, a budget line on a summary group never counted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ImportTemplateSchema,
  type BudgetSign,
  type IngestResult,
  type UploadCreate,
} from "@/lib/contracts";
import { MetricQuerySchema } from "@/lib/contracts/metric-query";
import { readWorkbook, resolveDims, runTemplate } from "@/lib/ingest";
import { utf8 } from "@/lib/ingest/testing/workbooks";
import { accountGroupContext } from "@/lib/import-ui/budget";
import { runMetricQuery } from "@/lib/metrics/engine";
import { listAccountGroups, loadDimensionDictionary } from "@/lib/db/repo/catalog";
import { SupabaseMetricDataSource } from "@/lib/db/repo/metrics";
import type { DbClient } from "@/lib/db/repo/shared";
import { createUpload, publishUpload, stageFacts } from "@/lib/db/repo/uploads";
import { createAppUser, createTestDb, type Db } from "./harness";
import { pgClient } from "./pg-client";

// One budget month: revenue 1 000, personnel 400, other operating costs 50, a financial cost
// of 20, and a line on the summary group "Rörelsens kostnader" that must not be counted.
const LINES: { group: string; revenue: boolean; amount: number }[] = [
  { group: "Intäkter", revenue: true, amount: 1000 },
  { group: "Personalkostnader", revenue: false, amount: 400 },
  { group: "Övriga rörelsekostnader", revenue: false, amount: 50 },
  { group: "Finansiella poster", revenue: false, amount: 20 },
  { group: "Rörelsens kostnader", revenue: false, amount: 999 },
];

/** The amount as a file with that sign convention writes it. */
function written(sign: BudgetSign, line: (typeof LINES)[number]): number {
  if (sign === "result") return line.revenue ? line.amount : -line.amount;
  if (sign === "ledger") return line.revenue ? -line.amount : line.amount;
  // All positive: the account group's sign decides. Finansiella poster has sign −1, so a
  // positive amount there is a financial income; a cost is written negative.
  return line.group === "Finansiella poster" ? -line.amount : line.amount;
}

function budgetFile(sign: BudgetSign, month: string): string {
  const rows = LINES.map((l) => `${l.group};${month};${written(sign, l)}`);
  return ["Kontogrupp;Månad;Belopp", ...rows].join("\n") + "\n";
}

function template(sign: BudgetSign) {
  return ImportTemplateSchema.parse({
    datasetKey: "budget",
    name: `Budget (${sign})`,
    headerSignature: ["kontogrupp", "månad", "belopp"],
    config: {
      kind: "table",
      columns: [
        { column: "kontogrupp", type: "text", usage: "dimension", dimensionKey: "kontogrupp" },
        { column: "månad", type: "text", usage: "period" },
        { column: "belopp", type: "amount", usage: "measure", metricKey: "budget_belopp" },
      ],
      period: { kind: "column", column: "månad" },
      company: { kind: "fixed", company: "MBAB" },
      scenario: "budget",
      budgetSign: sign,
    },
  });
}

function uploadCreate(r: IngestResult): UploadCreate {
  return {
    datasetKey: r.datasetKey,
    templateId: null,
    templateVersion: null,
    scenario: r.scenario,
    fileName: r.file.name,
    fileSha256: r.file.sha256,
    fileSize: r.file.size,
    contentHash: r.contentHash,
    engineVersion: r.engineVersion,
    asOfDate: r.asOfDate ?? null,
    slices: r.slices.map((s) => ({ ...s, priority: s.priority ?? 0 })),
    parseReport: r.report,
    totals: r.totals,
  };
}

const MONTH: Record<BudgetSign, string> = {
  result: "2026-01",
  positive: "2026-02",
  ledger: "2026-03",
};
const SIGNS = Object.keys(MONTH) as BudgetSign[];

describe("budget sign end to end", () => {
  let db: Db;
  let client: DbClient;
  const stored: Record<string, Record<string, number>> = {};

  beforeAll(async () => {
    db = await createTestDb();
    client = pgClient(db, await createAppUser(db));
    const groups = accountGroupContext(await listAccountGroups(client));
    const dictionary = await loadDimensionDictionary(client);
    for (const sign of SIGNS) {
      const name = `budget-${sign}.csv`;
      const result = await runTemplate(
        readWorkbook(utf8(budgetFile(sign, MONTH[sign])), name),
        template(sign),
        {},
        {
          aliases: {},
          fileSha256: String(SIGNS.indexOf(sign) + 1).repeat(64),
          fileSize: 1,
          ...groups,
        },
      );
      expect(result.report.issues.filter((i) => i.severity === "error")).toEqual([]);
      const resolved = resolveDims(result.facts, dictionary);
      if (!resolved.rows) throw new Error(`Unresolved: ${JSON.stringify(resolved.unknown)}`);
      const id = await createUpload(client, uploadCreate(result));
      await stageFacts(client, id, resolved.rows);
      await publishUpload(client, id);
      stored[sign] = Object.fromEntries(result.facts.map((f) => [f.dims.kontogrupp!, f.value]));
    }
  });
  afterAll(async () => {
    await db.close();
  });

  it.each(SIGNS)("stores %s budgets in bookkeeping (SIE) sign", (sign) => {
    expect(stored[sign]).toEqual({
      Intäkter: -1000,
      Personalkostnader: 400,
      "Övriga rörelsekostnader": 50,
      "Finansiella poster": 20,
      "Rörelsens kostnader": 999,
    });
  });

  it.each(SIGNS)(
    "reads %s budgets back as ledger budgets with the actuals' signs",
    async (sign) => {
      const keys = [
        "intakter",
        "personal",
        "ovriga_rorelse",
        "kostnader",
        "finansiella",
        "resultat",
      ];
      const result = await runMetricQuery(
        MetricQuerySchema.parse({
          metricKeys: keys,
          period: { grain: "month", anchor: MONTH[sign] },
          company: "MBAB",
          scenario: "budget",
        }),
        new SupabaseMetricDataSource(client),
      );
      const total = Object.fromEntries(result.results.map((r) => [r.metricKey, r.total.value]));
      expect(total).toEqual({
        intakter: 1000,
        personal: 400,
        ovriga_rorelse: 50,
        // The leaves only: the 999 on "Rörelsens kostnader" is not counted.
        kostnader: 450,
        // Financial net reads like actuals (sign −1): a cost of 20 is −20.
        finansiella: -20,
        resultat: 530,
      });
    },
  );
});
