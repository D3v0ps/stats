// A small but complete in-memory dataset over the seeded catalog for the dashboard and
// Utforska tests (not a test file itself): both companies, every dataset of the start
// dashboard, a budget for MB AB and two customers with assignments and consultants.
import type { UrlFilters } from "@/lib/app/filters";
import type { CompanyCode } from "@/lib/contracts/domain";
import { monthRange } from "@/lib/core/month";
import {
  MemoryMetricDataSource,
  catalogAccountGroups,
  catalogDefinitions,
  type MemoryFact,
  type MemoryLedgerRow,
} from "@/lib/metrics";
import { SEEDED_DIMENSION_META } from "./metrics-meta";

export const T = {
  krom: 1,
  rom2: 2,
  bemanning: 4,
  budbee: 101,
  ikea: 102,
  budbeeSodertalje: 111,
  ikeaLager: 112,
  anna: 201,
  bo: 202,
  cecilia: 203,
  stockholm: 501,
  kgIntakter: 401,
  sjuk: 601,
} as const;

export const TEST_LABELS: Record<string, Record<number, string>> = {
  verksamhet: { [T.krom]: "KROM", [T.rom2]: "ROM2", [T.bemanning]: "Bemanning" },
  kund: { [T.budbee]: "Budbee Södertälje", [T.ikea]: "IKEA" },
  uppdrag: { [T.budbeeSodertalje]: "Lager natt", [T.ikeaLager]: "Plock" },
  konsult: { [T.anna]: "Anna A", [T.bo]: "Bo B", [T.cecilia]: "Cecilia C" },
  ort: { [T.stockholm]: "Stockholm" },
  kontogrupp: { [T.kgIntakter]: "Intäkter" },
  franvarotyp: { [T.sjuk]: "Sjuk" },
};

export const MONTHS = monthRange("2025-01", "2026-09");
export const ANCHOR = "2026-09";
export const DEFINITIONS = catalogDefinitions();
export const DIMENSIONS = SEEDED_DIMENSION_META;
export const FILTERS: UrlFilters = { company: "ALL", grain: "month", anchor: null };

function f(
  uploadId: string,
  metricKey: string,
  company: CompanyCode,
  month: string,
  value: number,
  dims: Record<string, number> = {},
): MemoryFact {
  return { uploadId, metricKey, company, month, value, dims };
}

function ledger(
  uploadId: string,
  company: CompanyCode,
  month: string,
  account: number,
  amount: number,
): MemoryLedgerRow {
  return {
    uploadId,
    company,
    month,
    account,
    amount,
    dimNo: null,
    objectValueId: null,
    yearOffset: 0,
  };
}

/** Assignment rows: [kund, uppdrag, konsult, hours]. */
const WORK: [number, number, number, number][] = [
  [T.budbee, T.budbeeSodertalje, T.anna, 120],
  [T.budbee, T.budbeeSodertalje, T.bo, 80],
  [T.ikea, T.ikeaLager, T.cecilia, 60],
];

export function buildFacts(options: { budget?: boolean } = {}): {
  facts: MemoryFact[];
  ledger: MemoryLedgerRow[];
  scenarios: Record<string, "utfall" | "budget">;
} {
  const facts: MemoryFact[] = [];
  const rows: MemoryLedgerRow[] = [];
  MONTHS.forEach((m, i) => {
    const grow = 1 + i * 0.02;
    for (const [kund, uppdrag, konsult, h] of WORK) {
      const dims = { kund, uppdrag, konsult };
      facts.push(
        f("ip-t", "timmar", "MBAB", m, Math.round(h * grow), { ...dims, verksamhet: T.bemanning }),
      );
      facts.push(
        f("ip-t", "pass", "MBAB", m, Math.round((h * grow) / 8), {
          ...dims,
          verksamhet: T.bemanning,
        }),
      );
      facts.push(f("ip-f", "fakturerat_ip", "MBAB", m, Math.round(h * grow * 450), dims));
      facts.push(f("ip-f", "lonekostnad", "MBAB", m, Math.round(h * grow * 250), dims));
      facts.push(
        f("ip-s", "sjuktimmar", "MBAB", m, konsult === T.bo ? 8 : 0, {
          ...dims,
          franvarotyp: T.sjuk,
        }),
      );
      facts.push(
        f("ip-s", "sjukpass", "MBAB", m, konsult === T.bo ? 1 : 0, {
          ...dims,
          franvarotyp: T.sjuk,
        }),
      );
    }
    facts.push(
      f("wb", "aktiva_deltagare", "MBR", m, 40 + i, { verksamhet: T.krom, ort: T.stockholm }),
    );
    facts.push(f("wb", "aktiva_deltagare", "MBR", m, 25, { verksamhet: T.rom2, ort: T.stockholm }));
    facts.push(f("wb", "nya_deltagare", "MBR", m, 6, { verksamhet: T.krom, ort: T.stockholm }));
    facts.push(
      f("wb", "avslutade_deltagare", "MBR", m, 5, { verksamhet: T.krom, ort: T.stockholm }),
    );
    facts.push(
      f("wb", "resultat_deltagare", "MBR", m, 2, { verksamhet: T.krom, ort: T.stockholm }),
    );
    facts.push(f("fx-k", "fakturerat_kund", "MBAB", m, 160_000, { kund: T.budbee }));
    facts.push(f("fx-k", "fakturerat_kund", "MBAB", m, 30_000, { kund: T.ikea }));
    // Revenue is negative in SIE; costs positive.
    rows.push(ledger("fx-mbab", "MBAB", m, 3010, -200_000 * grow));
    rows.push(ledger("fx-mbab", "MBAB", m, 7010, 150_000));
    rows.push(ledger("fx-mbr", "MBR", m, 3010, -120_000));
    rows.push(ledger("fx-mbr", "MBR", m, 5010, 90_000));
    // budget_belopp is stored in SIE sign too: a revenue budget of 230 000 kr is negative.
    if (options.budget && m >= "2026-01") {
      facts.push(f("bud", "budget_belopp", "MBAB", m, -230_000, { kontogrupp: T.kgIntakter }));
    }
  });
  return { facts, ledger: rows, scenarios: { bud: "budget" } };
}

export function buildSource(
  options: { budget?: boolean; empty?: boolean } = {},
): MemoryMetricDataSource {
  const {
    facts,
    ledger: rows,
    scenarios,
  } = options.empty ? { facts: [], ledger: [], scenarios: {} } : buildFacts(options);
  return new MemoryMetricDataSource({
    definitions: DEFINITIONS,
    accountGroups: catalogAccountGroups(),
    facts,
    ledger: rows,
    current: ["ip-t", "ip-f", "ip-s", "wb", "fx-k", "fx-mbab", "fx-mbr", "bud"],
    scenarios,
    labels: TEST_LABELS,
    codes: { kontogrupp: { [T.kgIntakter]: "intakter" } },
    uploadTimes: {
      "ip-t": "2026-10-05T08:00:00Z",
      "fx-mbab": "2026-10-08T08:00:00Z",
      wb: "2026-10-03T08:00:00Z",
    },
  });
}
