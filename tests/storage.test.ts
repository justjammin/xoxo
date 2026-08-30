import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XoxoDatabase } from "../src/infrastructure/storage/database.ts";
import { ArtifactStore, redactText } from "../src/infrastructure/artifacts/index.ts";
import { candidateSchema, providerResultSchema } from "../src/domain/index.ts";

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("storage and artifacts", () => {
  test("writes WAL database and sequences events", () => {
    const root = mkdtempSync(join(tmpdir(), "xoxo-db-")); paths.push(root);
    const db = new XoxoDatabase(join(root, "state.sqlite"));
    const config = { suiteId: "smoke", x: candidateSchema.parse({ provider: "claude", model: "a" }), y: candidateSchema.parse({ provider: "codex", model: "b" }), trials: 1, timeoutMs: 10, concurrency: 1 };
    db.createRun({ id: "run-test", suiteId: "smoke", config });
    db.createAttempt({ id: "attempt-test", runId: "run-test", caseId: "one", trial: 0, side: "x", state: "running" });
    db.appendEvent("attempt-test", { type: "message", timestamp: new Date().toISOString(), text: "a", metadata: {} });
    db.appendEvent("attempt-test", { type: "message", timestamp: new Date().toISOString(), text: "b", metadata: {} });
    expect(db.listEvents("attempt-test").map((event) => event.sequence)).toEqual([0, 1]);
    expect(db.getRun("run-test")?.state).toBe("queued");
    db.close();
  });
  test("redacts secrets and prevents path escape", () => {
    expect(redactText("Authorization: Bearer super-secret-token-value")).toContain("[REDACTED]");
    const root = mkdtempSync(join(tmpdir(), "xoxo-artifacts-")); paths.push(root);
    const store = new ArtifactStore(root);
    const record = store.write("run-test", "output", "attempts/one/final.txt", "api-key: sk-ant-123456789012345");
    expect(new TextDecoder().decode(store.read(record))).toContain("[REDACTED]");
    expect(() => store.write("run-test", "other", "../../escape", "bad")).toThrow();
  });
});
