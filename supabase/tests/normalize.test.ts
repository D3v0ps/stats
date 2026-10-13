import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeValue } from "@/lib/core/normalize";
import { cleanLabel } from "@/lib/db/repo/shared";
import { createTestDb, type Db } from "./harness";

// private.normalize_label must agree with normalizeValue() and private.clean_label with
// cleanLabel(): aliases are keyed on them, so any drift silently breaks lookups. The SQL
// avoids literal invisible characters (migrations are sent as text through the Supabase API).
const SAMPLES = [
  "  Budbee   Södertälje ",
  "PostNord\u00a0AB",
  "Post\u200bnord",
  "Early\u2060Bird\u202fAB",
  "A\u3000B\ufeff",
  "Tab\tand\nnewline",
  "Ögon\u2028Läkare\u2029",
  "Hair\u200aspace\u1680ogham\u205fmath",
  "ÅÄÖ åäö",
];

describe("label normalization parity", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it.each(SAMPLES)("private.normalize_label matches normalizeValue for %j", async (input) => {
    const res = await db.query<{ norm: string }>("select private.normalize_label($1) as norm", [
      input,
    ]);
    expect(res.rows[0]?.norm).toBe(normalizeValue(input));
  });

  it.each(SAMPLES)("private.clean_label matches cleanLabel for %j", async (input) => {
    const res = await db.query<{ clean: string }>("select private.clean_label($1) as clean", [
      input,
    ]);
    expect(res.rows[0]?.clean).toBe(cleanLabel(input));
  });
});
