// Import templates and their immutable versions. Configs are validated with
// TemplateConfigSchema both when written and when read back.
import {
  ImportTemplateSchema,
  TemplateConfigSchema,
  type ImportTemplate,
  type TemplateConfig,
} from "@/lib/contracts/pipeline";
import type { Json, Tables } from "../types";
import { check, fetchAll, unwrap, unwrapMaybe, type DbClient } from "./shared";

export interface StoredTemplate extends ImportTemplate {
  id: string;
  kind: TemplateConfig["kind"];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVersionInfo {
  version: number;
  config: TemplateConfig;
  createdAt: string;
}

function headerSignature(value: Json): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function toStoredTemplate(
  row: Tables<"import_templates">,
  datasetKey: string,
  version: Pick<Tables<"import_template_versions">, "version" | "config">,
): StoredTemplate {
  const config = TemplateConfigSchema.parse(version.config);
  if (config.kind !== row.kind) {
    throw new Error(
      `Mallen ${row.name} har typ ${row.kind} men version ${version.version} är ${config.kind}`,
    );
  }
  return {
    id: row.id,
    datasetKey,
    name: row.name,
    kind: config.kind,
    headerSignature: headerSignature(row.header_signature),
    ...(row.sheet_hint ? { sheetHint: row.sheet_hint } : {}),
    version: version.version,
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function datasetMaps(db: DbClient) {
  const rows = unwrap("datasets", await db.from("datasets").select("id, key"));
  return {
    keyById: new Map(rows.map((r) => [r.id, r.key])),
    idByKey: new Map(rows.map((r) => [r.key, r.id])),
  };
}

/** Templates with their current version, optionally for one dataset. */
export async function listTemplates(
  db: DbClient,
  opts: { datasetKey?: string } = {},
): Promise<StoredTemplate[]> {
  const { keyById, idByKey } = await datasetMaps(db);
  let q = db.from("import_templates").select("*");
  if (opts.datasetKey) {
    const id = idByKey.get(opts.datasetKey);
    if (id === undefined) return [];
    q = q.eq("dataset_id", id);
  }
  const templates = unwrap("import_templates", await q.order("name").order("id"));
  if (templates.length === 0) return [];
  // Every version of every listed template: page past max_rows, or templates whose
  // current version falls beyond the first page would silently disappear.
  const versions = await fetchAll("import_template_versions", (from, to) =>
    db
      .from("import_template_versions")
      .select("template_id, version, config")
      .in(
        "template_id",
        templates.map((t) => t.id),
      )
      .order("template_id")
      .order("version")
      .range(from, to),
  );
  return templates.flatMap((t) => {
    const v = versions.find((x) => x.template_id === t.id && x.version === t.current_version);
    return v ? [toStoredTemplate(t, keyById.get(t.dataset_id) ?? String(t.dataset_id), v)] : [];
  });
}

/** A template at its current version (or the given one), or null. */
export async function getTemplate(
  db: DbClient,
  id: string,
  version?: number,
): Promise<StoredTemplate | null> {
  const row = unwrapMaybe(
    "import_templates",
    await db.from("import_templates").select("*").eq("id", id).maybeSingle(),
  );
  if (!row) return null;
  const v = unwrapMaybe(
    "import_template_versions",
    await db
      .from("import_template_versions")
      .select("version, config")
      .eq("template_id", id)
      .eq("version", version ?? row.current_version)
      .maybeSingle(),
  );
  if (!v) return null;
  const { keyById } = await datasetMaps(db);
  return toStoredTemplate(row, keyById.get(row.dataset_id) ?? String(row.dataset_id), v);
}

export async function listTemplateVersions(
  db: DbClient,
  id: string,
): Promise<TemplateVersionInfo[]> {
  const rows = unwrap(
    "import_template_versions",
    await db
      .from("import_template_versions")
      .select("version, config, created_at")
      .eq("template_id", id)
      .order("version"),
  );
  return rows.map((r) => ({
    version: r.version,
    config: TemplateConfigSchema.parse(r.config),
    createdAt: r.created_at,
  }));
}

/** Create a template with version 1. */
export async function createTemplate(db: DbClient, input: ImportTemplate): Promise<StoredTemplate> {
  const tpl = ImportTemplateSchema.parse(input);
  const { idByKey } = await datasetMaps(db);
  const datasetId = idByKey.get(tpl.datasetKey);
  if (datasetId === undefined) throw new Error(`Okänd datakälla: ${tpl.datasetKey}`);

  const row = unwrap(
    "import_templates.insert",
    await db
      .from("import_templates")
      .insert({
        dataset_id: datasetId,
        name: tpl.name,
        kind: tpl.config.kind,
        current_version: 1,
        header_signature: tpl.headerSignature,
        sheet_hint: tpl.sheetHint ?? null,
      })
      .select("*")
      .single(),
  );
  const version = await db
    .from("import_template_versions")
    .insert({ template_id: row.id, version: 1, config: tpl.config as unknown as Json });
  if (version.error) {
    await db.from("import_templates").delete().eq("id", row.id);
    check("import_template_versions.insert", version);
  }
  return toStoredTemplate(row, tpl.datasetKey, {
    version: 1,
    config: tpl.config as unknown as Json,
  });
}

/**
 * Save a changed mapping as a new version (versions are immutable, so uploads keep
 * pointing at the exact mapping they used). Returns the new version number.
 */
export async function createTemplateVersion(
  db: DbClient,
  id: string,
  change: {
    config: TemplateConfig;
    headerSignature?: string[];
    sheetHint?: string | null;
    name?: string;
  },
): Promise<number> {
  const config = TemplateConfigSchema.parse(change.config);
  const row = unwrap(
    "import_templates",
    await db.from("import_templates").select("*").eq("id", id).single(),
  );
  if (config.kind !== row.kind)
    throw new Error(`Mallen är av typen ${row.kind}, inte ${config.kind}`);
  const next = row.current_version + 1;
  check(
    "import_template_versions.insert",
    await db
      .from("import_template_versions")
      .insert({ template_id: id, version: next, config: config as unknown as Json }),
  );
  check(
    "import_templates.update",
    await db
      .from("import_templates")
      .update({
        current_version: next,
        ...(change.headerSignature ? { header_signature: change.headerSignature } : {}),
        ...(change.sheetHint !== undefined ? { sheet_hint: change.sheetHint } : {}),
        ...(change.name ? { name: change.name } : {}),
      })
      .eq("id", id),
  );
  return next;
}

/** Delete a template (refused by the database while uploads reference it). */
export async function deleteTemplate(db: DbClient, id: string): Promise<void> {
  check("import_templates.delete", await db.from("import_templates").delete().eq("id", id));
}
