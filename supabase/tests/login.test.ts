import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "./fixtures";
import { asService, createTestDb, type Db } from "./harness";

interface Gate {
  allowed: boolean;
  retry_after_s: number;
  delay_ms: number;
  attempt_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("login throttle", () => {
  let db: Db;

  const gate = async (ip: string): Promise<Gate> =>
    asService(db, async (tx) => {
      const res = await tx.query<{ g: Gate }>(`select public.login_gate($1) as g`, [ip]);
      return res.rows[0]!.g;
    });
  const record = (attemptId: string | null, ok: boolean) =>
    asService(db, (tx) => tx.query(`select public.login_record($1, $2)`, [attemptId, ok]));
  /** A whole login attempt the way the server action makes it: gate (must allow), then record. */
  const attempt = async (ip: string, ok: boolean) => {
    const g = await gate(ip);
    expect(g.allowed).toBe(true);
    await record(g.attempt_id, ok);
  };
  /** Insert past, finalized attempts directly (as the owner) at now() - minutesAgo. */
  const history = async (ip: string, minutesAgo: number[], ok = false) => {
    await db.query(
      `insert into private.login_attempts (ip_hash, at, ok)
       select $1, now() - make_interval(secs => m * 60), $3 from unnest($2::float8[]) as m`,
      [ip, minutesAgo, ok],
    );
  };
  const rows = async (ip: string) =>
    (
      await db.query<{ ok: boolean | null }>(
        `select ok from private.login_attempts where ip_hash = $1 order by at`,
        [ip],
      )
    ).rows.map((r) => r.ok);
  const ipHash = (name: string) => sha256(name);
  const block = (startMinutesAgo: number) => [0, 1, 2, 3, 4].map((i) => startMinutesAgo - i / 60);

  beforeAll(async () => {
    db = await createTestDb();
  });
  beforeEach(async () => {
    await db.query(`delete from private.login_attempts`);
  });
  afterAll(async () => {
    await db.close();
  });

  it("allows a fresh ip hash without delay and registers the attempt as pending", async () => {
    const ip = ipHash("fresh");
    const g = await gate(ip);
    expect(g).toEqual({
      allowed: true,
      retry_after_s: 0,
      delay_ms: 0,
      attempt_id: expect.any(String),
    });
    expect(g.attempt_id).toMatch(UUID);
    expect(await rows(ip)).toEqual([null]);
    await record(g.attempt_id, true);
    expect(await rows(ip)).toEqual([true]);
  });

  it("locks an ip hash for 15 minutes after 5 failures within 15 minutes", async () => {
    const ip = ipHash("attacker");
    for (let i = 0; i < 4; i++) await attempt(ip, false);
    await attempt(ip, false);
    const g = await gate(ip);
    expect(g.allowed).toBe(false);
    expect(g.attempt_id).toBeNull();
    expect(g.retry_after_s).toBeGreaterThan(890);
    expect(g.retry_after_s).toBeLessThanOrEqual(900);
    expect((await gate(ipHash("someone else"))).allowed).toBe(true);
  });

  it("locks a burst of gates that are never recorded: pending attempts count as failures", async () => {
    const ip = ipHash("burst");
    const results: Gate[] = [];
    for (let i = 0; i < 10; i++) results.push(await gate(ip));
    expect(results.map((g) => g.allowed)).toEqual([
      ...Array<boolean>(5).fill(true),
      ...Array<boolean>(5).fill(false),
    ]);
    const ids = results.slice(0, 5).map((g) => g.attempt_id);
    expect(new Set(ids).size).toBe(5);
    expect(results.slice(5).every((g) => g.attempt_id === null && g.retry_after_s > 890)).toBe(
      true,
    );
    // Refused attempts are not registered, so they cannot extend the lock either.
    expect(await rows(ip)).toEqual([null, null, null, null, null]);
  });

  it("lets at most five of ten parallel gates through", async () => {
    const ip = ipHash("parallel");
    const results = await Promise.all(Array.from({ length: 10 }, () => gate(ip)));
    expect(results.filter((g) => g.allowed)).toHaveLength(5);
  });

  it("a success resets the history, also while other attempts are pending", async () => {
    const ip = ipHash("legit-burst");
    const pending = [await gate(ip), await gate(ip), await gate(ip), await gate(ip)];
    const ok = await gate(ip);
    await record(ok.attempt_id, true);
    expect((await gate(ip)).allowed).toBe(true);
    for (const g of pending) await record(g.attempt_id, false);
    expect((await gate(ip)).allowed).toBe(true);
  });

  it("does not count failures spread over more than 15 minutes", async () => {
    const ip = ipHash("slow");
    await history(ip, [60, 45, 30, 16]);
    await attempt(ip, false);
    expect((await gate(ip)).allowed).toBe(true);
  });

  it("unlocks after the lockout and resets on success", async () => {
    const ip = ipHash("expired");
    await history(ip, block(20));
    expect((await gate(ip)).allowed).toBe(true);

    const ok = ipHash("legit");
    await history(ok, [10, 9, 8, 7]);
    await attempt(ok, true);
    await attempt(ok, false);
    expect((await gate(ok)).allowed).toBe(true);
  });

  it("doubles the lockout for every repeated lockout", async () => {
    const ip = ipHash("repeat");
    // Lockout 1 (15 min) three hours ago, lockout 2 (30 min) two hours ago, both expired.
    await history(ip, [...block(180), ...block(120)]);
    for (let i = 0; i < 5; i++) await attempt(ip, false);
    const g = await gate(ip);
    expect(g.allowed).toBe(false);
    expect(g.retry_after_s).toBeGreaterThan(3590);
    expect(g.retry_after_s).toBeLessThanOrEqual(3600);
  });

  it("keeps doubling within the 24 hour memory (7th lockout = 16 h)", async () => {
    const ip = ipHash("persistent");
    const starts: number[] = [];
    let start = 23 * 60;
    for (let n = 1; n <= 6; n++) {
      starts.push(start);
      start -= 15 * 2 ** (n - 1) + 1;
    }
    await history(ip, starts.flatMap(block));
    for (let i = 0; i < 5; i++) await attempt(ip, false);
    const g = await gate(ip);
    expect(g.allowed).toBe(false);
    expect(g.retry_after_s).toBeGreaterThan(16 * 3600 - 10);
    expect(g.retry_after_s).toBeLessThanOrEqual(16 * 3600);
  });

  it("ignores failures made while locked", async () => {
    const ip = ipHash("hammer");
    // Locked about 10 minutes ago, then 10 more failures during the lock: the lock still
    // ends 15 minutes after the 5th failure instead of being extended.
    await history(ip, [...block(10), ...Array.from({ length: 10 }, (_, i) => 9 - i / 2)]);
    const g = await gate(ip);
    expect(g.allowed).toBe(false);
    expect(g.retry_after_s).toBeGreaterThan(5 * 60);
    expect(g.retry_after_s).toBeLessThanOrEqual(5 * 60 + 5);
  });

  it("adds a global delay above 50 failures per hour, capped at 3000 ms, never a hard lock", async () => {
    // A successful probe, so the probe itself never adds a failure.
    const probe = async () => {
      const g = await gate(ipHash("user"));
      await record(g.attempt_id, true);
      return g;
    };
    for (let i = 0; i < 50; i++) await history(ipHash(`bot-${i}`), [30]);
    expect((await probe()).delay_ms).toBe(0);
    await history(ipHash("bot-50"), [20]);
    expect(await probe()).toMatchObject({ allowed: true, retry_after_s: 0, delay_ms: 1000 });
    for (let i = 51; i < 150; i++) await history(ipHash(`bot-${i}`), [10]);
    expect(await probe()).toMatchObject({ allowed: true, retry_after_s: 0, delay_ms: 3000 });
    // Failures older than an hour no longer count.
    await db.query(`update private.login_attempts set at = now() - interval '61 minutes'`);
    expect((await probe()).delay_ms).toBe(0);
  });

  it("counts pending attempts towards the global delay", async () => {
    for (let i = 0; i < 51; i++) await gate(ipHash(`pending-${i}`));
    expect((await gate(ipHash("user"))).delay_ms).toBe(1000);
  });

  it("deletes attempts older than 24 hours at the gate", async () => {
    await history(ipHash("old"), [25 * 60, 23 * 60]);
    await gate(ipHash("new"));
    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from private.login_attempts`,
    );
    expect(res.rows[0]?.n).toBe(2);
  });

  it("finalizes each attempt exactly once", async () => {
    const g = await gate(ipHash("once"));
    await record(g.attempt_id, false);
    await expect(record(g.attempt_id, true)).rejects.toThrow(/redan avslutat/);
    await expect(record(randomUUID(), false)).rejects.toThrow(/finns inte/);
    expect(await rows(ipHash("once"))).toEqual([false]);
  });

  it("rejects raw IP addresses and missing values", async () => {
    await expect(gate("192.168.10.1")).rejects.toThrow(/Ogiltig ip-hash/);
    await expect(gate("2001:db8::1")).rejects.toThrow(/Ogiltig ip-hash/);
    await expect(record(null, false)).rejects.toThrow(/Inloggningsförsök saknas/);
    const g = await gate(ipHash("x"));
    await expect(record(g.attempt_id, null as unknown as boolean)).rejects.toThrow(/Utfall saknas/);
  });

  it("is executable by service_role only and the attempt log is private", async () => {
    const roles = await db.query<{ role: string; gate: boolean; record: boolean; tbl: boolean }>(
      `select r as role,
         has_function_privilege(r, 'public.login_gate(text)', 'execute') as gate,
         has_function_privilege(r, 'public.login_record(uuid, boolean)', 'execute') as record,
         has_table_privilege(r, 'private.login_attempts', 'select') as tbl
       from unnest(array['anon', 'authenticated', 'service_role']) as r`,
    );
    expect(roles.rows).toEqual([
      { role: "anon", gate: false, record: false, tbl: false },
      { role: "authenticated", gate: false, record: false, tbl: false },
      { role: "service_role", gate: true, record: true, tbl: true },
    ]);
  });
});
