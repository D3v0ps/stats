import { describe, expect, it } from "vitest";
import type { ImportTemplate, TemplateConfig } from "@/lib/contracts/pipeline";
import { createFakeClient } from "./fake-client";
import {
  createTemplate,
  createTemplateVersion,
  getTemplate,
  listTemplates,
  listTemplateVersions,
} from "./templates";
import { catalogTables } from "./test-fixtures";

const config: TemplateConfig = {
  kind: "table",
  steps: [{ op: "rename", column: "tid", to: "timmar" }],
  columns: [
    {
      column: "timmar",
      type: "hours",
      usage: "measure",
      metricKey: "timmar",
      personal: false,
      keep: true,
    },
    {
      column: "kund",
      type: "text",
      usage: "dimension",
      dimensionKey: "kund",
      personal: false,
      keep: true,
    },
  ],
  counters: [{ metricKey: "pass", kind: "count_rows" }],
  period: { kind: "per_upload" },
  company: { kind: "fixed", company: "MBAB" },
  scenario: "utfall",
};

const template: ImportTemplate = {
  datasetKey: "ip_timmar",
  name: "Intelliplan timmar",
  headerSignature: ["kund", "tid"],
  sheetHint: "Blad1",
  version: 1,
  config,
};

describe("import templates", () => {
  it("creates a template with version 1 and reads it back", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    const created = await createTemplate(client, template);
    expect(created).toMatchObject({
      datasetKey: "ip_timmar",
      name: "Intelliplan timmar",
      kind: "table",
      version: 1,
      sheetHint: "Blad1",
      config,
    });
    expect(tables.import_templates?.[0]).toMatchObject({
      dataset_id: 1,
      kind: "table",
      current_version: 1,
      header_signature: ["kund", "tid"],
    });
    expect(tables.import_template_versions).toEqual([
      expect.objectContaining({ template_id: created.id, version: 1, config }),
    ]);
    expect(await getTemplate(client, created.id)).toMatchObject({
      id: created.id,
      version: 1,
      config,
    });
    expect(await listTemplates(client, { datasetKey: "ip_timmar" })).toHaveLength(1);
    expect(await listTemplates(client, { datasetKey: "wb_deltagare" })).toEqual([]);
  });

  it("saves changes as a new immutable version", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    const created = await createTemplate(client, template);
    const changed: TemplateConfig = { ...config, steps: [] };
    expect(
      await createTemplateVersion(client, created.id, {
        config: changed,
        headerSignature: ["kund", "timmar"],
      }),
    ).toBe(2);
    expect(tables.import_templates?.[0]).toMatchObject({
      current_version: 2,
      header_signature: ["kund", "timmar"],
    });
    expect((await getTemplate(client, created.id))?.config).toEqual(changed);
    expect((await getTemplate(client, created.id, 1))?.config).toEqual(config);
    expect((await listTemplateVersions(client, created.id)).map((v) => v.version)).toEqual([1, 2]);
    await expect(
      createTemplateVersion(client, created.id, { config: { kind: "sie", objectDims: [1] } }),
    ).rejects.toThrow(/typen table/);
  });

  it("removes the template row when the first version cannot be saved", async () => {
    const { client, tables } = createFakeClient({
      tables: catalogTables(),
      fail: (c) =>
        c.target === "import_template_versions" && c.kind === "insert" ? { message: "fel" } : null,
    });
    await expect(createTemplate(client, template)).rejects.toThrow(/fel/);
    expect(tables.import_templates).toEqual([]);
  });

  it("rejects invalid configs, on write and on read", async () => {
    const { client, tables } = createFakeClient({ tables: catalogTables() });
    await expect(
      createTemplate(client, {
        ...template,
        config: { kind: "table" } as unknown as TemplateConfig,
      }),
    ).rejects.toThrow();
    tables.import_templates = [
      {
        id: "t1",
        dataset_id: 1,
        name: "X",
        kind: "table",
        current_version: 1,
        header_signature: [],
        sheet_hint: null,
        created_at: "",
        updated_at: "",
      },
    ];
    tables.import_template_versions = [
      { template_id: "t1", version: 1, config: { kind: "table", columns: "nej" } },
    ];
    await expect(getTemplate(client, "t1")).rejects.toThrow();
    expect(await getTemplate(client, "missing")).toBeNull();
  });
});
