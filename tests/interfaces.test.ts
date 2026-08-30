import { describe, expect, it } from "bun:test";
import { createHttpApp, EventHistory } from "../src/interfaces/http/app";
import type { HarnessFacade } from "../src/interfaces/contracts";

function fakeFacade(): HarnessFacade {
  const runs = new Map<string, { id: string; status: string }>();
  return {
    listSuites: () => ["smoke"],
    getSuiteCases: () => [{ id: "one" }],
    startCompare: (request) => { const run = { id: "run-test", status: "queued", suite: request.suite }; runs.set(run.id, run); return run; },
    getRun: (id) => runs.get(id) ?? null,
    getResults: (id) => runs.has(id) ? { id, pairs: [] } : null,
    cancelRun: (id) => runs.has(id) ? { id, status: "cancelled" } : null,
    exportRun: (id) => runs.has(id) ? { id, report: true } : null,
  };
}

describe("XOXO HTTP interface", () => {
  it("returns health, suites, and starts a run", async () => {
    const { app } = createHttpApp(fakeFacade());
    expect((await app.handle(new Request("http://localhost/healthz"))).status).toBe(200);
    expect(await (await app.handle(new Request("http://localhost/v1/suites"))).json()).toEqual({ suites: ["smoke"] });
    const response = await app.handle(new Request("http://localhost/v1/runs" , { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suite: "smoke", x: { provider: "claude", model: "a" }, y: { provider: "codex", model: "b" } }) }));
    expect(response.status).toBe(202);
  });

  it("replays events after Last-Event-ID", async () => {
    const history = new EventHistory();
    history.publish({ runId: "run-test", id: "run-test-1", type: "status", data: { status: "queued" } });
    history.publish({ runId: "run-test", id: "run-test-2", type: "completed", data: { status: "completed" } });
    const { app } = createHttpApp(fakeFacade(), { eventHistory: history });
    const response = await app.handle(new Request("http://localhost/v1/runs/run-test/events", { headers: { "last-event-id": "run-test-1" } }));
    const reader = response.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain("run-test-2");
    await reader.cancel();
  });
});
