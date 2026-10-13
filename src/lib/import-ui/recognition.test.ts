import { describe, expect, it } from "vitest";
import {
  companyFit,
  planJobs,
  runsWithSavedTemplate,
  templateHeaderRows,
  templateHints,
  toRecognitionTemplate,
  type RecognitionTemplate,
} from "./recognition";

const t = (
  id: string,
  sig: string[],
  extra: Partial<RecognitionTemplate> = {},
): RecognitionTemplate => ({
  id,
  name: `Mall ${id}`,
  datasetKey: "ip_timmar",
  kind: "table",
  version: 1,
  headerSignature: sig,
  ...extra,
});

const SIG = ["kund", "datum", "timmar", "status"];

describe("planJobs", () => {
  it("picks a compatible template (column order does not matter)", () => {
    const jobs = planJobs({
      defaultSheet: "Blad1",
      sheetForHint: {},
      signatures: { Blad1: ["datum", "kund", "status", "timmar"] },
      templates: [t("a", SIG), t("b", ["x", "y"])],
    });
    expect(jobs).toEqual([{ kind: "known", sheetName: "Blad1", template: t("a", SIG), score: 1 }]);
  });

  it("prefers the newest of equally good templates", () => {
    const jobs = planJobs({
      defaultSheet: "Blad1",
      sheetForHint: {},
      signatures: { Blad1: SIG },
      templates: [
        t("old", SIG, { updatedAt: "2026-01-01" }),
        t("new", SIG, { updatedAt: "2026-06-01" }),
      ],
    });
    expect(jobs[0]?.kind === "known" && jobs[0].template.id).toBe("new");
  });

  describe("templates with the same headers for different companies", () => {
    const mbab = t("mbab", SIG, { company: "MBAB", updatedAt: "2026-06-01" });
    const mbr = t("mbr", SIG, { company: "MBR", updatedAt: "2026-01-01" });
    const plan = (templates: RecognitionTemplate[], company?: "MBAB" | "MBR", sig = SIG) =>
      planJobs({
        defaultSheet: "Blad1",
        sheetForHint: {},
        signatures: { Blad1: sig },
        companies: { Blad1: company },
        templates,
      });
    const picked = (jobs: ReturnType<typeof planJobs>) =>
      jobs[0]?.kind === "new" ? null : jobs[0]?.template.id;

    it("picks the template fixed to the company the file names, not the newest", () => {
      expect(picked(plan([mbab, mbr], "MBR"))).toBe("mbr");
      expect(picked(plan([mbr, mbab], "MBAB"))).toBe("mbab");
      expect(picked(plan([{ ...mbab, updatedAt: "2025-01-01" }, mbr], "MBAB"))).toBe("mbab");
    });

    it("falls back to the newest when the file names no company", () => {
      expect(picked(plan([mbr, mbab]))).toBe("mbab");
    });

    it("prefers an open template over one fixed to the other company", () => {
      const open = t("open", SIG, { updatedAt: "2025-01-01" });
      expect(picked(plan([mbab, open], "MBR"))).toBe("open");
      expect(picked(plan([mbab, open], "MBAB"))).toBe("mbab");
    });

    it("lets the company decide between equally changed templates, never over a closer one", () => {
      const changed = ["kund", "datum", "antal timmar", "status"];
      expect(plan([mbab, mbr], "MBR", changed)[0]).toMatchObject({
        kind: "drift",
        template: { id: "mbr" },
      });
      const closer = t("closer", ["kund", "datum", "antal timmar", "status", "x"], {
        company: "MBAB",
      });
      const other = t("other", ["kund", "datum", "antal timmar", "y", "z"], { company: "MBR" });
      expect(
        picked(plan([closer, other], "MBR", ["kund", "datum", "antal timmar", "status"])),
      ).toBe("closer");
    });
  });

  it("offers drift for a close but changed file and new for a different one", () => {
    const drift = planJobs({
      defaultSheet: "Blad1",
      sheetForHint: {},
      signatures: { Blad1: ["kund", "datum", "antal timmar", "status"] },
      templates: [t("a", SIG)],
    });
    expect(drift[0]).toMatchObject({
      kind: "drift",
      score: 0.6,
      diff: { removed: ["timmar"], added: ["antal timmar"] },
    });
    const fresh = planJobs({
      defaultSheet: "Blad1",
      sheetForHint: {},
      signatures: { Blad1: ["kund", "belopp", "moms", "fakturanr"] },
      templates: [t("a", SIG)],
    });
    expect(fresh).toEqual([{ kind: "new", sheetName: "Blad1" }]);
  });

  it("runs one job per sheet with its own template, ignoring SIE templates", () => {
    const sig = ["post", "jan", "feb"];
    const templates = [
      t("ab", sig, { sheetHint: "MB AB" }),
      t("r", sig, { sheetHint: "MB Restart" }),
      t("sie", [], { kind: "sie" }),
    ];
    expect(templateHints(templates)).toEqual(["MB AB", "MB Restart"]);
    const jobs = planJobs({
      defaultSheet: "MB AB",
      sheetForHint: { "MB AB": "MB AB", "MB Restart": "MB Restart" },
      signatures: { "MB AB": sig, "MB Restart": sig },
      sheetOrder: ["MB AB", "MB Restart"],
      templates,
    });
    expect(
      jobs.map((j) => [j.kind, j.sheetName, j.kind === "known" ? j.template.id : null]),
    ).toEqual([
      ["known", "MB AB", "ab"],
      ["known", "MB Restart", "r"],
    ]);
  });

  it("offers a sheet laid out like the mapped one as a new report type (first budget sheet mapped)", () => {
    const sig = ["post", "jan", "feb"];
    const jobs = planJobs({
      defaultSheet: "MB AB",
      sheetForHint: { "MB AB": "MB AB" },
      signatures: { "MB AB": sig, "MB Restart": sig, Instruktioner: ["läs mig"] },
      sheetOrder: ["MB AB", "MB Restart", "Instruktioner"],
      templates: [t("ab", sig, { sheetHint: "MB AB" })],
    });
    expect(
      jobs.map((j) => [j.kind, j.sheetName, j.kind === "known" ? j.template.id : null]),
    ).toEqual([
      ["known", "MB AB", "ab"],
      ["new", "MB Restart", null],
    ]);
  });

  it("splits a new multi-sheet workbook into one card per sheet with the same layout", () => {
    const sig = ["post", "jan", "feb"];
    const jobs = planJobs({
      defaultSheet: "MB AB",
      sheetForHint: {},
      signatures: { "MB AB": sig, "MB Restart": sig, Diagram: ["x"] },
      sheetOrder: ["MB AB", "MB Restart", "Diagram"],
      templates: [],
    });
    expect(jobs).toEqual([
      { kind: "new", sheetName: "MB AB" },
      { kind: "new", sheetName: "MB Restart" },
    ]);
  });

  it("shows a changed sheet next to a known one when the sheet has its own template", () => {
    const sig = ["post", "jan", "feb", "mar"];
    const changed = ["post", "jan", "feb", "mars 2026"];
    const jobs = planJobs({
      defaultSheet: "MB AB",
      sheetForHint: { "MB AB": "MB AB", "MB Restart": "MB Restart" },
      signatures: { "MB AB": sig, "MB Restart": changed },
      sheetOrder: ["MB AB", "MB Restart"],
      templates: [t("ab", sig, { sheetHint: "MB AB" }), t("r", sig, { sheetHint: "MB Restart" })],
    });
    expect(jobs.map((j) => [j.kind, j.sheetName])).toEqual([
      ["known", "MB AB"],
      ["drift", "MB Restart"],
    ]);
  });

  it("never skips a sheet that has a template of its own, however much it changed", () => {
    const sig = ["post", "jan", "feb", "mar"];
    const jobs = planJobs({
      defaultSheet: "MB AB",
      sheetForHint: { "MB AB": "MB AB", "MB Restart": "MB Restart" },
      signatures: { "MB AB": sig, "MB Restart": ["konto", "belopp"] },
      sheetOrder: ["MB AB", "MB Restart"],
      templates: [t("ab", sig, { sheetHint: "MB AB" }), t("r", sig, { sheetHint: "MB Restart" })],
    });
    expect(jobs.map((j) => [j.kind, j.sheetName])).toEqual([
      ["known", "MB AB"],
      ["new", "MB Restart"],
    ]);
    const lowOverlap = planJobs({
      defaultSheet: "MB AB",
      sheetForHint: { "MB AB": "MB AB", "MB Restart": "MB Restart" },
      signatures: { "MB AB": sig, "MB Restart": ["post", "q1", "q2", "q3", "q4"] },
      sheetOrder: ["MB AB", "MB Restart"],
      templates: [t("ab", sig, { sheetHint: "MB AB" }), t("r", sig, { sheetHint: "MB Restart" })],
    });
    expect(lowOverlap.map((j) => [j.kind, j.sheetName])).toEqual([
      ["known", "MB AB"],
      ["drift", "MB Restart"],
    ]);
  });

  it("does not treat a hint that fell back to the default sheet as that sheet's own template", () => {
    // A single-sheet timmar file: the budget templates' hints resolve to its only sheet.
    const jobs = planJobs({
      defaultSheet: "Rapport",
      sheetForHint: { "MB AB": "Rapport" },
      signatures: { Rapport: SIG },
      sheetOrder: ["Rapport"],
      templates: [
        t("budget", ["post", "jan", "feb", "status"], { sheetHint: "MB AB" }),
        t("timmar", SIG),
      ],
    });
    expect(jobs).toMatchObject([{ kind: "known", template: { id: "timmar" } }]);
  });

  it("matches a template with a hand-picked header row on the sheet read at that row", () => {
    const own = ["konto", "belopp"];
    const templates = [
      t("rad", own, { headerRow: 4 }),
      t("rad2", own, { headerRow: 4, sheetHint: "MB AB" }),
      t("auto", ["x", "y"]),
      t("sie", [], { kind: "sie", headerRow: 1 }),
    ];
    expect(templateHeaderRows(templates)).toEqual([{ row: 4 }, { sheetHint: "MB AB", row: 4 }]);
    // Detection found a title row; at row 4 the sheet has the template's headers.
    const jobs = planJobs({
      defaultSheet: "Blad1",
      sheetForHint: {},
      signatures: { Blad1: ["rapport", "export"] },
      signaturesAt: { Blad1: { 4: ["belopp", "konto"] } },
      templates: [templates[0]!],
    });
    expect(jobs).toEqual([
      {
        kind: "known",
        sheetName: "Blad1",
        template: templates[0],
        score: 1,
        signature: ["belopp", "konto"],
      },
    ]);
    // Without a reading at that row the detected signature is used.
    const fallback = planJobs({
      defaultSheet: "Blad1",
      sheetForHint: {},
      signatures: { Blad1: ["konto", "belopp"] },
      templates: [templates[0]!],
    });
    expect(fallback).toEqual([
      { kind: "known", sheetName: "Blad1", template: templates[0], score: 1 },
    ]);
    // A changed sheet at the template's row is drift, with that row's signature.
    const drift = planJobs({
      defaultSheet: "Blad1",
      sheetForHint: {},
      signatures: { Blad1: ["rapport"] },
      signaturesAt: { Blad1: { 4: ["konto", "belopp", "moms"] } },
      templates: [templates[0]!],
    });
    expect(drift).toMatchObject([
      { kind: "drift", signature: ["konto", "belopp", "moms"], diff: { added: ["moms"] } },
    ]);
  });

  it("maps a repo template", () => {
    expect(
      toRecognitionTemplate({
        id: "x",
        name: "n",
        datasetKey: "budget",
        version: 2,
        headerSignature: ["a"],
        sheetHint: "MB AB",
        updatedAt: "2026-01-01",
        config: { kind: "table" },
      }),
    ).toEqual({
      id: "x",
      name: "n",
      datasetKey: "budget",
      kind: "table",
      version: 2,
      headerSignature: ["a"],
      sheetHint: "MB AB",
      updatedAt: "2026-01-01",
    });
    expect(
      toRecognitionTemplate({
        id: "x",
        name: "n",
        datasetKey: "budget",
        version: 1,
        headerSignature: ["a"],
        config: { kind: "table", headerRow: 3 },
      }),
    ).toMatchObject({ headerRow: 3 });
  });

  it("carries a fixed company, and no company when it is chosen per upload or by column", () => {
    const repo = (company: { kind: "fixed"; company: "MBR" } | { kind: "per_upload" }) =>
      toRecognitionTemplate({
        id: "x",
        name: "n",
        datasetKey: "wb_deltagare",
        version: 1,
        headerSignature: ["a"],
        config: { kind: "cases", company },
      });
    expect(repo({ kind: "fixed", company: "MBR" }).company).toBe("MBR");
    expect(repo({ kind: "per_upload" })).not.toHaveProperty("company");
  });
});

describe("companyFit", () => {
  it("is 1 for the same company, -1 for the other and 0 when either is open", () => {
    expect(companyFit({ company: "MBAB" }, "MBAB")).toBe(1);
    expect(companyFit({ company: "MBAB" }, "MBR")).toBe(-1);
    expect(companyFit({ company: "MBAB" }, undefined)).toBe(0);
    expect(companyFit({}, "MBR")).toBe(0);
  });
});

describe("runsWithSavedTemplate", () => {
  const saved = t("mbab", SIG, { company: "MBAB" });
  const card = {
    status: "new" as const,
    signature: ["datum", "kund", "timmar", "status"],
    suggestions: { period: [], company: null },
  };
  const naming = (company: "MBAB" | "MBR") => ({
    ...card,
    suggestions: { period: [], company: { company, source: "filename" as const, confidence: 0.9 } },
  });

  it("runs other new or changed cards with the same headers", () => {
    expect(runsWithSavedTemplate(saved, card)).toBe(true);
    expect(runsWithSavedTemplate(saved, { ...card, status: "drift" })).toBe(true);
    expect(runsWithSavedTemplate(saved, naming("MBAB"))).toBe(true);
    expect(runsWithSavedTemplate(saved, { ...card, status: "ready" })).toBe(false);
    expect(runsWithSavedTemplate(saved, { ...card, signature: ["kund", "belopp"] })).toBe(false);
    expect(runsWithSavedTemplate(saved, { ...card, signature: undefined })).toBe(false);
  });

  it("leaves a card for the other company to be mapped with a template of its own", () => {
    expect(runsWithSavedTemplate(saved, naming("MBR"))).toBe(false);
    expect(runsWithSavedTemplate(t("open", SIG), naming("MBR"))).toBe(true);
  });

  it("keeps a template saved for one sheet off the other sheets", () => {
    const hinted = t("ab", SIG, { sheetHint: "MB AB" });
    expect(runsWithSavedTemplate(hinted, { ...card, sourceSheet: "MB Restart" })).toBe(false);
    expect(runsWithSavedTemplate(hinted, { ...card, sourceSheet: "MB AB" })).toBe(true);
  });
});
