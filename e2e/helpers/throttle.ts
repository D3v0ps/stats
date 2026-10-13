import { randomInt } from "node:crypto";

export { clearLoginThrottle } from "./local-supabase";

/**
 * A random address in 2001:db8::/32, the documentation range. The login throttle buckets by the
 * first x-forwarded-for entry, which `next start` keeps as sent, so each test gets its own bucket.
 */
export function documentationIp(): string {
  const groups = Array.from({ length: 6 }, () => randomInt(0, 0x10000).toString(16));
  return `2001:db8:${groups.join(":")}`;
}
