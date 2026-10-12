// SHA-256 via Web Crypto, available in browsers, workers and Node 22 alike.

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: subtle.digest rejects shared buffers.
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}
