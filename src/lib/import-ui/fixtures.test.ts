// Runs every fixture file with a manifest template through the upload helpers:
// worker service (read, recognize, inspect, apply), template -> mapping ->
// template conversion, recognition and drift migration.
import { beforeAll, describe, expect, it } from "vitest";
import type { ImportTemplate, IngestResult, TemplateConfig } from "@/lib/contracts";
import { migrateConfig, fillNewColumns } from "./drift";
import {
  IngestService,
  type ApplyResponse,
  type InspectResponse,
  type IngestResponse,
  type ReadResponse,
  type RecognizeResponse,
} from "./ingest-service";
import {
  fromTemplateConfig,
  hasBlockingProblems,
  setField,
  toTemplateConfig,
  validateMapping,
} from "./mapping";
import { planJobs, templateHints, type RecognitionTemplate } from "./recognition";
import {
  MANIFEST,
  SEED_CATALOG,
  aliasTables,
  comparableFacts,
  entry,
  fixtureBytes,
  templatesOf,
  truthOf,
} from "./test-fixtures";

function ok<T extends IngestResponse>(res: IngestResponse): T {
  if (!res.ok) throw new Error(res.error);
  return res as T;
}

const service = new IngestService();
const TODAY = "2026-10-12";

async function load(file: string): Promise<ReadResponse> {
  return ok<ReadResponse>(
    await service.handle({ op: "read", fileId: file, fileName: file, bytes: fixtureBytes(file) }),
  );
}

async function apply(file: string, template: ImportTemplate): Promise<IngestResult> {
  const res = ok<ApplyResponse>(
    await service.handle({
      op: "apply",
      fileId: file,
      template,
      choices: entry(file).choices,
      aliases: aliasTables(file),
    }),
  );
  return res.result;
}

async function inspect(file: string, template: ImportTemplate): Promise<InspectResponse> {
  return ok<InspectResponse>(
    await service.handle({
      op: "inspect",
      fileId: file,
      sheetHint: template.sheetHint,
      datasetKey: template.datasetKey,
    }),
  );
}

const withTemplates = MANIFEST.files.filter((f) => f.templates.length > 0);

/**
 * The truth lists non-zero facts only, and tenure averages with fewer decimals
 * than ingest computes; everything else must match exactly.
 */
function expectTruth(
  facts: Parameters<typeof comparableFacts>[0],
  truth: Parameters<typeof comparableFacts>[0],
  label: string,
) {
  const key = (f: { metricKey: string; company: string; month: string; dims: object }) =>
    JSON.stringify([f.metricKey, f.company, f.month, f.dims]);
  const got = comparableFacts(facts).filter((f) => f.value !== 0);
  const want = comparableFacts(truth);
  expect(got.map(key), label).toEqual(want.map(key));
  got.forEach((f, i) => expect(f.value, `${label} ${key(f)}`).toBeCloseTo(want[i]!.value, 1));
}

describe("fixture files through the mapping helpers", () => {
  beforeAll(async () => {
    for (const f of MANIFEST.files) await load(f.file);
  });

  for (const f of withTemplates) {
    for (const [i, template] of templatesOf(f.file).entries()) {
      it(`${f.file} (${i + 1}): template -> mapping -> template gives the same facts`, async () => {
        const columns = (await inspect(f.file, template)).columns;
        const state = fromTemplateConfig(template.config, columns, {
          datasetKey: template.datasetKey,
          templateName: template.name,
          catalog: SEED_CATALOG,
        });
        const problems = validateMapping(state, SEED_CATALOG);
        expect(problems.filter((p) => p.blocking)).toEqual([]);

        const config = toTemplateConfig(state, SEED_CATALOG);
        // Removed columns are dropped before anything else.
        const removed = state.sources.filter((s) => !s.keep).map((s) => s.name);
        expect(config.kind === "sie" ? [] : config.steps.slice(0, removed.length)).toEqual(
          removed.map((column) => ({ op: "drop", column })),
        );

        const original = await apply(f.file, template);
        const converted = await apply(f.file, { ...template, config });
        expect(comparableFacts(converted.facts)).toEqual(comparableFacts(original.facts));
        expect(converted.totals).toEqual(original.totals);
        expect(converted.report.rowsUsed).toBe(original.report.rowsUsed);
        expect(converted.facts.length).toBeGreaterThan(0);

        // Converting again is stable.
        const again = toTemplateConfig(
          fromTemplateConfig(config, columns, {
            datasetKey: template.datasetKey,
            templateName: template.name,
            catalog: SEED_CATALOG,
          }),
          SEED_CATALOG,
        );
        expect(again).toEqual(config);
      });
    }
  }

  it("migrates budget templates that wrote the sign as a trailing negate step", async () => {
    const file = "budget_2026.xlsx";
    const columnsOf = async (t: ImportTemplate) => (await inspect(file, t)).columns;
    for (const template of templatesOf(file)) {
      if (template.config.kind !== "table") throw new Error("table template expected");
      const { budgetSign, ...rest } = template.config;
      expect(budgetSign).toBe("result");
      // Before budgetSign the mapping negated the measure after the tools, before the order.
      const measure = rest.columns.find((c) => c.usage === "measure" && c.keep !== false)!.column;
      const steps = [...rest.steps];
      steps.splice(steps.at(-1)?.op === "reorder" ? -1 : steps.length, 0, {
        op: "negate",
        column: measure,
      });
      const legacy: ImportTemplate = { ...template, config: { ...rest, steps } };
      const original = comparableFacts((await apply(file, template)).facts);
      expect(comparableFacts((await apply(file, legacy)).facts)).toEqual(original);

      const state = fromTemplateConfig(legacy.config, await columnsOf(template), {
        datasetKey: template.datasetKey,
        templateName: template.name,
        catalog: SEED_CATALOG,
      });
      expect(state.budgetSign).toBe("result");
      const config = toTemplateConfig(state, SEED_CATALOG);
      expect(config).toMatchObject({ budgetSign: "result" });
      expect(config.kind === "table" && config.steps.some((x) => x.op === "negate")).toBe(false);
      expect(comparableFacts((await apply(file, { ...template, config })).facts)).toEqual(original);
    }
  });

  it("reproduces the ground truth for single-template files", async () => {
    for (const f of withTemplates) {
      const templates = templatesOf(f.file);
      if (templates.length !== 1) continue;
      const result = await apply(f.file, templates[0]!);
      expectTruth(result.facts, truthOf(f.file), f.file);
    }
  });

  it("reproduces the budget truth with both sheet templates", async () => {
    const facts = [];
    for (const t of templatesOf("budget_2026.xlsx"))
      facts.push(...(await apply("budget_2026.xlsx", t)).facts);
    expectTruth(facts, truthOf("budget_2026.xlsx"), "budget_2026.xlsx");
  });

  it("never lets removed columns reach the preview", async () => {
    const template = templatesOf("intelliplan_timmar_MBAB_2026-09.xlsx")[0]!;
    const file = "intelliplan_timmar_MBAB_2026-09.xlsx";
    const columns = (await inspect(file, template)).columns;
    const pnr = columns.find((c) => c.name === "personnummer");
    expect(pnr).toMatchObject({ locked: true, personal: true });
    expect(pnr?.samples.every((s) => !/\d{6}-\d{4}/.test(s) || s.includes("ÅÅMMDD"))).toBe(true);
    const state = fromTemplateConfig(template.config, columns, {
      datasetKey: template.datasetKey,
      templateName: template.name,
      catalog: SEED_CATALOG,
    });
    const config = toTemplateConfig(state, SEED_CATALOG) as Extract<
      TemplateConfig,
      { kind: "table" }
    >;
    const preview = await service.handle({
      op: "preview",
      fileId: file,
      steps: config.steps,
      aliases: {},
      measures: [{ column: "timmar", type: "hours" }],
    });
    if (!preview.ok || preview.op !== "preview") throw new Error("preview failed");
    expect(preview.columns).not.toContain("personnummer");
    expect(preview.columns).not.toContain("konsult");
    expect(preview.rows).toHaveLength(20);
    expect(preview.sums.timmar?.sum).toBeGreaterThan(0);
  });
});

function recognitionTemplates(files: string[]): RecognitionTemplate[] {
  return files.flatMap((file) =>
    templatesOf(file).map((t, i) => ({
      id: `${file}#${i}`,
      name: t.name,
      datasetKey: t.datasetKey,
      kind: t.config.kind,
      version: t.version,
      headerSignature: t.headerSignature,
      ...(t.sheetHint ? { sheetHint: t.sheetHint } : {}),
    })),
  );
}

async function recognize(file: string, templates: RecognitionTemplate[]) {
  const read = await load(file);
  const res = ok<RecognizeResponse>(
    await service.handle({
      op: "recognize",
      fileId: file,
      hints: templateHints(templates),
      today: TODAY,
    }),
  );
  return planJobs({
    defaultSheet: res.defaultSheet,
    sheetForHint: res.sheetForHint,
    signatures: Object.fromEntries(Object.entries(res.sheets).map(([k, v]) => [k, v.signature])),
    sheetOrder: read.sheets.map((s) => s.name),
    templates,
  });
}

describe("recognition of the fixture files", () => {
  const all = recognitionTemplates(withTemplates.map((f) => f.file));

  it("recognizes every file by a compatible template of its own dataset", async () => {
    for (const f of withTemplates) {
      if (f.file === "budget_2026.xlsx") continue;
      const jobs = await recognize(f.file, all);
      expect(jobs, f.file).toHaveLength(1);
      expect(jobs[0]?.kind, f.file).toBe("known");
      if (jobs[0]?.kind === "known") expect(jobs[0].template.datasetKey).toBe(f.datasetKey);
    }
  });

  it("splits the budget workbook into one job per sheet template", async () => {
    const jobs = await recognize("budget_2026.xlsx", all);
    expect(
      jobs.map((j) => [j.kind, j.sheetName, j.kind === "known" ? j.template.name : ""]),
    ).toEqual([
      ["known", "MB AB", "Budget 2026 – MB AB (fixture)"],
      ["known", "MB Restart", "Budget 2026 – MB Restart (fixture)"],
    ]);
  });

  it("offers both budget sheets the first time, and the second sheet once the first is mapped", async () => {
    const fresh = await recognize("budget_2026.xlsx", []);
    expect(fresh).toEqual([
      { kind: "new", sheetName: "MB AB" },
      { kind: "new", sheetName: "MB Restart" },
    ]);
    const onlyFirst = recognitionTemplates(["budget_2026.xlsx"]).filter(
      (t) => t.sheetHint === "MB AB",
    );
    const jobs = await recognize("budget_2026.xlsx", onlyFirst);
    expect(jobs.map((j) => [j.kind, j.sheetName])).toEqual([
      ["known", "MB AB"],
      ["new", "MB Restart"],
    ]);
  });

  it("reports the changed timmar file as drift when only the old template exists", async () => {
    const jobs = await recognize(
      "intelliplan_timmar_MBAB_2026-09_andrad.xlsx",
      recognitionTemplates(["intelliplan_timmar_MBAB_2026-09.xlsx"]),
    );
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.kind).toBe("drift");
    if (job.kind !== "drift") return;
    // "timmar" -> "antal timmar" is too different for the signature diff to call it a rename;
    // the migration proposes it (see below).
    expect(job.diff.added).toEqual(["avdelning", "antal timmar"]);
    expect(job.diff.removed).toEqual(["timmar"]);
    expect(job.diff.renamed).toEqual([]);
  });

  it("treats a file that resembles no template as a new report type", async () => {
    const jobs = await recognize("intelliplan_kundlista.xls", all);
    expect(jobs).toEqual([{ kind: "new", sheetName: expect.any(String) }]);
  });

  it("suggests month and company for per-upload files", async () => {
    await load("intelliplan_fakturering_MBAB_2026-09.xlsx");
    const res = ok<RecognizeResponse>(
      await service.handle({
        op: "recognize",
        fileId: "intelliplan_fakturering_MBAB_2026-09.xlsx",
        hints: [],
        today: TODAY,
      }),
    );
    const sheet = res.sheets[res.defaultSheet]!;
    expect(sheet.periodSuggestions[0]?.month).toBe("2026-09");
    expect(sheet.companySuggestion?.company).toBe("MBAB");
  });
});

describe("drift migration on the changed timmar file", () => {
  it("carries the old template over and gives the same facts as the v2 template", async () => {
    const file = "intelliplan_timmar_MBAB_2026-09_andrad.xlsx";
    const old = templatesOf("intelliplan_timmar_MBAB_2026-09.xlsx")[0]!;
    const v2 = templatesOf(file)[0]!;
    if (old.config.kind !== "table") throw new Error("table template expected");
    const insp = await inspect(file, old);
    const diff = (
      await recognize(file, recognitionTemplates(["intelliplan_timmar_MBAB_2026-09.xlsx"]))
    )[0];
    if (diff?.kind !== "drift") throw new Error("drift expected");

    const migrated = migrateConfig(
      old.config,
      diff.diff,
      insp.columns.map((c) => c.name),
    );
    expect(migrated.renames).toEqual([{ from: "antal timmar", to: "timmar" }]);
    expect(migrated.removedSteps).toEqual([]);
    expect(migrated.missingColumns).toEqual([]);

    let state = fromTemplateConfig(migrated.config, insp.columns, {
      datasetKey: old.datasetKey,
      templateName: old.name,
      catalog: SEED_CATALOG,
    });
    state = fillNewColumns(state, insp.suggestions, diff.diff.added);
    expect(state.sources.find((s) => s.name === "antal timmar")?.rename).toBe("timmar");
    // The new column needs a decision before the template can be saved.
    if (validateMapping(state, SEED_CATALOG).some((p) => p.blocking)) {
      state = setField(state, "avdelning", { usage: "ignore" });
    }
    expect(hasBlockingProblems(validateMapping(state, SEED_CATALOG))).toBe(false);

    const config = toTemplateConfig(state, SEED_CATALOG);
    const migratedResult = await apply(file, {
      ...old,
      headerSignature: v2.headerSignature,
      config,
    });
    const v2Result = await apply(file, v2);
    expect(comparableFacts(migratedResult.facts)).toEqual(comparableFacts(v2Result.facts));
    expectTruth(migratedResult.facts, truthOf("intelliplan_timmar_MBAB_2026-09.xlsx"), file);
  });
});
