import { describe, expect, it } from "vitest";
import { createFakeClient } from "./fake-client";
import { listReportFilterValues } from "./present-extra";
import { catalogTables } from "./test-fixtures";

describe("listReportFilterValues", () => {
  it("returns active values of non-personal dimensions only, in sort order", async () => {
    const tables = catalogTables();
    const dimId = (key: string) =>
      (tables.dimensions as { id: number; key: string }[]).find((d) => d.key === key)!.id;
    tables.dimension_values!.push(
      {
        id: 900,
        dimension_id: dimId("konsult"),
        code: "1001",
        label: "1001",
        sort: 0,
        active: true,
      },
      {
        id: 901,
        dimension_id: dimId("kund"),
        code: "volvo",
        label: "Volvo",
        sort: 0,
        active: true,
      },
      { id: 902, dimension_id: dimId("kund"), code: "abb", label: "ABB", sort: 0, active: true },
      {
        id: 903,
        dimension_id: dimId("kund"),
        code: "gammal",
        label: "Gammal",
        sort: 0,
        active: false,
      },
    );
    const { client, calls } = createFakeClient({ tables });
    const values = await listReportFilterValues(client);

    expect(values.konsult).toBeUndefined();
    expect(values.kund).toEqual([
      { id: 902, label: "ABB" },
      { id: 901, label: "Volvo" },
    ]);
    expect(values.verksamhet?.map((v) => v.label)).toEqual([
      "ROM2",
      "KROM",
      "KVL",
      "Karriärvägledning",
      "Stöd och matchning",
      "Bemanning",
    ]);
    // Personal values are not even requested.
    const query = calls.find((c) => c.target === "dimension_values");
    const ids = query?.filters.find((f) => f.op === "in")?.value as number[];
    expect(ids).not.toContain(dimId("konsult"));
  });

  it("skips the query when every dimension is personal", async () => {
    const { client, calls } = createFakeClient();
    const values = await listReportFilterValues(client, [
      { id: 1, key: "konsult", label: "Konsult", personal: true, unknownPolicy: "auto_create" },
    ]);
    expect(values).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
