import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { RunService, type RunResult } from "./run-service";
import { planAttempts } from "./planning";
import type { CandidateConfig, CompareRequest, HarnessFacade, RunEvent, RunSummary } from "../interfaces/contracts";
import type { EvaluationCase } from "./planning";
import { providerAdapters } from "./run-service";
import { candidateSchema, evalCaseSchema, gradeDeterministic, runConfigSchema, type FileSnapshot, type NormalizedEvent, type ProviderResult } from "../domain/index.ts";
import { openDatabase, type XoxoDatabase } from "../infrastructure/storage/index.ts";
import { ArtifactStore, exportReport, type ArtifactRecord } from "../infrastructure/artifacts/index.ts";

type StoredRun = { summary: RunSummary; result?: RunResult; controller: AbortController; listeners: Set<(event: RunEvent) => void> };

function candidate(value: CandidateConfig, timeoutMs?: number) {
  return {
    provider: value.provider,
    model: value.model,
    effort: value.effort,
    skills: value.skills ?? [],
    sandbox: value.workspace ?? "write",
    subagents: value.subagents ? { enabled: value.subagents.enabled, maxConcurrent: value.subagents.maxConcurrent, maxSpawnDepth: value.subagents.maxSpawnDepth, definitions: (value.subagents.definitions ?? []).map((item) => ({ name: String(item.name ?? "agent"), description: String(item.description ?? ""), prompt: String(item.prompt ?? ""), model: item.model ? String(item.model) : undefined, effort: item.effort ? String(item.effort) : undefined, maxTurns: typeof item.maxTurns === "number" ? item.maxTurns : undefined, skills: Array.isArray(item.skills) ? item.skills.map(String) : undefined, tools: Array.isArray(item.tools) ? item.tools.map(String) : undefined })) } : undefined,
    timeoutMs,
  };
}

async function suiteFile(root: string, suite: string): Promise<string> {
  const requested = resolve(root, suite.endsWith(".yaml") || suite.endsWith(".yml") ? suite : join("examples", `${suite}.yaml`));
  const rootPath = resolve(root);
  if (isAbsolute(relative(rootPath, requested)) && relative(rootPath, requested).startsWith("..")) throw new Error("suite path escapes project root");
  try { await readFile(requested); return requested; } catch { throw new Error(`suite not found: ${suite}`); }
}

function within(base: string, child: string): string {
  const resolvedBase = resolve(base);
  const resolved = resolve(base, child);
  const path = relative(resolvedBase, resolved);
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("path escapes project root");
  return resolved;
}

async function loadCases(root: string, suite: string): Promise<{ cases: EvaluationCase[]; raw: any }> {
  const file = await suiteFile(root, suite);
  const raw = parseYaml(await readFile(file, "utf8")) as any;
  if (!raw || !Array.isArray(raw.cases)) throw new Error("suite must contain cases");
  const cases: EvaluationCase[] = [];
  for (const item of raw.cases) {
    const prompt = item.prompt ?? (item.promptFile ? await readFile(within(dirname(file), item.promptFile), "utf8") : undefined);
    if (!prompt) throw new Error(`case ${item.id} has no prompt`);
    const cwd = within(dirname(file), item.fixture ?? ".");
    cases.push({ id: String(item.id), prompt, cwd, tags: item.tags ?? [], assertions: item.assertions });
  }
  return { cases, raw };
}

async function snapshotFiles(root: string, directory = root, snapshot: FileSnapshot = {}): Promise<FileSnapshot> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      await snapshotFiles(root, absolute, snapshot);
    } else if (entry.isFile()) {
      const path = relative(root, absolute).split(process.platform === "win32" ? "\\" : "/").join("/");
      try { snapshot[path] = await readFile(absolute, "utf8"); } catch { snapshot[path] = ""; }
    }
  }
  return snapshot;
}

function normalizedProviderResult(execution: import("../infrastructure/providers/types").ProviderRunResult): ProviderResult {
  const output = execution.events.filter((event) => event.type === "text" || event.type === "result").map((event) => event.text ?? "").join("") || execution.stdout;
  return {
    exitCode: execution.exitCode,
    output,
    stderr: execution.stderr,
    durationMs: execution.durationMs,
    events: execution.events.map((event, sequence) => ({
      sequence,
      timestamp: event.timestamp,
      type: ({ text: "message", tool_call: "tool", tool_result: "tool_result", subagent_start: "subagent_start", subagent_end: "subagent_end", result: "usage", error: "error", raw: "status" } as const)[event.type],
      role: event.type === "text" ? "assistant" as const : undefined,
      text: event.text ?? event.error,
      name: event.tool ?? event.agent,
      input: event.toolInput,
      output: event.toolOutput,
      metadata: { rawType: event.type, usage: event.usage, costUsd: event.costUsd },
    })),
  };
}

/** Local facade shared by CLI, HTTP and MCP with SQLite-backed run history. */
export class RuntimeHarness implements HarnessFacade {
  private readonly runs = new Map<string, StoredRun>();
  private readonly service: RunService;
  private readonly database: XoxoDatabase;
  private readonly artifacts: ArtifactStore;
  constructor(private readonly root = process.cwd()) {
    this.service = new RunService();
    this.database = openDatabase(join(root, ".xoxo", "state.sqlite"));
    this.artifacts = new ArtifactStore(join(root, ".xoxo"));
  }

  async listSuites() {
    try { return (await readdir(join(this.root, "examples"), { withFileTypes: true })).filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name)).map((entry) => entry.name.replace(/\.ya?ml$/, "")); } catch { return []; }
  }

  async getSuiteCases(suite: string) { return (await loadCases(this.root, suite)).raw.cases ?? []; }

  listRuns(): RunSummary[] {
    return this.database.listRuns().map((run) => ({ id: run.id, suite: run.suiteId, suiteId: run.suiteId, status: run.state, createdAt: run.createdAt, completedAt: ["completed", "cancelled", "failed"].includes(run.state) ? run.updatedAt : undefined, error: run.error }));
  }

  async startCompare(request: CompareRequest): Promise<RunSummary> {
    for (const [side, value] of [["x", request.x], ["y", request.y]] as const) {
      if (value.provider === "codex" && value.subagents?.definitions?.some((definition) => typeof definition.maxTurns === "number")) throw new Error(`${side}: Codex does not expose a documented per-agent max-turns control; remove it for strict parity`);
      if (value.provider === "codex" && typeof value.subagents?.maxSpawnDepth === "number") throw new Error(`${side}: Codex does not expose a documented subagent spawn-depth control; remove it for strict parity`);
    }
    const id = `run-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const config = runConfigSchema.parse({
      suiteId: request.suite,
      x: candidateSchema.parse(request.x),
      y: candidateSchema.parse(request.y),
      judge: request.judge ? { provider: request.judge.provider, model: request.judge.model, effort: request.judge.effort, maxRetries: typeof request.judge.maxRetries === "number" ? request.judge.maxRetries : 1 } : undefined,
      trials: request.trials ?? 1,
      timeoutMs: request.timeoutMs ?? 300_000,
      concurrency: request.concurrency ?? 2,
      seed: request.seed,
    });
    const stored: StoredRun = { summary: { id, suite: request.suite, status: "queued", createdAt: new Date().toISOString() }, controller: new AbortController(), listeners: new Set() };
    this.runs.set(id, stored);
    this.database.createRun({ id, suiteId: request.suite, config, effectiveConfigHash: Bun.hash(JSON.stringify(config)).toString(16) });
    this.database.addCandidate(id, "x", config.x);
    this.database.addCandidate(id, "y", config.y);
    void this.execute(stored, request);
    return stored.summary;
  }

  getRun(id: string) {
    const live = this.runs.get(id)?.summary;
    if (live) return live;
    const stored = this.database.getRun(id);
    return stored ? { id: stored.id, suite: stored.suiteId, suiteId: stored.suiteId, status: stored.state, createdAt: stored.createdAt, completedAt: ["completed", "cancelled", "failed"].includes(stored.state) ? stored.updatedAt : undefined, error: stored.error } : null;
  }
  getResults(id: string) { return this.runs.get(id)?.result ?? { attempts: this.database.listAttempts(id), pairs: this.database.getPairResults(id) }; }
  capabilities() { return Promise.all(Object.values(providerAdapters).map((adapter) => adapter.probe())).then((providers) => ({ providers })); }
  subscribe(id: string, listener: (event: RunEvent) => void) { const run = this.runs.get(id); if (!run) return () => undefined; run.listeners.add(listener); return () => run.listeners.delete(listener); }
  cancelRun(id: string) {
    const run = this.runs.get(id);
    if (!run) return null;
    run.controller.abort(); run.summary.status = "cancelled";
    this.database.setRunState(id, "cancelled");
    this.publish(run, { runId: id, type: "cancelled", timestamp: new Date().toISOString(), data: run.summary });
    return run.summary;
  }
  exportRun(id: string, format = "json") {
    const run = this.getRun(id); if (!run) return null;
    const report = { runId: id, suiteId: String(run.suite ?? ""), state: run.status, results: this.database.getPairResults(id), generatedAt: new Date().toISOString() };
    const paths = exportReport(report, join(this.root, ".xoxo", "runs", id, "exports"));
    return format === "html" ? Bun.file(paths.htmlPath).text() : report;
  }

  private publish(stored: StoredRun, event: RunEvent) { for (const listener of stored.listeners) listener(event); }

  private async execute(stored: StoredRun, request: CompareRequest) {
    try {
      const { cases, raw } = await loadCases(this.root, request.suite);
      const selected = request.cases?.length ? cases.filter((item) => request.cases!.includes(item.id)) : request.tags?.length ? cases.filter((item) => item.tags?.some((tag) => request.tags!.includes(tag))) : cases;
      if (!selected.length) throw new Error("comparison selected no cases");
      stored.summary.status = "executing";
      this.database.setRunState(stored.summary.id, "executing");
      const planned = planAttempts(selected, candidate(request.x, request.timeoutMs), candidate(request.y, request.timeoutMs), request.trials ?? 1);
      for (const attempt of planned) {
        this.database.addCase(stored.summary.id, attempt.caseId, attempt.trial);
        this.database.createAttempt({ id: attempt.id, runId: stored.summary.id, caseId: attempt.caseId, trial: attempt.trial, side: attempt.side, state: "queued" });
      }
      const judgeCandidate = request.judge;
      const judge = judgeCandidate && selected[0] ? { provider: judgeCandidate.provider, model: judgeCandidate.model, effort: judgeCandidate.effort, cwd: selected[0].cwd, rubric: (raw.cases ?? []).flatMap((item: any) => item.rubric ?? []).map((item: any) => `${item.id}: ${item.description}`).join("\n") || "Prefer the response that best satisfies the task.", maxRetries: typeof judgeCandidate.maxRetries === "number" ? judgeCandidate.maxRetries : 1, seed: typeof request.seed === "string" ? request.seed : undefined } : undefined;
      stored.result = await this.service.run({ id: stored.summary.id, x: candidate(request.x, request.timeoutMs), y: candidate(request.y, request.timeoutMs), cases: selected, trials: request.trials ?? 1, concurrency: request.concurrency ?? 2, signal: stored.controller.signal, judge, grade: async (attempt, execution, cwd) => {
        const rawCase = (raw.cases ?? []).find((item: any) => String(item.id) === attempt.caseId);
        if (!rawCase) throw new Error(`case not found while grading: ${attempt.caseId}`);
        const grade = gradeDeterministic(evalCaseSchema.parse(rawCase), { result: normalizedProviderResult(execution), files: await snapshotFiles(cwd) });
        const runtimeFailure = execution.timedOut ? "timed out" : execution.cancelled ? "cancelled" : execution.exitCode !== 0 ? `exit ${execution.exitCode}` : undefined;
        const assertions = runtimeFailure ? [...grade.assertions, { id: "runtime", passed: false, message: runtimeFailure }] : grade.assertions;
        return { passed: grade.passed && !runtimeFailure, score: grade.score, assertions, failures: assertions.filter((item) => !item.passed).map((item) => item.message) };
      }, onEvent: (attempt, event) => {
        this.database.setAttemptState(attempt.id, "running", { startedAt: new Date().toISOString() });
        const typeMap: Record<string, NormalizedEvent["type"]> = { text: "message", tool_call: "tool", tool_result: "tool_result", subagent_start: "subagent_start", subagent_end: "subagent_end", result: "usage", error: "error", raw: "status" };
        const saved = this.database.appendEvent(attempt.id, { timestamp: event.timestamp, type: typeMap[event.type] ?? "status", role: event.type === "text" ? "assistant" : undefined, text: event.text ?? event.error, name: event.tool ?? event.agent, input: event.toolInput, output: event.toolOutput, metadata: { rawType: event.type, usage: event.usage, costUsd: event.costUsd } });
        this.publish(stored, { id: `${attempt.id}-${saved.sequence}`, runId: stored.summary.id, type: event.type, timestamp: event.timestamp, data: { attemptId: attempt.id, slot: attempt.side, ...event } });
      }, prepareAttempt: async (attempt) => { const source = attempt.input.cwd; const workRoot = join(this.root, ".xoxo", "work"); await mkdir(workRoot, { recursive: true }); const dir = await mkdtemp(join(workRoot, `${attempt.side}-`)); await cp(source, dir, { recursive: true }); return dir; }, cleanupAttempt: async (_attempt, cwd) => { await rm(cwd, { recursive: true, force: true }); } });
      const artifactRecords: ArtifactRecord[] = [];
      for (const attempt of stored.result.attempts) {
        const relativeRoot = `attempts/${attempt.caseId}/${attempt.trial}/${attempt.side}`;
        const stream = this.artifacts.write(stored.summary.id, "provider-stream", `${relativeRoot}/provider.jsonl`, attempt.execution.events.map((event) => JSON.stringify(event.raw ?? event)).join("\n"), attempt.id);
        const output = this.artifacts.write(stored.summary.id, "output", `${relativeRoot}/final.txt`, attempt.output, attempt.id);
        const stderr = this.artifacts.write(stored.summary.id, "stderr", `${relativeRoot}/stderr.log`, attempt.execution.stderr, attempt.id);
        artifactRecords.push(stream, output, stderr); for (const record of [stream, output, stderr]) this.database.saveArtifact(record);
        this.database.setAttemptState(attempt.id, attempt.execution.cancelled ? "cancelled" : attempt.execution.timedOut ? "timed_out" : attempt.evaluation.passed ? "passed" : "failed", { finishedAt: stored.result.completedAt, exitCode: attempt.execution.exitCode, outputArtifact: output.path, error: attempt.evaluation.failures?.join("; ") });
        const failures = attempt.evaluation.failures ?? [];
        this.database.saveAssertions(attempt.id, { passed: attempt.evaluation.passed, score: attempt.evaluation.score ?? (attempt.evaluation.passed ? 1 : 0), assertions: attempt.evaluation.assertions ?? (failures.length ? failures.map((message, index) => ({ id: `failure:${index + 1}`, passed: false, message })) : [{ id: "deterministic", passed: true, message: "All deterministic checks passed" }]) });
      }
      for (const pair of stored.result.pairs) { this.database.savePairResult(stored.summary.id, pair.caseId, pair.trial, { ...pair, verdict: pair.winner, reason: pair.judge ? "blind judge" : "deterministic gates" }); if (pair.judge) this.database.saveJudgment(stored.summary.id, pair.caseId, pair.trial, 0, pair.judge); }
      const manifest = this.artifacts.manifest(stored.summary.id, artifactRecords); this.database.saveArtifact(manifest);
      stored.summary.status = stored.controller.signal.aborted ? "cancelled" : "completed";
      const xWins = stored.result.pairs.filter((pair) => pair.winner === "x").length; const yWins = stored.result.pairs.filter((pair) => pair.winner === "y").length;
      stored.summary.winner = xWins === yWins ? stored.result.pairs.some((pair) => pair.winner === "indeterminate") ? "indeterminate" : "tie" : xWins > yWins ? "x" : "y";
      stored.summary["verdict"] = stored.result.attempts.every((attempt) => attempt.evaluation.passed) ? "pass" : "fail";
      stored.summary.completedAt = stored.result.completedAt;
      stored.summary.progress = { completed: stored.result.attempts.length, total: stored.result.attempts.length };
      this.database.setRunState(stored.summary.id, stored.summary.status === "cancelled" ? "cancelled" : "completed");
      this.publish(stored, { runId: stored.summary.id, type: "completed", timestamp: stored.result.completedAt, data: stored.summary });
    } catch (error) {
      stored.summary.status = stored.controller.signal.aborted ? "cancelled" : "failed";
      stored.summary["error"] = error instanceof Error ? error.message : String(error);
      this.database.setRunState(stored.summary.id, stored.summary.status === "cancelled" ? "cancelled" : "failed", String(stored.summary["error"]));
      this.publish(stored, { runId: stored.summary.id, type: "error", timestamp: new Date().toISOString(), data: stored.summary });
    }
  }
}

export function createHarness(root = process.cwd()) { return new RuntimeHarness(root); }
export const harness = createHarness();
export default harness;
