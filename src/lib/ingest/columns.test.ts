import { describe, expect, it } from "vitest";
import { inferColumnType, isLockedRemoved, suggestMappings } from "./columns";
import type { CellValue, WorkingTable } from "./working";

function table(
  columns: string[],
  rows: CellValue[][],
  headers?: Record<string, string>,
): WorkingTable {
  return {
    columns,
    headers: headers ?? Object.fromEntries(columns.map((c) => [c, c])),
    rows: rows.map((r, i) => ({
      sourceRow: i + 2,
      values: Object.fromEntries(columns.map((c, j) => [c, r[j] ?? null])),
    })),
  };
}

const PNR = "121212-1212";

describe("inferColumnType", () => {
  it.each([
    [[1, 2, 3.5], undefined, "number"],
    [["8,5", "7", "1 200"], undefined, "number"],
    [["1 200 kr", "300 kr", "45 kr"], undefined, "amount"],
    [["8,5 h", "7:30", "6 tim"], undefined, "hours"],
    [["12 %", "5,5 %"], undefined, "percent"],
    [["2026-09-30", "30/9 2026", "2026-10-01"], undefined, "date"],
    [["Acme", "Beta", "Gamma"], undefined, "text"],
    [[1200, 300], "Belopp", "amount"],
    [[8.5, 7], "Antal timmar", "hours"],
    [[8.5, 7], "Timmar", "hours"],
    [[12.5, 3], "Andel %", "percent"],
    [[5, 3], "Antal pass", "number"],
    [["1001", "1002"], undefined, "number"],
  ] as const)("%j (%s) -> %s", (samples, header, type) => {
    expect(inferColumnType([...samples], header).type).toBe(type);
  });

  it("needs 80 % support for a type", () => {
    const mixed = inferColumnType(["1", "2", "3", "x", "y"]);
    expect(mixed.type).toBe("text");
    const mostly = inferColumnType(["1", "2", "3", "4", "x"]);
    expect(mostly).toEqual({ type: "number", confidence: 0.8 });
  });

  it("ignores empty values and handles no samples", () => {
    expect(inferColumnType([null, "", " ", 3])).toEqual({ type: "number", confidence: 1 });
    expect(inferColumnType([])).toEqual({ type: "text", confidence: 0 });
  });

  it("counts ambiguous numbers as numeric", () => {
    expect(inferColumnType(["1.234", "2.345"]).type).toBe("number");
  });
});

describe("suggestMappings", () => {
  const t = table(
    [
      "kund",
      "datum",
      "anställnings id",
      "personnummer",
      "namn",
      "e-post",
      "timmar",
      "pass",
      "kommentar",
      "status",
    ],
    Array.from({ length: 60 }, (_, i) => [
      i % 2 ? "Acme AB" : "Beta AB",
      `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
      String(1000 + (i % 7)),
      i === 0 ? PNR : null,
      `Person ${i}`,
      `p${i}@example.se`,
      8.5,
      1,
      `Fri text nummer ${i}`,
      i % 3 ? "Attesterad" : "Utkast",
    ]),
    {
      kund: "Kund",
      datum: "Datum",
      "anställnings id": "Anställnings id",
      personnummer: "Personnummer",
      namn: "Namn",
      "e-post": "E-post",
      timmar: "Timmar",
      pass: "Pass",
      kommentar: "Kommentar",
      status: "Status",
    },
  );
  const m = Object.fromEntries(
    suggestMappings(t, { datasetKey: "ip_timmar" }).map((x) => [x.column, x]),
  );

  it("removes personnummer columns and locks them", () => {
    expect(m.personnummer).toMatchObject({ usage: "ignore", personal: true, keep: false });
  });

  it("defaults other personal columns to removed", () => {
    expect(m.namn).toMatchObject({ personal: true, keep: false });
    expect(m["e-post"]).toMatchObject({ personal: true, keep: false });
  });

  it("maps dates to period, numbers to measures with metric suggestions", () => {
    expect(m.datum).toMatchObject({ type: "date", usage: "period", keep: true });
    expect(m.timmar).toMatchObject({ type: "hours", usage: "measure", metricKey: "timmar" });
    expect(m.pass).toMatchObject({ usage: "measure", metricKey: "pass" });
  });

  it("maps ids and low-cardinality text to dimensions; free text is ignored", () => {
    expect(m["anställnings id"]).toMatchObject({
      type: "text",
      usage: "dimension",
      dimensionKey: "konsult",
      personal: false,
    });
    expect(m.kund).toMatchObject({ usage: "dimension", dimensionKey: "kund" });
    expect(m.status).toMatchObject({ usage: "dimension" });
    expect(m.status!.dimensionKey).toBeUndefined();
    expect(m.kommentar).toMatchObject({ usage: "ignore", keep: true });
  });

  it("suggests only dimensions that belong to the dataset", () => {
    const x = suggestMappings(table(["ort"], [["Malmö"], ["Lund"]]), { datasetKey: "ip_timmar" });
    expect(x[0]!.dimensionKey).toBeUndefined();
    const y = suggestMappings(table(["ort"], [["Malmö"], ["Lund"]]), {
      datasetKey: "wb_deltagare",
    });
    expect(y[0]!.dimensionKey).toBe("ort");
  });

  it("maps numeric codes under a dimension or number header to dimensions, not measures", () => {
    const m = suggestMappings(
      table(
        ["kostnadsställe", "konto", "kundnr", "belopp"],
        [
          [100, 3010, 50123, "1 200"],
          [200, 4010, 50124, "900"],
          [100, 3010, 50125, "300"],
        ],
      ),
      { datasetKey: "budget" },
    );
    expect(m[0]).toMatchObject({ usage: "dimension", dimensionKey: "kostnadsstalle" });
    expect(m[1]).toMatchObject({ usage: "dimension", dimensionKey: "kontogrupp" });
    expect(m[2]).toMatchObject({ usage: "dimension" });
    expect(m[3]).toMatchObject({ usage: "measure", type: "amount" });
  });

  it("finds a company column", () => {
    const x = suggestMappings(
      table(
        ["bolag", "belopp"],
        [
          ["MB AB", 1],
          ["MB Restart", 2],
        ],
      ),
    );
    expect(x[0]).toMatchObject({ usage: "company" });
    expect(x[1]).toMatchObject({ usage: "measure", type: "amount" });
    expect(x[1]!.metricKey).toBeUndefined();
  });

  it("suggests case usages for cases datasets", () => {
    const x = suggestMappings(
      table(
        ["gen-nummer", "tjänst", "startdatum", "slutdatum", "avbrott", "resultat"],
        [
          ["GEN1", "KROM", "2026-01-10", "2026-06-30", "", "Arbete"],
          ["GEN2", "ROM2", "2026-02-01", "", "Ja", ""],
        ],
      ),
      { datasetKey: "wb_deltagare" },
    );
    expect(x.map((c) => c.usage)).toEqual([
      "case_key",
      "dimension",
      "case_start",
      "case_end",
      "case_interrupt",
      "case_result",
    ]);
    expect(x[1]!.dimensionKey).toBe("verksamhet");
  });

  it("does not pick a measure metric across datasets", () => {
    const x = suggestMappings(table(["belopp"], [[100]]), { datasetKey: "ip_fakturering" });
    expect(x[0]!.metricKey).toBeUndefined();
    const y = suggestMappings(table(["fakturerat belopp", "lönekostnad"], [[100, 50]]), {
      datasetKey: "ip_fakturering",
    });
    expect(y.map((c) => c.metricKey)).toEqual(["fakturerat_ip", "lonekostnad"]);
  });
});

describe("isLockedRemoved", () => {
  const mapping = {
    column: "anställnings id",
    type: "text" as const,
    usage: "dimension" as const,
    personal: false,
    keep: true,
  };

  it("locks columns whose header says personnummer", () => {
    expect(isLockedRemoved({ ...mapping, column: "personnummer" }, [])).toBe(true);
  });

  it("locks columns with any personnummer value", () => {
    expect(isLockedRemoved(mapping, ["1001", "1002", PNR])).toBe(true);
    expect(isLockedRemoved(mapping, [1001, 1212121212])).toBe(true);
  });

  it("does not lock ordinary id columns or org numbers", () => {
    expect(isLockedRemoved(mapping, ["1001", "1002"])).toBe(false);
    expect(isLockedRemoved({ ...mapping, column: "org.nr" }, ["556959-9318"])).toBe(false);
  });
});
