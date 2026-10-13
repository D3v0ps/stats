// Runs before the app hydrates. zod 4 probes for eval with `new Function("")` when it builds
// its first object schema; the CSP refuses that, and although zod falls back to its
// interpreter the browser reports a violation on every page load. jitless skips the probe.
import { config } from "zod";

config({ jitless: true });
