import { Elysia } from "elysia";
import { join, resolve } from "node:path";
import { asPromise, type CompareRequest, type HarnessFacade, type RunEvent } from "../contracts";

export interface HttpOptions {
  /** Bind address is loopback by default; callers must opt in to a public bind. */
  host?: string;
  port?: number;
  eventHistory?: EventHistory;
}

/** Small replay buffer used by SSE and useful for transports in tests. */
export class EventHistory {
  private readonly events = new Map<string, RunEvent[]>();
  private readonly listeners = new Map<string, Set<(event: RunEvent) => void>>();

  publish(event: RunEvent) {
    const list = this.events.get(event.runId) ?? [];
    list.push({ ...event, id: event.id ?? `${event.runId}-${list.length + 1}` });
    if (list.length > 2_000) list.splice(0, list.length - 2_000);
    this.events.set(event.runId, list);
    for (const listener of this.listeners.get(event.runId) ?? []) listener(list.at(-1)!);
  }

  replay(runId: string, lastEventId?: string | null) {
    const list = this.events.get(runId) ?? [];
    if (!lastEventId) return [...list];
    const index = list.findIndex((event) => event.id === lastEventId);
    return index < 0 ? [...list] : list.slice(index + 1);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void) {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(runId);
    };
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function eventStream(runId: string, history: EventHistory, facade: HarnessFacade, request: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribeFacade: (() => void) | undefined;
  let unsubscribeHistory: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let wake: (() => void) | undefined;
  const queue: RunEvent[] = history.replay(runId, request.headers.get("last-event-id"));

  const push = (event: RunEvent) => {
    queue.push(event);
    wake?.();
    wake = undefined;
  };
  unsubscribeHistory = history.subscribe(runId, push);
  unsubscribeFacade = facade.subscribe?.(runId, (event) => {
    history.publish(event);
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        const id = event.id ? `id: ${event.id}\n` : "";
        const sequence = Number(event.id?.split("-").at(-1)) || Date.now();
        const envelope = { seq: sequence, kind: event.type, payload: event.data, createdAt: event.timestamp };
        controller.enqueue(encoder.encode(`${id}event: ${event.type}\ndata: ${JSON.stringify(envelope)}\n\n`));
      };
      const dispose = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribeHistory?.();
        unsubscribeFacade?.();
        request.signal.removeEventListener("abort", dispose);
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", dispose, { once: true });
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
      const drain = () => {
        while (queue.length && !closed) send(queue.shift()!);
      };
      drain();
      const wait = async () => {
        while (!closed) {
          if (!queue.length) await new Promise<void>((resolve) => { wake = resolve; });
          drain();
        }
      };
      void wait();
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribeHistory?.();
      unsubscribeFacade?.();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

export function createHttpApp(facade: HarnessFacade, options: HttpOptions = {}) {
  const history = options.eventHistory ?? new EventHistory();
  const app = new Elysia({ name: "xoxo" })
    .get("/healthz", () => ({ ok: true, service: "xoxo" }))
    .get("/", async () => {
      const index = Bun.file(join(process.cwd(), "dist", "web", "index.html"));
      return await index.exists() ? new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } }) : { service: "xoxo", ui: "run `xoxo dev` for the Vite workspace" };
    })
    .get("/assets/*", async ({ params, set }) => {
      const name = String((params as Record<string, string>)["*"] ?? "");
      const root = resolve(process.cwd(), "dist", "web", "assets");
      const path = resolve(root, name);
      if (!path.startsWith(`${root}/`)) { set.status = 404; return { error: "asset not found" }; }
      const file = Bun.file(path);
      if (!(await file.exists())) { set.status = 404; return { error: "asset not found" }; }
      return new Response(file);
    })
    .get("/v1/capabilities", async () => (facade.capabilities ? await asPromise(facade.capabilities()) : { providers: ["claude", "codex"] }))
    .get("/v1/suites", async () => ({ suites: await asPromise(facade.listSuites()) }))
    .get("/v1/suites/:suite/cases", async ({ params }) => ({ cases: await asPromise(facade.getSuiteCases?.(params.suite) ?? []) }))
    .post("/v1/runs", async ({ body, set }) => {
      try {
        const payload = (body ?? {}) as Record<string, unknown>;
        const request = { ...payload, suite: payload.suite ?? payload.suiteId } as CompareRequest;
        const run = await facade.startCompare(request);
        set.status = 202;
        return { ...run, runId: run.id, statusUrl: `/v1/runs/${run.id}`, eventsUrl: `/v1/runs/${run.id}/events` };
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    })
    .get("/v1/runs", async () => ({ runs: facade.listRuns ? await asPromise(facade.listRuns()) : [] }))
    .get("/v1/runs/:id", async ({ params, set }) => {
      const run = await asPromise(facade.getRun(params.id));
      if (!run) { set.status = 404; return { error: "run not found" }; }
      return run;
    })
    .get("/v1/runs/:id/results", async ({ params, set }) => {
      if (!facade.getResults) { set.status = 404; return { error: "results unavailable" }; }
      const result = await asPromise(facade.getResults(params.id));
      if (result == null) { set.status = 404; return { error: "run not found" }; }
      return result;
    })
    .get("/v1/runs/:id/events", ({ params, request }) => eventStream(params.id, history, facade, request))
    .post("/v1/runs/:id/cancel", async ({ params, set }) => {
      if (!facade.cancelRun) { set.status = 501; return { error: "cancellation unavailable" }; }
      const result = await asPromise(facade.cancelRun(params.id));
      if (result == null || result === false) { set.status = 404; return { error: "run not found" }; }
      return result === true ? { id: params.id, status: "cancelled" } : result;
    })
    .post("/v1/runs/:id/export", async ({ params, body, set }) => {
      if (!facade.exportRun) { set.status = 501; return { error: "export unavailable" }; }
      const format = typeof body === "object" && body && "format" in body ? String((body as { format?: unknown }).format) : "html";
      const result = await asPromise(facade.exportRun(params.id, format));
      if (result == null) { set.status = 404; return { error: "run not found" }; }
      return result;
    });

  return { app, history, host: options.host ?? "127.0.0.1", port: options.port ?? 4242 };
}

export type XoxoHttpApp = ReturnType<typeof createHttpApp>;
