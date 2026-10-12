// Staging sends facts and ledger rows to the server in chunks. Each chunk is one
// Server Action request, which Next caps at 1 MB, so chunks are bounded both by
// row count and by their serialized size (a fact's source row list can be long).

/** Rows per chunk (the repo's insert chunk size). */
export const STAGE_MAX_ITEMS = 2000;
/** Serialized bytes per chunk, well below the 1 MB Server Action body limit. */
export const STAGE_MAX_BYTES = 600_000;

const encoder = new TextEncoder();

/** UTF-8 size of the JSON form of a value. */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

export interface ChunkOptions<T> {
  maxItems?: number;
  maxBytes?: number;
  sizeOf?: (item: T) => number;
}

/**
 * Split items into chunks of at most maxItems items and maxBytes bytes. An item
 * larger than maxBytes on its own still gets a chunk of its own (never dropped).
 */
export function chunkBySize<T>(items: readonly T[], opts: ChunkOptions<T> = {}): T[][] {
  const maxItems = opts.maxItems ?? STAGE_MAX_ITEMS;
  const maxBytes = opts.maxBytes ?? STAGE_MAX_BYTES;
  const sizeOf = opts.sizeOf ?? jsonBytes;
  if (!Number.isInteger(maxItems) || maxItems < 1) throw new Error(`Invalid maxItems: ${maxItems}`);
  if (!(maxBytes > 0)) throw new Error(`Invalid maxBytes: ${maxBytes}`);

  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    // +1 for the comma between array entries.
    const size = sizeOf(item) + 1;
    if (current.length > 0 && (current.length >= maxItems || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Whole percent 0–100 for a progress bar. */
export function progressPercent(done: number, total: number): number {
  if (!(total > 0)) return done > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}
