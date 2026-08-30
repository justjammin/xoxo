import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

describe("XOXO end-to-end CLI", () => {
  let root: string;
  const project = resolve(import.meta.dir, "..");
  const fakeAgent = resolve(import.meta.dir, "fixtures", "fake-agent.ts");

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "xoxo-e2e-"));
    await chmod(fakeAgent, 0o755);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("runs X and Y, grades evidence, persists artifacts, and exits cleanly", async () => {
    const proc = Bun.spawn([
      process.execPath,
      "run",
      resolve(project, "src/interfaces/cli/main.ts"),
      "compare",
      resolve(project, "examples/smoke.yaml"),
      "--case",
      "reads-before-editing",
      "--x",
      "claude:fake-claude",
      "--y",
      "codex:fake-codex",
      "--trials",
      "1",
    ], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
        XOXO_CLAUDE_BIN: fakeAgent,
        XOXO_CODEX_BIN: fakeAgent,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout) as { run: { id: string; status: string; verdict: string }; results: { attempts: unknown[]; pairs: unknown[] } };
    expect(payload.run.status).toBe("completed");
    expect(payload.run.verdict).toBe("pass");
    expect(payload.results.attempts).toHaveLength(2);
    expect(payload.results.pairs).toHaveLength(1);
    expect(await Bun.file(join(root, ".xoxo", "state.sqlite")).exists()).toBe(true);
    expect(await Bun.file(join(root, ".xoxo", "runs", payload.run.id, "manifest.json")).exists()).toBe(true);
  }, 15_000);
});
