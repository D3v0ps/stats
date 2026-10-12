// Intrinsic size of a PNG from its IHDR chunk, so the logo can be rendered with next/image at
// its true aspect ratio without hard-coding dimensions for a file that is added later.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  // The first chunk must be IHDR: length (4 bytes) + "IHDR" + width + height (big-endian).
  const type = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (type !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
