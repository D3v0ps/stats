// Module worker that parses dropped files off the main thread. It is a thin
// shell: every request is answered by IngestService, which calls the ingest and
// SIE libraries. The same service runs on the main thread when workers are
// unavailable (see src/components/import/ingest-client.ts).
import {
  IngestService,
  type WorkerEnvelope,
  type WorkerReply,
} from "@/lib/import-ui/ingest-service";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerEnvelope>) => void): void;
  postMessage(message: WorkerReply): void;
}

const scope = self as unknown as WorkerScope;
const service = new IngestService();

// Requests are answered in order: a preview must never overtake the read it depends on.
let queue: Promise<void> = Promise.resolve();

scope.addEventListener("message", (event) => {
  const { id, req } = event.data;
  queue = queue
    .then(async () => {
      try {
        scope.postMessage({ id, res: await service.handle(req) });
      } catch {
        // A reply that cannot be sent must still answer the request.
        scope.postMessage({ id, res: { ok: false, error: "Filen kunde inte läsas." } });
      }
    })
    // Never leave the chain rejected: every later request would wait forever.
    .catch(() => undefined);
});
