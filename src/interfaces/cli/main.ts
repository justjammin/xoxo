#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { asPromise, type CandidateConfig, type CompareRequest, type HarnessFacade, type RunSummary } from "../contracts";

type Args = { _: string[]; [key: string]: string | string[] | boolean | undefined };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) { out._.push(token); continue; }
    const [raw, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) { const previous = out[raw!]; out[raw!] = previous === undefined ? inline : [...(Array.isArray(previous) ? previous : [previous]), inline] as string[]; continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { const previous = out[raw!]; out[raw!] = previous === undefined ? next : [...(Array.isArray(previous) ? previous : [previous]), next] as string[]; i++; }
    else out[raw!] = true;
  }
  return out;
}

function one(args: Args, name: string, fallback?: string) {
  const value = args[name];
  return Array.isArray(value) ? value.at(-1) ?? fallback : value === true || value === undefined ? fallback : String(value);
}

function values(args: Args, name: string) {
  const value = args[name];
  return value === undefined ? [] : Array.isArray(value) ? value : [String(value)];
}

function candidate(value: string | undefined, effort: string | undefined, args: Args, prefix: "x" | "y"): CandidateConfig {
  if (!value) throw new Error(`missing --${prefix} provider/model`);
  const match = value.match(/^(claude|codex)[:/](.+)$/);
  if (!match) throw new Error(`--${prefix} must use claude:model or codex:model`);
  const agentModel = one(args, `${prefix}-agent-model`);
  const agentName = one(args, `${prefix}-agent-name`, `${prefix}-agent`)!;
  const agentEffort = one(args, `${prefix}-agent-effort`);
  const agentMaxTurns = Number(one(args, `${prefix}-agent-max-turns`, "")) || undefined;
  return {
    provider: match[1] as "claude" | "codex",
    model: match[2]!,
    effort,
    skills: values(args, `${prefix}-skill`),
    subagents: {
      enabled: args[`${prefix}-agent`] !== undefined || Boolean(agentModel),
      maxConcurrent: Number(one(args, `${prefix}-agent-concurrency`, "")) || undefined,
      maxSpawnDepth: Number(one(args, `${prefix}-agent-spawn-depth`, "")) || undefined,
      definitions: agentModel ? [{ model: agentModel, name: agentName, description: "XOXO configured evaluation subagent", prompt: "Assist with this evaluation task and report evidence to the parent agent.", effort: agentEffort, maxTurns: agentMaxTurns, skills: values(args, `${prefix}-agent-skill`) }] : [],
    },
  };
}

class LocalFacade implements HarnessFacade {
  private readonly file: string;
  private readonly runs = new Map<string, RunSummary>();
  constructor(root = process.cwd()) { this.file = join(root, ".xoxo", "local-runs.json"); }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as RunSummary[];
      for (const run of data) this.runs.set(run.id, run);
    } catch { /* first run */ }
  }
  private async save() {
    await mkdir(join(this.file, ".."), { recursive: true });
    await writeFile(this.file, JSON.stringify([...this.runs.values()], null, 2));
  }
  listSuites() {
    return readdir(join(process.cwd(), "examples"), { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isFile() && /\.(yaml|yml)$/.test(entry.name)).map((entry) => entry.name.replace(/\.ya?ml$/, ""))).catch(() => []);
  }
  listRuns() { return [...this.runs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  async startCompare(request: CompareRequest) {
    const id = `local-${Date.now().toString(36)}`;
    const run: RunSummary = { id, suite: request.suite, status: "queued", createdAt: new Date().toISOString(), progress: { completed: 0, total: (request.trials ?? 1) * 2 } };
    this.runs.set(id, run);
    await this.save();
    return run;
  }
  getRun(id: string) { return this.runs.get(id) ?? null; }
  async cancelRun(id: string) {
    const run = this.runs.get(id);
    if (!run) return null;
    run.status = "cancelled";
    await this.save();
    return run;
  }
  async exportRun(id: string, format = "json") {
    const run = this.runs.get(id);
    if (!run) return null;
    return format === "html" ? `<html><body><h1>XOXO run ${run.id}</h1><p>Status: ${run.status}</p></body></html>` : run;
  }
}

/** Adapter around the application RunService; kept here so the transports do
 * not depend on application implementation details. */
class RunServiceFacade implements HarnessFacade {
  private readonly runs = new Map<string, RunSummary>();
  private readonly results = new Map<string, unknown>();
  private readonly subscribers = new Map<string, Set<(event: import("../contracts").RunEvent) => void>>();
  constructor(private readonly service: { run(options: Record<string, unknown>): Promise<unknown> }) {}
  listSuites() {
    return readdir(join(process.cwd(), "examples"), { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isFile() && /\.(yaml|yml)$/.test(entry.name)).map((entry) => entry.name.replace(/\.ya?ml$/, ""))).catch(() => []);
  }
  listRuns() { return [...this.runs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  getSuiteCases(suite: string) { return loadCases(suite); }
  getRun(id: string) { return this.runs.get(id) ?? null; }
  getResults(id: string) { return this.results.get(id) ?? null; }
  subscribe(id: string, listener: (event: import("../contracts").RunEvent) => void) {
    const set = this.subscribers.get(id) ?? new Set(); set.add(listener); this.subscribers.set(id, set);
    return () => { set.delete(listener); if (!set.size) this.subscribers.delete(id); };
  }
  async startCompare(request: CompareRequest) {
    const id = `run-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const run: RunSummary = { id, suite: request.suite, status: "queued", createdAt: new Date().toISOString(), progress: { completed: 0, total: (request.trials ?? 1) * 2 } };
    this.runs.set(id, run);
    void this.execute(id, request);
    return run;
  }
  private emit(id: string, type: string, data: unknown) {
    const event = { id: `${id}-${Date.now()}-${Math.random().toString(16).slice(2)}`, runId: id, type, timestamp: new Date().toISOString(), data };
    for (const listener of this.subscribers.get(id) ?? []) listener(event);
  }
  private async execute(id: string, request: CompareRequest) {
    const run = this.runs.get(id)!; run.status = "preparing"; this.emit(id, "status", run);
    try {
      const cases = await loadCases(request.suite);
      const options: Record<string, unknown> = {
        id,
        x: toAppCandidate(request.x), y: toAppCandidate(request.y), cases,
        trials: request.trials ?? 1, concurrency: request.concurrency ?? 2, signal: undefined,
        onEvent: (attempt: unknown, event: unknown) => this.emit(id, "event", { attempt, event }),
        grade: (attempt: { caseId: string }, execution: { exitCode: number; timedOut?: boolean; cancelled?: boolean; stdout?: string; events?: Array<{ type?: string; tool?: string; name?: string }> }) => gradeCase(cases.find((item) => item.id === attempt.caseId), execution),
      };
      if (request.judge) options.judge = { ...toAppCandidate(request.judge), cwd: cases[0]?.cwd ?? process.cwd(), rubric: cases.flatMap((item) => (item as { rubric?: Array<{ description: string }> }).rubric ?? []).map((item) => item.description).join("\n") };
      run.status = "executing"; this.emit(id, "status", run);
      const output = await this.service.run(options);
      this.results.set(id, output);
      run.status = "completed"; run.completedAt = new Date().toISOString(); run.progress = { completed: run.progress?.total ?? 0, total: run.progress?.total ?? 0 };
      this.emit(id, "completed", output);
    } catch (error) {
      run.status = "failed"; run.completedAt = new Date().toISOString(); run.error = error instanceof Error ? error.message : String(error); this.emit(id, "error", run);
    }
  }
  async cancelRun(id: string) {
    const run = this.runs.get(id); if (!run) return null;
    if (run.status === "completed" || run.status === "failed") return run;
    run.status = "cancelled"; this.emit(id, "cancelled", run); return run;
  }
  exportRun(id: string, format = "json") {
    const run = this.runs.get(id); if (!run) return null;
    const payload = { run, result: this.results.get(id) };
    return format === "html" ? `<html><body><h1>XOXO run ${id}</h1><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre></body></html>` : payload;
  }
}

function toAppCandidate(candidate: CandidateConfig) {
  return { ...candidate, sandbox: candidate.workspace ?? "write" };
}

function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }

function gradeCase(testCase: Record<string, unknown> | undefined, execution: { exitCode: number; timedOut?: boolean; cancelled?: boolean; stdout?: string; events?: Array<{ type?: string; tool?: string; name?: string }> }) {
  const assertions = (testCase?.assertions ?? {}) as Record<string, unknown>;
  const output = execution.stdout ?? "";
  const checks: Array<[boolean, string]> = [];
  const outputChecks = (assertions.output ?? {}) as Record<string, unknown>;
  for (const expected of Array.isArray(outputChecks.includes) ? outputChecks.includes : []) checks.push([output.includes(String(expected)), `output must include ${String(expected)}`]);
  for (const forbidden of Array.isArray(outputChecks.excludes) ? outputChecks.excludes : []) checks.push([!output.includes(String(forbidden)), `output must exclude ${String(forbidden)}`]);
  const tools = new Set((execution.events ?? []).filter((event) => event.type === "tool_call" || event.type === "tool").map((event) => event.tool ?? event.name).filter(Boolean));
  const toolChecks = (assertions.tools ?? {}) as Record<string, unknown>;
  for (const expected of Array.isArray(toolChecks.required) ? toolChecks.required : []) checks.push([tools.has(String(expected)), `tool must be called: ${String(expected)}`]);
  for (const forbidden of Array.isArray(toolChecks.forbidden) ? toolChecks.forbidden : []) checks.push([!tools.has(String(forbidden)), `tool must not be called: ${String(forbidden)}`]);
  const subagentChecks = (assertions.subagents ?? {}) as Record<string, unknown>;
  const subagents = (execution.events ?? []).filter((event) => event.type === "subagent_start").length;
  if (typeof subagentChecks.minSpawns === "number") checks.push([subagents >= subagentChecks.minSpawns, `subagents must be >= ${subagentChecks.minSpawns}`]);
  if (typeof subagentChecks.maxSpawns === "number") checks.push([subagents <= subagentChecks.maxSpawns, `subagents must be <= ${subagentChecks.maxSpawns}`]);
  const healthy = execution.exitCode === 0 && !execution.timedOut && !execution.cancelled;
  const passed = healthy && checks.every(([ok]) => ok);
  return { passed, score: checks.length ? checks.filter(([ok]) => ok).length / checks.length : passed ? 1 : 0, failures: [!healthy ? "provider execution failed" : "", ...checks.filter(([ok]) => !ok).map(([, message]) => message)].filter(Boolean) };
}

async function resolveSuite(suite: string) {
  const options = [suite, `${suite}.yaml`, `${suite}.yml`, join("examples", suite), join("examples", `${suite}.yaml`), join("examples", `${suite}.yml`)].map((item) => resolve(item));
  for (const path of options) if (existsSync(path)) return path;
  throw new Error(`suite not found: ${suite}`);
}

async function loadCases(suite: string) {
  const path = await resolveSuite(suite);
  const parsed = parseYaml(await readFile(path, "utf8")) as { cases?: Array<Record<string, unknown>> };
  const root = resolve(path, "..");
  const cases: Array<Record<string, unknown>> = [];
  for (const source of parsed.cases ?? []) {
    const item: Record<string, unknown> = { ...source, cwd: resolve(root, String(source.fixture ?? ".")), rubric: source.rubric };
    if (typeof source.prompt === "string") item.prompt = source.prompt;
    else if (typeof source.promptFile === "string") item.prompt = await readFile(resolve(root, source.promptFile), "utf8");
    else item.prompt = "";
    cases.push(item);
  }
  return cases;
}

async function loadFacade(): Promise<HarnessFacade> {
  // Keep the interface package decoupled from application implementation names.
  // Application modules can export a facade, createHarness(), or named methods.
  for (const path of ["../../application/index.ts", "../../application/runtime.ts", "../../application/harness.ts"]) {
    try {
      const mod = await import(path);
      const value = mod.default ?? mod.harness ?? (typeof mod.createHarness === "function" ? await mod.createHarness() : undefined);
      if (value?.startCompare && value?.getRun) return value as HarnessFacade;
      if (typeof mod.RunService === "function") return new RunServiceFacade(new mod.RunService()) as HarnessFacade;
    } catch { /* optional until application layer is installed */ }
  }
  const fallback = new LocalFacade();
  await fallback.load();
  return fallback;
}

async function commandInit() {
  const root = join(process.cwd(), ".xoxo");
  await mkdir(root, { recursive: true });
  const config = join(root, "config.yaml");
  if (!existsSync(config)) await writeFile(config, "schema: xoxo/v1\ntrials: 1\n");
  console.log(`Initialized XOXO in ${root}`);
}

async function commandDoctor() {
  const checks = [["bun", process.execPath], ["claude", process.env.XOXO_CLAUDE_BIN], ["codex", process.env.XOXO_CODEX_BIN]] as const;
  let healthy = true;
  for (const [name, configured] of checks) {
    const path = configured && existsSync(configured) ? configured : Bun.which(name);
    if (path) console.log(`✓ ${name}: ${path}`);
    else { healthy = false; console.log(`✗ ${name}: not found (install or add to PATH)`); }
  }
  console.log(`XOXO doctor: ${healthy ? "ready" : "missing prerequisites"}`);
  if (!healthy) process.exitCode = 2;
}

async function commandCompare(args: Args, facade: HarnessFacade) {
  const suite = args._[1];
  if (!suite) throw new Error("usage: xoxo compare <suite> --x claude:model --y codex:model");
  const judge = one(args, "judge") ? candidate(one(args, "judge"), one(args, "judge-effort"), args, "x") : undefined;
  if (judge) judge.maxRetries = Number(one(args, "judge-retries", "1"));
  const request: CompareRequest = {
    suite,
    x: candidate(one(args, "x"), one(args, "x-effort"), args, "x"),
    y: candidate(one(args, "y"), one(args, "y-effort"), args, "y"),
    judge,
    trials: Number(one(args, "trials", "1")),
    concurrency: Number(one(args, "concurrency", "2")),
    timeoutMs: Number(one(args, "timeout", "600000")),
    seed: one(args, "seed"),
    cases: values(args, "case"), tags: values(args, "tag"), profile: one(args, "profile"),
  };
  const run = await asPromise(facade.startCompare(request));
  if (args.detach === true) { console.log(JSON.stringify(run, null, 2)); return; }
  const terminal = new Set(["completed", "cancelled", "failed"]);
  let current: RunSummary | null = run;
  while (current && !terminal.has(current.status)) {
    await Bun.sleep(100);
    current = await asPromise(facade.getRun(run.id));
  }
  const results = facade.getResults ? await asPromise(facade.getResults(run.id)) : undefined;
  console.log(JSON.stringify({ run: current, results }, null, 2));
  if (!current || current.status === "failed" || current.status === "cancelled" || current.verdict === "fail") process.exitCode = current?.status === "failed" ? 2 : 1;
}

async function commandServe(args: Args, facade: HarnessFacade) {
  const { createHttpApp } = await import("../http/app");
  const port = Number(one(args, "port", process.env.XOXO_PORT ?? "4242"));
  const host = one(args, "host", "127.0.0.1")!;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("v1 only permits loopback HTTP binds");
  const server = createHttpApp(facade, { port, host });
  server.app.listen({ hostname: host, port });
  console.log(`XOXO listening on http://${host}:${port}`);
}

async function commandDev(args: Args, facade: HarnessFacade) {
  // Vite proxies /v1 and /healthz to the API port from vite.config.ts.
  await commandServe({ ...args, port: one(args, "api-port", "3000") }, facade);
  const vitePort = one(args, "vite-port", "5173")!;
  const vite = Bun.spawn([process.execPath, "x", "vite", "--host", "127.0.0.1", "--port", vitePort], { stdout: "inherit", stderr: "inherit" });
  console.log(`XOXO UI: http://127.0.0.1:${vitePort}`);
  await vite.exited;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? "help";
  if (command === "init") return commandInit();
  if (command === "doctor") return commandDoctor();
  if (command === "help" || command === "--help") { console.log("xoxo init | doctor | dev | serve | compare | show | cancel | export | mcp | setup agents"); return; }
  const facade = await loadFacade();
  if (command === "compare") return commandCompare(args, facade);
  if (command === "dev") return commandDev(args, facade);
  if (command === "serve") return commandServe(args, facade);
  if (command === "show" || command === "inspect") {
    const run = await asPromise(facade.getRun(args._[1] ?? ""));
    if (!run) throw new Error("run not found");
    console.log(JSON.stringify(run, null, 2)); return;
  }
  if (command === "cancel") {
    if (!facade.cancelRun) throw new Error("cancellation unavailable");
    const run = await asPromise(facade.cancelRun(args._[1] ?? ""));
    if (!run) throw new Error("run not found");
    console.log(JSON.stringify(run, null, 2)); return;
  }
  if (command === "export") {
    if (!facade.exportRun) throw new Error("export unavailable");
    const result = await asPromise(facade.exportRun(args._[1] ?? "", one(args, "format", "html")));
    if (!result) throw new Error("run not found");
    if (typeof result === "string") console.log(result); else console.log(JSON.stringify(result, null, 2)); return;
  }
  if (command === "mcp") { const { runMcpServer } = await import("../mcp/server"); return runMcpServer(facade); }
  if (command === "setup" && args._[1] === "agents") { const { setupAgents } = await import("../mcp/setup"); return setupAgents({ apply: args.apply === true, target: one(args, "target", "both")! }); }
  throw new Error(`unknown command: ${command}`);
}

if (import.meta.main) main().catch((error) => { console.error(`xoxo: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; });

export { candidate, parseArgs, loadFacade, main };
