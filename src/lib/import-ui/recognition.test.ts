import { describe, expect, it } from "vitest";
import {
  planJobs,
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
  });
});
