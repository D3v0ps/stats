// Shared loader for the SIE fixture tests (fixtures/sie, written by
// scripts/fixtures/sie.ts). Test-only: imported from *.test.ts files.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SIE_FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/sie/", import.meta.url));

export const SIE_FIXTURES = [
  "mbab_2026_psaldo.se",
  "mbr_2026_trans_only.se",
  "mbab_2026_cumulative.se",
  "mbab_declared_pc8_but_1252.se",
  "mbr_broken_fy.se",
  "unknown_org.se",
] as const;

export type SieFixture = (typeof SIE_FIXTURES)[number];

type ByMonth = Record<string, number>;

export interface TruthYear {
  yearOffset: number;
  start: string;
  end: string;
  source: "psaldo" | "trans" | "none";
  resultYtd: number;
  resultPerMonth: ByMonth;
  /** account -> month -> amount (SIE sign) */
  accountMonth: Record<string, ByMonth>;
  /** dimNo -> object code -> account -> month -> amount */
  objectAccountMonth: Record<string, Record<string, Record<string, ByMonth>>>;
  /** kostnadsställe code -> month -> result */
  costCenterResultPerMonth: Record<string, ByMonth>;
  /** account -> month -> total minus the dimension 1 objects */
  unallocatedAccountMonth: Record<string, ByMonth>;
  res: Record<string, number>;
}

export interface SieTruth {
  file: string;
  company: "MBAB" | "MBR" | null;
  orgNr: string;
  companyName: string;
  encoding: "cp437" | "windows-1252";
  declaredFormat: string;
  psaldoMode: "movement" | "cumulative" | "none";
  usedTransFallback: boolean;
  voucherCount: number;
  rtransCount: number;
  btransCount: number;
  fiscalYears: Record<string, { start: string; end: string }>;
  accounts: Record<string, string>;
  objects: Record<string, Record<string, string>>;
  years: Record<string, TruthYear>;
}

export function readSieFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${SIE_FIXTURE_DIR}${name}`));
}

export function readSieTruth(name: string): SieTruth {
  const path = `${SIE_FIXTURE_DIR}truth/${name.replace(/\.se$/, ".json")}`;
  return JSON.parse(readFileSync(path, "utf8")) as SieTruth;
}
