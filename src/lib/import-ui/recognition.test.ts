import { describe, expect, it } from "vitest";
import type { CompanyCode } from "@/lib/contracts";
import { suggestCompany, type CompanySuggestion } from "@/lib/ingest/recognize";
import {
  companyFit,
  contradictsCompany,
  planJobs,
  runsWithSavedTemplate,
  sheetNamesCompany,
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

/**
 * What suggestCompany returns for "MBR"/"MBAB" in a file name (0.9). The only weak word is a
 * bare "Miljonbemanning", which names MBAB at 0.6.
 */
const names = (company: CompanyCode, confidence = 0.9): CompanySuggestion => ({
  company,
  source: "filename",
  confidence,
});
const MBR_ORG_NR: CompanySuggestion = { company: "MBR", source: "meta", confidence: 0.98 };

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
    const plan = (templates: RecognitionTemplate[], company?: CompanySuggestion, sig = SIG) =>
      planJobs({
        defaultSheet: "Blad1",
        sheetForHint: {},
        signatures: { Blad1: sig },
        companies: { Blad1: company ?? null },
        templates,
      });
    const picked = (jobs: ReturnType<typeof planJobs>) =>
      jobs[0]?.kind === "new" ? null : jobs[0]?.template.id;
    const newerMbr = { ...mbr, updatedAt: "2026-09-01" };

    it("picks the template fixed to the company the file names, not the newest", () => {
      expect(picked(plan([mbab, mbr], names("MBR")))).toBe("mbr");
      expect(picked(plan([mbr, mbab], names("MBAB")))).toBe("mbab");
      expect(picked(plan([{ ...mbab, updatedAt: "2025-01-01" }, mbr], names("MBAB")))).toBe("mbab");
      // A weak hint ("Miljonbemanning" alone) still breaks the tie.
      expect(picked(plan([newerMbr, mbab], names("MBAB", 0.6)))).toBe("mbab");
    });

    it("falls back to the newest when the file names no company", () => {
      expect(picked(plan([mbr, mbab]))).toBe("mbab");
    });

    it("prefers an open template over one fixed to the other company", () => {
      const open = t("open", SIG, { updatedAt: "2025-01-01" });
      expect(picked(plan([mbab, open], names("MBR")))).toBe("open");
      expect(picked(plan([newerMbr, open], names("MBAB", 0.6)))).toBe("open");
      expect(picked(plan([mbab, open], names("MBAB")))).toBe("mbab");
    });

    it("lets a weak company hint decide between equally changed templates, never over a closer one", () => {
      const changed = ["kund", "datum", "antal timmar", "status"];
      expect(plan([newerMbr, mbab], names("MBAB", 0.6), changed)[0]).toMatchObject({
        kind: "drift",
        template: { id: "mbab" },
      });
      const closer = t("closer", ["kund", "datum", "antal timmar", "status", "x"], {
        company: "MBR",
      });
      const other = t("other", ["kund", "datum", "antal timmar", "y", "z"], { company: "MBAB" });
      expect(picked(plan([closer, other], names("MBAB", 0.6), changed))).toBe("closer");
    });

    it("maps a file that clearly names the other company as new when only one template exists", () => {
      // Saved for MB AB in one session, the MB Restart file uploaded later.
      expect(plan([mbab], names("MBR"))).toEqual([{ kind: "new", sheetName: "Blad1" }]);
      expect(plan([mbab], { company: "MBR", source: "meta", confidence: 0.98 })).toEqual([
        { kind: "new", sheetName: "Blad1" },
      ]);
      expect(plan([mbr], names("MBAB", 0.85))).toEqual([{ kind: "new", sheetName: "Blad1" }]);
      // "Restart" alone in the file name is enough.
      expect(plan([mbab], suggestCompany("deltagare restart.xlsx", [])!)).toEqual([
        { kind: "new", sheetName: "Blad1" },
      ]);
    });

    it("does not book the other company's file with a template that took its drift", () => {
      // Workbuster added a column; accepting it on the MB AB file updated only that template.
      const added = [...SIG, "kommun"];
      const drifted = { ...mbab, headerSignature: added, updatedAt: "2026-10-01" };
      expect(plan([drifted, mbr], names("MBR"), added)).toMatchObject([
        { kind: "drift", template: { id: "mbr" }, diff: { added: ["kommun"] } },
      ]);
      expect(picked(plan([drifted, mbr], names("MBAB"), added))).toBe("mbab");
    });

    it("still uses the only template when the file names no company, or only weakly", () => {
      expect(plan([mbab])).toMatchObject([{ kind: "known", template: { id: "mbab" } }]);
      expect(plan([mbr], suggestCompany("miljonbemanning.xlsx", [])!)).toMatchObject([
        { kind: "known", template: { id: "mbr" } },
      ]);
    });

    it("keeps a sheet's own template whatever company the file name says", () => {
      const sig = ["post", "jan", "feb"];
      const jobs = planJobs({
        defaultSheet: "MB AB",
        sheetForHint: { "MB AB": "MB AB", "MB Restart": "MB Restart" },
        signatures: { "MB AB": sig, "MB Restart": sig },
        sheetOrder: ["MB AB", "MB Restart"],
        companies: { "MB AB": names("MBR"), "MB Restart": names("MBR") },
        templates: [
          t("ab", sig, { sheetHint: "MB AB", company: "MBAB" }),
          t("r", sig, { sheetHint: "MB Restart", company: "MBR" }),
        ],
      });
      expect(
        jobs.map((j) => [j.kind, j.sheetName, j.kind === "known" ? j.template.id : null]),
      ).toEqual([
        ["known", "MB AB", "ab"],
        ["known", "MB Restart", "r"],
      ]);
    });

    it("lets the file's company rule on a hinted sheet whose generic name names no company", () => {
      // Saved from a multi-sheet MB AB export, so the template remembers its sheet; the
      // MB Restart export has the same sheet names.
      const plan = (hint: string, company: CompanySuggestion, templates: RecognitionTemplate[]) =>
        planJobs({
          defaultSheet: hint,
          sheetForHint: { [hint]: hint },
          signatures: { [hint]: SIG, Info: ["om", "rapporten"] },
          sheetOrder: [hint, "Info"],
          companies: { [hint]: company, Info: company },
          templates,
        });
      for (const hint of ["Blad1", "Deltagare"]) {
        const ab = t("ab", SIG, { sheetHint: hint, company: "MBAB" });
        expect(plan(hint, names("MBR"), [ab])).toEqual([{ kind: "new", sheetName: hint }]);
        expect(plan(hint, MBR_ORG_NR, [ab])).toEqual([{ kind: "new", sheetName: hint }]);
        expect(plan(hint, names("MBAB"), [ab])).toMatchObject([
          { kind: "known", template: { id: "ab" } },
        ]);
        const r = t("r", SIG, { sheetHint: hint, company: "MBR", updatedAt: "2025-01-01" });
        expect(plan(hint, names("MBR"), [ab, r])).toMatchObject([
          { kind: "known", template: { id: "r" } },
        ]);
      }
    });

    it("offers a sheet only the other company's template fits as new, next to known sheets", () => {
      const budget = ["post", "jan", "feb"];
      const kinds = (blad1: string[]) =>
        planJobs({
          defaultSheet: "Blad1",
          sheetForHint: { Budget: "Budget" },
          signatures: { Blad1: blad1, Budget: budget },
          sheetOrder: ["Blad1", "Budget"],
          companies: { Blad1: names("MBR"), Budget: names("MBR") },
          templates: [mbab, t("budget", budget, { sheetHint: "Budget" })],
        }).map((j) => [j.kind, j.sheetName]);
      expect(kinds(SIG)).toEqual([
        ["new", "Blad1"],
        ["known", "Budget"],
      ]);
      // A ruled-out template that would not have fitted anyway adds no card.
      expect(kinds(["kund", "belopp", "moms", "fakturanr"])).toEqual([["known", "Budget"]]);
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

describe("sheetNamesCompany", () => {
  it("is true only when the sheet hint names the company the template fixes", () => {
    expect(sheetNamesCompany({ sheetHint: "MB AB", company: "MBAB" })).toBe(true);
    expect(sheetNamesCompany({ sheetHint: "MB Restart", company: "MBR" })).toBe(true);
    expect(sheetNamesCompany({ sheetHint: "MB Restart", company: "MBAB" })).toBe(false);
    expect(sheetNamesCompany({ sheetHint: "Blad1", company: "MBAB" })).toBe(false);
    expect(sheetNamesCompany({ sheetHint: "Deltagare", company: "MBR" })).toBe(false);
    expect(sheetNamesCompany({ sheetHint: "MB AB" })).toBe(false);
    expect(sheetNamesCompany({ company: "MBAB" })).toBe(false);
  });
});

describe("contradictsCompany", () => {
  it("rules out the other company's template on an org number or a name, not on weak hints", () => {
    const mbab = { company: "MBAB" as const };
    const orgNr: CompanySuggestion = { company: "MBR", source: "meta", confidence: 0.98 };
    expect(contradictsCompany(mbab, orgNr)).toBe(true);
    expect(contradictsCompany(mbab, names("MBR"))).toBe(true);
    expect(contradictsCompany(mbab, names("MBR", 0.85))).toBe(true);
    expect(contradictsCompany(mbab, names("MBR", 0.8))).toBe(false);
    expect(contradictsCompany(mbab, names("MBAB"))).toBe(false);
    expect(contradictsCompany(mbab, null)).toBe(false);
    expect(contradictsCompany({}, names("MBR"))).toBe(false);
  });
});

describe("runsWithSavedTemplate", () => {
  const saved = t("mbab", SIG, { company: "MBAB" });
  const card = {
    status: "new" as const,
    signature: ["datum", "kund", "timmar", "status"],
    suggestions: { period: [], company: null },
  };
  const naming = (company: CompanyCode) => ({
    ...card,
    suggestions: { period: [], company: names(company) },
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
    const restart = {
      ...card,
      suggestions: { period: [], company: suggestCompany("restart.xlsx", []) },
    };
    expect(runsWithSavedTemplate(saved, restart)).toBe(false);
    expect(runsWithSavedTemplate(t("open", SIG), naming("MBR"))).toBe(true);
    const own = t("r", SIG, { sheetHint: "MB Restart", company: "MBR" });
    expect(runsWithSavedTemplate(own, { ...naming("MBAB"), sourceSheet: "MB Restart" })).toBe(true);
  });

  it("leaves the other company's card on a generically named sheet", () => {
    // Both companies' multi-sheet exports dropped together, the MB AB one mapped first.
    for (const hint of ["Blad1", "Deltagare"]) {
      const hinted = t("ab", SIG, { sheetHint: hint, company: "MBAB" });
      const on = { sourceSheet: hint };
      expect(runsWithSavedTemplate(hinted, { ...naming("MBR"), ...on })).toBe(false);
      expect(
        runsWithSavedTemplate(hinted, {
          ...card,
          ...on,
          suggestions: { period: [], company: MBR_ORG_NR },
        }),
      ).toBe(false);
      expect(runsWithSavedTemplate(hinted, { ...naming("MBAB"), ...on })).toBe(true);
      expect(runsWithSavedTemplate(hinted, { ...card, ...on })).toBe(true);
    }
  });

  it("decides as planJobs does for the same file dropped after the save", () => {
    const hints = [
      null,
      names("MBR", 0.6),
      names("MBR", 0.8),
      names("MBR"),
      MBR_ORG_NR,
      names("MBAB"),
    ];
    const templates = [
      saved,
      t("blad1", SIG, { company: "MBAB", sheetHint: "Blad1" }),
      t("named", SIG, { company: "MBAB", sheetHint: "MB AB" }),
    ];
    for (const template of templates) {
      const sheet = template.sheetHint ?? "Blad1";
      for (const company of hints) {
        const dropped = planJobs({
          defaultSheet: sheet,
          sheetForHint: template.sheetHint ? { [sheet]: sheet } : {},
          signatures: { [sheet]: card.signature },
          companies: { [sheet]: company },
          templates: [template],
        });
        const queued = { ...card, sourceSheet: sheet, suggestions: { period: [], company } };
        expect(
          runsWithSavedTemplate(template, queued),
          `${template.id} ${JSON.stringify(company)}`,
        ).toBe(dropped[0]?.kind === "known");
      }
    }
  });

  it("keeps a template saved for one sheet off the other sheets", () => {
    const hinted = t("ab", SIG, { sheetHint: "MB AB" });
    expect(runsWithSavedTemplate(hinted, { ...card, sourceSheet: "MB Restart" })).toBe(false);
    expect(runsWithSavedTemplate(hinted, { ...card, sourceSheet: "MB AB" })).toBe(true);
  });
});
