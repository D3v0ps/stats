// Hand-built fixtures for the metric engine tests (not a test file itself).
import type { CompanyCode } from "@/lib/contracts/domain";
import {
  MetricQuerySchema,
  type MetricDefinition,
  type MetricQuery,
} from "@/lib/contracts/metric-query";
import type { z } from "zod";
import { catalogAccountGroups, catalogDefinitions } from "./catalog";
import {
  MemoryMetricDataSource,
  type MemoryFact,
  type MemoryLedgerRow,
  type MemorySourceInput,
} from "./memory-source";

export const DEFS: MetricDefinition[] = catalogDefinitions();

export const ID = {
  krom: 1,
  rom2: 2,
  kvl: 3,
  ikea: 101,
  volvo: 102,
  scania: 103,
  ericsson: 104,
  abb: 105,
  saab: 106,
  anna: 201,
  bo: 202,
  cecilia: 203,
  david: 204,
  ks100: 301,
  ks200: 302,
  kgIntakter: 401,
  kgPersonal: 402,
  kgResultat: 403,
  stockholm: 501,
  goteborg: 502,
  sjukLo: 601,
} as const;

export const LABELS: Record<string, Record<number, string>> = {
  verksamhet: { [ID.krom]: "KROM", [ID.rom2]: "ROM2", [ID.kvl]: "KVL" },
  kund: {
    [ID.ikea]: "IKEA",
    [ID.volvo]: "Volvo",
    [ID.scania]: "Scania",
    [ID.ericsson]: "Ericsson",
    [ID.abb]: "ABB",
    [ID.saab]: "Saab",
  },
  konsult: { [ID.anna]: "1001", [ID.bo]: "1002", [ID.cecilia]: "1003", [ID.david]: "1004" },
  kostnadsstalle: { [ID.ks100]: "Bemanning Stockholm", [ID.ks200]: "Restart Göteborg" },
  kontogrupp: {
    [ID.kgIntakter]: "Intäkter",
    [ID.kgPersonal]: "Personal",
    [ID.kgResultat]: "Resultat",
  },
  ort: { [ID.stockholm]: "Stockholm", [ID.goteborg]: "Göteborg" },
  franvarotyp: { [ID.sjukLo]: "Sjuk LO" },
};

/** kontogrupp value codes are the account group keys. */
export const CODES: Record<string, Record<number, string>> = {
  kontogrupp: {
    [ID.kgIntakter]: "intakter",
    [ID.kgPersonal]: "personal",
    [ID.kgResultat]: "resultat",
  },
};

export function fact(
  uploadId: string,
  metricKey: string,
  company: CompanyCode,
  month: string,
  value: number,
  dims: Record<string, number> = {},
): MemoryFact {
  return { uploadId, metricKey, company, month, value, dims };
}

export function ledgerRow(
  uploadId: string,
  company: CompanyCode,
  month: string,
  account: number,
  amount: number,
  opts: { objectValueId?: number; yearOffset?: number } = {},
): MemoryLedgerRow {
  const isObject = opts.objectValueId !== undefined;
  return {
    uploadId,
    company,
    month,
    account,
    amount,
    dimNo: isObject ? 1 : null,
    objectValueId: opts.objectValueId ?? null,
    yearOffset: opts.yearOffset ?? 0,
  };
}

/** A source over the seeded catalog; every upload id seen in the rows is current unless given. */
export function makeSource(
  input: Partial<MemorySourceInput> & { facts?: MemoryFact[]; ledger?: MemoryLedgerRow[] },
): MemoryMetricDataSource {
  const facts = input.facts ?? [];
  const ledger = input.ledger ?? [];
  const current =
    input.current ??
    new Set([
      ...facts.map((f) => f.uploadId),
      ...ledger.map((r) => r.uploadId),
      ...(input.slices ?? []).map((s) => s.uploadId),
    ]);
  return new MemoryMetricDataSource({
    definitions: DEFS,
    accountGroups: catalogAccountGroups(),
    labels: LABELS,
    codes: CODES,
    ...input,
    facts,
    ledger,
    current,
  });
}

export function query(input: z.input<typeof MetricQuerySchema>): MetricQuery {
  return MetricQuerySchema.parse(input);
}

/** Facts for each month of a list: [month, value] pairs. */
export function monthlyFacts(
  uploadId: string,
  metricKey: string,
  company: CompanyCode,
  values: [string, number][],
  dims: Record<string, number> = {},
): MemoryFact[] {
  return values.map(([month, value]) => fact(uploadId, metricKey, company, month, value, dims));
}
