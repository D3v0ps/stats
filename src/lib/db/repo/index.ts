// Typed data access over a SupabaseClient<Database>. Clients are created elsewhere
// (src/lib/db/client-*.ts); every function here takes one as its first argument.
export * from "./catalog";
export * from "./dashboards";
export * from "./metrics";
export * from "./reports";
export * from "./settings";
export * from "./templates";
export * from "./uploads";
export { DbError, type DbClient } from "./shared";
