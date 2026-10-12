import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// Proves the in-process Postgres used by the SQL test suite starts in this environment.
describe("pglite", () => {
  it("runs Postgres in-process", async () => {
    const db = new PGlite();
    const res = await db.query<{ v: number; ver: string }>(
      "select 1 as v, current_setting('server_version') as ver",
    );
    expect(res.rows[0]?.v).toBe(1);
    expect(Number(res.rows[0]?.ver.split(".")[0])).toBeGreaterThanOrEqual(16);
    await db.close();
  });
});
