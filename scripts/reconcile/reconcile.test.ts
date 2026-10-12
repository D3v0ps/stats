// Drives scripts/reconcile/reconcile.py as a black box: exit codes, the diff table and the
// selftest. Skipped when python3 with pandas + openpyxl is not installed (the script is a
// manual tool for Karim's real files and is not part of the app's runtime).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/reconcile/reconcile.py");
const FILES = join(ROOT, "fixtures/files");
const TRUTH = join(ROOT, "fixtures/truth");
const CONFIGS = join(ROOT, "scripts/reconcile/configs");

const hasPython =
  spawnSync("python3", ["-c", "import pandas, openpyxl"], { stdio: "ignore" }).status === 0;

const tmp = mkdtempSync(join(tmpdir(), "mb-reconcile-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  status: number | null;
  out: string;
}

function reconcile(args: string[]): Run {
  const r = spawnSync("python3", ["-I", SCRIPT, ...args], { encoding: "utf8", timeout: 60_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function run(config: string, file: string, app: string, extra: string[] = []): Run {
  return reconcile(["--config", join(CONFIGS, config), "--file", file, "--app", app, ...extra]);
}

interface Fact {
  metricKey: string;
  company: string;
  month: string;
  dims: Record<string, string>;
  value: number;
}

const truthPath = (stem: string) => join(TRUTH, `${stem}.json`);
const readFacts = (stem: string) => JSON.parse(readFileSync(truthPath(stem), "utf8")) as Fact[];

function writeFacts(name: string, facts: Fact[]): string {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify(facts));
  return path;
}

const TIMMAR = join(FILES, "intelliplan_timmar_MBAB_2026-09.xlsx");
const TIMMAR_TRUTH = truthPath("intelliplan_timmar_MBAB_2026-09");

// Each case starts python3 + pandas (about half a second here); allow slow CI machines.
describe.skipIf(!hasPython)("reconcile.py", { timeout: 30_000 }, () => {
  it("--selftest reproduces every truth file", { timeout: 60_000 }, () => {
    const r = reconcile(["--selftest"]);
    expect(r.out).toContain("SELFTEST PASSED");
    expect(r.status).toBe(0);
  });

  it("exits 0 and says so when the app export matches the file", () => {
    const r = run("intelliplan_timmar.json", TIMMAR, TIMMAR_TRUTH, ["--dim", "kund"]);
    expect(r.out).toContain("OK – inga avvikelser / no differences");
    expect(r.status).toBe(0);
  });

  it("exits 1 with a Swedish/English diff table when the numbers differ", () => {
    const facts = readFacts("intelliplan_timmar_MBAB_2026-09");
    const target = facts.find((f) => f.metricKey === "timmar" && f.dims.kund === "PostNord AB");
    if (!target) throw new Error("fixture has no PostNord AB hours");
    target.value += 8;
    const r = run("intelliplan_timmar.json", TIMMAR, writeFacts("off-by-8.json", facts), [
      "--dim",
      "kund",
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Mått/Metric");
    expect(r.out).toContain("Fil/File");
    expect(r.out).toMatch(/timmar\s+MBAB\s+2026-09\s+PostNord AB\s+[\d ,]+\s+[\d ,]+\s+-8/);
    // 7 customers x 2 metrics compared, one differs.
    expect(r.out).toContain("AVVIKELSER / DIFFERENCES: 1 av / of 14");
  });

  it("applies --tolerance per compared row", () => {
    const facts = readFacts("intelliplan_timmar_MBAB_2026-09");
    const first = facts[0];
    if (!first) throw new Error("empty truth");
    first.value += 0.004;
    const app = writeFacts("off-by-0.004.json", facts);
    expect(run("intelliplan_timmar.json", TIMMAR, app).status).toBe(0);
    expect(run("intelliplan_timmar.json", TIMMAR, app, ["--tolerance", "0.001"]).status).toBe(1);
  });

  it("treats a missing fact as 0 and reports it", () => {
    const facts = readFacts("intelliplan_timmar_MBAB_2026-09").slice(1);
    const r = run("intelliplan_timmar.json", TIMMAR, writeFacts("dropped.json", facts), [
      "--dim",
      "all",
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("AVVIKELSER / DIFFERENCES: 1 av / of");
  });

  it("exits 2, not 1, when the raw file does not exist", () => {
    const r = run("intelliplan_timmar.json", join(tmp, "missing.xlsx"), TIMMAR_TRUTH);
    expect(r.status).toBe(2);
    expect(r.out).toContain("FEL / ERROR");
    expect(r.out).not.toContain("Traceback");
  });

  it("exits 2 when the raw file is corrupt", () => {
    const broken = join(tmp, "broken.xlsx");
    writeFileSync(broken, Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.alloc(64)]));
    const r = run("intelliplan_timmar.json", broken, TIMMAR_TRUTH);
    expect(r.status).toBe(2);
    expect(r.out).not.toContain("Traceback");
  });

  it("exits 2 when the config is incomplete", () => {
    const config = join(tmp, "incomplete.json");
    writeFileSync(config, JSON.stringify({ kind: "table" }));
    const r = reconcile(["--config", config, "--file", TIMMAR, "--app", TIMMAR_TRUTH]);
    expect(r.status).toBe(2);
    expect(r.out).not.toContain("Traceback");
  });

  it("exits 2 when the app export is not a list of facts", () => {
    const app = join(tmp, "not-facts.json");
    writeFileSync(app, JSON.stringify([{ metricKey: "timmar" }]));
    expect(run("intelliplan_timmar.json", TIMMAR, app).status).toBe(2);
  });

  it("keeps each budget sheet's own company when --company is given", () => {
    const r = run("budget.json", join(FILES, "budget_2026.xlsx"), truthPath("budget_2026"), [
      "--company",
      "MBAB",
    ]);
    expect(r.out).toContain("OK – inga avvikelser");
    expect(r.status).toBe(0);
  });

  it.each([
    ["a title line", "Frånvarorapport september 2026\r\n\r\n"],
    ["an Excel sep= hint and a title line", "sep=;\r\nFrånvarorapport september 2026\r\n"],
  ])("reads a CSV export with %s above the header", (_, prefix) => {
    const raw = readFileSync(join(FILES, "intelliplan_franvaro_MBAB_2026-09.csv"));
    const csv = join(tmp, `franvaro_MBAB_${prefix.length}.csv`);
    writeFileSync(csv, Buffer.concat([Buffer.from(prefix, "latin1"), raw]));
    const r = run(
      "intelliplan_franvaro.json",
      csv,
      truthPath("intelliplan_franvaro_MBAB_2026-09"),
      ["--dim", "all"],
    );
    expect(r.out).toContain("OK – inga avvikelser");
    expect(r.status).toBe(0);
  });

  it("never prints personnummer or names, even with every row shown", () => {
    const r = run("intelliplan_timmar.json", TIMMAR, TIMMAR_TRUTH, ["--dim", "all", "--all"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/\b(\d{2})?\d{6}[-+]?\d{4}\b/);
    expect(r.out).not.toContain("Okänd arbetstagare");
    expect(r.out).not.toMatch(/Andersson|Johansson|Karlsson|Nilsson/);
  });
});
