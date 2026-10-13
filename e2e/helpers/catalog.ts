// Ids the seed created (dimension values, import templates), read back through the service role
// so specs can open entity and settings pages directly. Ids are never hard-coded: kund, uppdrag
// and konsult values get theirs when an upload is published.
import { createE2eAdminClient } from "./admin";
import { resolveLocalSupabase } from "./local-supabase";

const admin = () => createE2eAdminClient(resolveLocalSupabase());

export interface DimensionValue {
  id: number;
  label: string;
}

export async function dimensionValues(dimensionKey: string): Promise<DimensionValue[]> {
  const { data, error } = await admin()
    .from("dimension_values")
    .select("id, label, dimensions!inner(key)")
    .eq("dimensions.key", dimensionKey)
    .order("id");
  if (error) throw new Error(`Could not read ${dimensionKey} values (${error.code}).`);
  return data.map(({ id, label }) => ({ id, label }));
}

export async function dimensionValueId(dimensionKey: string, label: string): Promise<number> {
  const value = (await dimensionValues(dimensionKey)).find((v) => v.label === label);
  if (!value) throw new Error(`No ${dimensionKey} value "${label}": did the seed run?`);
  return value.id;
}

/** Any saved import template (the seed saves several). */
export async function someImportTemplateId(): Promise<string> {
  const { data, error } = await admin()
    .from("import_templates")
    .select("id")
    .order("name")
    .limit(1);
  if (error) throw new Error(`Could not read import templates (${error.code}).`);
  const id = data[0]?.id;
  if (!id) throw new Error("No import template: did the seed run?");
  return id;
}
