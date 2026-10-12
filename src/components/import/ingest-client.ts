// Talks to the ingest worker. Requests carry an id and resolve with the typed
// response. When module workers are unavailable (old browsers, tests) or the
// worker fails to start, the same IngestService runs on the main thread.
import type {
  IngestRequest,
  IngestResponse,
  ResponseFor,
  WorkerEnvelope,
  WorkerReply,
} from "@/lib/import-ui/ingest-service";

export interface IngestClient {
  call<R extends IngestRequest>(req: R): Promise<ResponseFor<R>>;
  dispose(): void;
  /** "worker" or "main" (fallback), for diagnostics. */
  readonly mode: "worker" | "main";
}

type Pending = { req: IngestRequest; resolve: (res: IngestResponse) => void };

/** The service on the main thread, loaded on first use. */
function inlineHandler(): (req: IngestRequest) => Promise<IngestResponse> {
  let service: Promise<{ handle(req: IngestRequest): Promise<IngestResponse> }> | null = null;
  return async (req) => {
    service ??= import("@/lib/import-ui/ingest-service").then((m) => new m.IngestService());
    return (await service).handle(req);
  };
}

export function createIngestClient(): IngestClient {
  const inline = inlineHandler();
  let worker: Worker | null = null;
  if (typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("../../workers/ingest.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      worker = null;
    }
  }

  let nextId = 1;
  const pending = new Map<number, Pending>();
  let broken = worker === null;

  const fallBack = () => {
    if (broken) return;
    broken = true;
    worker?.terminate();
    worker = null;
    // Re-run what the worker never answered. Files it had read are gone with it,
    // so requests that need them get the service's "read the file again" message.
    for (const [id, p] of pending) {
      pending.delete(id);
      void inline(p.req).then(p.resolve);
    }
  };

  if (worker) {
    worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      pending.delete(event.data.id);
      p.resolve(event.data.res);
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      fallBack();
    });
    worker.addEventListener("messageerror", fallBack);
  }

  return {
    get mode() {
      return broken ? "main" : "worker";
    },
    call<R extends IngestRequest>(req: R): Promise<ResponseFor<R>> {
      if (broken || !worker) return inline(req) as Promise<ResponseFor<R>>;
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, { req, resolve: resolve as (res: IngestResponse) => void });
        try {
          worker!.postMessage({ id, req } satisfies WorkerEnvelope);
        } catch {
          fallBack();
        }
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.resolve({ ok: false, error: "Avbrutet." });
      pending.clear();
    },
  };
}
