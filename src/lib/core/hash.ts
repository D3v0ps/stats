// SHA-256 via Web Crypto, available in browsers, Web Workers and Node 22.

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: subtle.digest rejects views over
  // SharedArrayBuffer, and TextEncoder output is already fresh.
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (const b of view) out += HEX[b];
  return out;
}

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace. Used for
 * content hashes, where key order must never change the hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    if (value === undefined) return "null";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
