import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeValue } from "@/lib/core/normalize";
import { createTestDb, type Db } from "./harness";

// private.normalize_label must agree with normalizeValue(): aliases are keyed on it, so any
// drift silently breaks lookups. The SQL regexes use \u escapes (migrations are sent as text
// through the Supabase API, where literal invisible characters could be lost).
const SAMPLES = [
  "  Budbee   Södertälje ",
  "PostNord AB",
  "Post​nord",
  "Early⁠Bird AB",
  "A　B﻿",
  "Tab\tand\nnewline",
  "Ögon Läkare ",
  "Hair space ogham math",
  "ÅÄÖ åäö",
];

describe("private.normalize_label", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it.each(SAMPLES)("matches normalizeValue for %j", async (input) => {
    const res = await db.query<{ norm: string }>("select private.normalize_label($1) as norm", [
      input,
    ]);
    expect(res.rows[0]?.norm).toBe(normalizeValue(input));
  });
});
