import { describe, expect, it } from "vitest";
import type { IngestResult, TemplateConfig } from "@/lib/contracts";
import {
  autoChoices,
  duplicateMessage,
  hasUnfinishedWork,
  missingChoices,
  missingChoicesText,
  newQueueItem,
  queueCounts,
  queueReducer,
  requiredChoices,
  runToken,
  statusLabel,
  statusTone,
  templateRef,
  type JobOutcome,
  type QueueItem,
  type Suggestions,
  type TemplateRef,
} from "./queue";

const TPL: TemplateRef = {
  id: "t1",
  name: "Intelliplan – timmar",
  version: 2,
  datasetKey: "ip_timmar",
  kind: "table",
};
const SUG: Suggestions = {
  period: [{ month: "2026-09", confidence: 0.9, source: "filename" }],
  company: { company: "MBAB", source: "filename", confidence: 0.9 },
  asOfDate: "2026-09-30",
};

function result(companies: ("MBAB" | "MBR")[] = ["MBAB"]): IngestResult {
  return {
    engineVersion: 1,
    datasetKey: "ip_timmar",
    scenario: "utfall",
    file: { name: "f.xlsx", sha256: "a".repeat(64), size: 1 },
    contentHash: "b".repeat(64),
    companies,
    slices: companies.map((company) => ({ company, month: "2026-09" })),
    facts: [],
    report: { rowsRead: 0, rowsUsed: 0, skipped: [], issues: [], warnings: [] },
    totals: [],
  };
}

function reading(id = "a"): QueueItem[] {
  return queueReducer([], {
    type: "add",
    items: [newQueueItem(id, { name: "timmar.xlsx", size: 1000 })],
  });
}

const known = (requires = { month: true, company: false, asOfDate: false }): JobOutcome => ({
  kind: "known",
  sheetName: "Blad1",
  signature: ["kund", "timmar"],
  template: TPL,
  requires,
  suggestions: SUG,
});

describe("requiredChoices and suggestions", () => {
  const table = (
    period: "column" | "per_upload",
    company: "fixed" | "per_upload",
  ): TemplateConfig => ({
    kind: "table",
    steps: [],
    columns: [],
    counters: [],
    period: period === "column" ? { kind: "column", column: "datum" } : { kind: "per_upload" },
    company: company === "fixed" ? { kind: "fixed", company: "MBAB" } : { kind: "per_upload" },
    scenario: "utfall",
  });

  it("asks for what the template leaves open", () => {
    expect(requiredChoices(table("per_upload", "per_upload"))).toEqual({
      month: true,
      company: true,
      asOfDate: false,
    });
    expect(requiredChoices(table("column", "fixed"))).toEqual({
      month: false,
      company: false,
      asOfDate: false,
    });
    expect(requiredChoices({ kind: "sie", objectDims: [1] })).toEqual({
      month: false,
      company: false,
      asOfDate: false,
    });
    expect(
      requiredChoices({
        kind: "cases",
        steps: [],
        columns: [],
        company: { kind: "fixed", company: "MBR" },
        cases: { startColumn: "start", resultMap: {}, groupBy: [], metrics: {} },
      }),
    ).toEqual({ month: false, company: false, asOfDate: true });
  });

  it("pre-fills strong suggestions only", () => {
    const all = { month: true, company: true, asOfDate: true };
    expect(autoChoices(all, SUG)).toEqual({
      month: "2026-09",
      company: "MBAB",
      asOfDate: "2026-09-30",
    });
    expect(
      autoChoices(all, {
        period: [{ month: "2026-09", confidence: 0.3, source: "meta" }],
        company: { company: "MBAB", source: "meta", confidence: 0.5 },
      }),
    ).toEqual({});
    expect(autoChoices({ month: false, company: false, asOfDate: false }, SUG)).toEqual({});
  });

  it("names what is missing in plain words", () => {
    const item = {
      requires: { month: true, company: true, asOfDate: true },
      choices: { company: "MBAB" as const },
    };
    expect(missingChoices(item)).toEqual(["month", "asOfDate"]);
    expect(missingChoicesText(item)).toBe("Välj månad och exportdatum");
    expect(
      missingChoicesText({ requires: { month: true, company: true, asOfDate: true }, choices: {} }),
    ).toBe("Välj månad, bolag och exportdatum");
    expect(
      missingChoicesText({
        ...item,
        choices: { month: "2026-09", company: "MBAB", asOfDate: "2026-09-30" },
      }),
    ).toBeNull();
  });
});

describe("queueReducer", () => {
  it("adds items once", () => {
    const s = reading();
    expect(
      queueReducer(s, { type: "add", items: [newQueueItem("a", { name: "x", size: 1 })] }),
    ).toBe(s);
    expect(s[0]).toMatchObject({ status: "reading", fileId: "a" });
  });

  it("runs a known file at once when its choices are complete", () => {
    const s = queueReducer(reading(), { type: "recognized", id: "a", jobs: [known()] });
    expect(s[0]).toMatchObject({
      status: "running",
      template: TPL,
      choices: { month: "2026-09" },
      sourceSheet: "Blad1",
    });
    const done = queueReducer(s, { type: "run_done", id: "a", result: result() });
    expect(done[0]?.status).toBe("ready");
  });

  it("waits for choices that could not be suggested", () => {
    const s = queueReducer(reading(), {
      type: "recognized",
      id: "a",
      jobs: [
        {
          ...known({ month: false, company: true, asOfDate: false }),
          suggestions: { period: [], company: null },
        },
      ],
    });
    expect(s[0]?.status).toBe("needs_choices");
    const next = queueReducer(s, { type: "set_choices", id: "a", choices: { company: "MBR" } });
    expect(next[0]).toMatchObject({ status: "running", choices: { company: "MBR" } });
  });

  it("re-runs a ready file when a choice changes", () => {
    let s = queueReducer(reading(), { type: "recognized", id: "a", jobs: [known()] });
    s = queueReducer(s, { type: "run_done", id: "a", result: result() });
    s = queueReducer(s, { type: "set_choices", id: "a", choices: { month: "2026-08" } });
    expect(s[0]).toMatchObject({ status: "running", choices: { month: "2026-08" } });
    expect(s[0]?.result).toBeUndefined();
  });

  it("splits a workbook into one item per known sheet", () => {
    const s = queueReducer(reading(), {
      type: "recognized",
      id: "a",
      jobs: [
        { ...known({ month: false, company: false, asOfDate: false }), sheetName: "MB AB" },
        { ...known({ month: false, company: false, asOfDate: false }), sheetName: "MB Restart" },
      ],
    });
    expect(s.map((i) => [i.id, i.fileId, i.sheetName, i.status])).toEqual([
      ["a", "a", "MB AB", "running"],
      ["a:1", "a", "MB Restart", "running"],
    ]);
  });

  it("marks new and changed report types", () => {
    const s = queueReducer([...reading("a"), ...reading("b")], {
      type: "recognized",
      id: "a",
      jobs: [{ kind: "new", sheetName: "Blad1", signature: ["x"], suggestions: SUG }],
    });
    expect(s[0]?.status).toBe("new");
    const d = queueReducer(s, {
      type: "recognized",
      id: "b",
      jobs: [
        {
          kind: "drift",
          sheetName: "Blad1",
          signature: ["x"],
          suggestions: SUG,
          template: TPL,
          diff: {
            added: ["x"],
            removed: ["timmar"],
            renamed: [],
            reordered: false,
            compatible: false,
          },
        },
      ],
    });
    expect(d[1]).toMatchObject({ status: "drift", template: TPL });
  });

  it("gives a known sheet and an unmapped sibling sheet a card each", () => {
    const s = queueReducer(reading(), {
      type: "recognized",
      id: "a",
      jobs: [
        { ...known({ month: false, company: false, asOfDate: false }), sheetName: "MB AB" },
        { kind: "new", sheetName: "MB Restart", signature: ["post", "jan"], suggestions: SUG },
      ],
    });
    expect(s.map((i) => [i.id, i.sheetName, i.sourceSheet, i.status])).toEqual([
      ["a", "MB AB", "MB AB", "running"],
      ["a:1", "MB Restart", "MB Restart", "new"],
    ]);
    expect(statusLabel(s[1]!)).toBe("Ny rapporttyp – mappa");
  });

  it("runs a new file once its template is saved", () => {
    let s = queueReducer(reading(), {
      type: "recognized",
      id: "a",
      jobs: [{ kind: "new", sheetName: "Blad1", signature: ["x"], suggestions: SUG }],
    });
    s = queueReducer(s, {
      type: "template_saved",
      id: "a",
      template: TPL,
      requires: { month: true, company: false, asOfDate: false },
      headerRow: 3,
    });
    expect(s[0]).toMatchObject({ status: "running", choices: { month: "2026-09" }, headerRow: 3 });
  });

  it("reads SIE files straight to review, or refuses an unknown company", () => {
    const ok = queueReducer(reading(), { type: "sie_ready", id: "a", result: result(["MBR"]) });
    expect(ok[0]).toMatchObject({ status: "ready", choices: { company: "MBR" } });
    const bad = queueReducer(reading(), { type: "sie_ready", id: "a", result: result([]) });
    expect(bad[0]?.status).toBe("error");
    expect(bad[0]?.message).toMatch(/organisationsnumret/);
  });

  it("flags duplicates with the publish date", () => {
    let s = queueReducer(reading(), { type: "recognized", id: "a", jobs: [known()] });
    s = queueReducer(s, { type: "duplicate", id: "a", publishedAt: "2026-10-02T08:00:00Z" });
    expect(s[0]).toMatchObject({
      status: "duplicate",
      message: "Den här filen är redan uppladdad (publicerad 2 okt 2026).",
    });
  });

  it("publishes only ready items and keeps published items", () => {
    let s = queueReducer(reading(), { type: "recognized", id: "a", jobs: [known()] });
    expect(queueReducer(s, { type: "published", id: "a", summary: "x", publishedAt: "y" })).toBe(s);
    s = queueReducer(s, { type: "run_done", id: "a", result: result() });
    s = queueReducer(s, {
      type: "published",
      id: "a",
      summary: "Publicerat: 2 mått.",
      publishedAt: "2026-10-12T10:00:00Z",
    });
    expect(s[0]).toMatchObject({ status: "published", summary: "Publicerat: 2 mått." });
    expect(queueReducer(s, { type: "failed", id: "a", message: "x" })).toBe(s);
  });

  it("does not remove items that are being read", () => {
    const s = reading();
    expect(queueReducer(s, { type: "remove", id: "a" })).toBe(s);
    const failed = queueReducer(s, { type: "failed", id: "a", message: "Trasig fil" });
    expect(queueReducer(failed, { type: "remove", id: "a" })).toEqual([]);
  });

  it("ignores a run result for an item that is no longer running", () => {
    const s = queueReducer(reading(), { type: "failed", id: "a", message: "x" });
    expect(queueReducer(s, { type: "run_done", id: "a", result: result() })).toBe(s);
  });
});

describe("labels and counts", () => {
  it("uses the plain status texts", () => {
    expect(statusLabel({ status: "reading" })).toBe("Läser…");
    expect(statusLabel({ status: "running", template: TPL })).toBe(
      "Känd rapport: Intelliplan – timmar",
    );
    expect(statusLabel({ status: "new" })).toBe("Ny rapporttyp – mappa");
    expect(statusLabel({ status: "drift" })).toBe("Filen har ändrats – se skillnaden");
    expect(statusLabel({ status: "ready" })).toBe("Klar att granska");
    expect(statusLabel({ status: "published" })).toBe("Publicerad");
    expect(statusLabel({ status: "error" })).toBe("Fel");
    expect(statusTone("drift")).toBe("attention");
    expect(statusTone("published")).toBe("done");
  });

  it("counts and detects unfinished work", () => {
    let s = [...reading("a"), ...reading("b")];
    s = queueReducer(s, { type: "failed", id: "b", message: "x" });
    expect(queueCounts(s)).toEqual({ total: 2, busy: 1, needsAction: 1, ready: 0, published: 0 });
    expect(hasUnfinishedWork(s)).toBe(true);
    expect(hasUnfinishedWork(queueReducer(s, { type: "remove", id: "b" }).slice(1))).toBe(false);
  });

  it("builds template refs and run tokens", () => {
    expect(
      templateRef({
        id: "t",
        name: "n",
        version: 3,
        datasetKey: "budget",
        config: { kind: "table" },
      }),
    ).toEqual({ id: "t", name: "n", version: 3, datasetKey: "budget", kind: "table" });
    const a = runToken({ template: TPL, choices: { month: "2026-09" } });
    expect(runToken({ template: TPL, choices: { month: "2026-09" } })).toBe(a);
    expect(runToken({ template: { ...TPL, version: 3 }, choices: { month: "2026-09" } })).not.toBe(
      a,
    );
    expect(runToken({ template: TPL, choices: { month: "2026-08" } })).not.toBe(a);
    expect(duplicateMessage("2026-01-05T12:00:00Z")).toContain("5 jan 2026");
  });
});
