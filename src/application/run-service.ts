import { claudeAdapter } from "../infrastructure/providers/claude";
import { codexAdapter } from "../infrastructure/providers/codex";
import { NativeRunner } from "../infrastructure/runners/native";
import type { ProviderAdapter, ProviderEvent, ProviderRunResult, JudgeInput } from "../infrastructure/providers/types";
import type { CandidateConfig, EvaluationCase, PlannedAttempt } from "./planning";
import { planAttempts } from "./planning";
import { Scheduler } from "./scheduler";

export type AttemptEvaluation = {
  passed: boolean;
  score?: number;
  failures?: string[];
  assertions?: Array<{ id: string; passed: boolean; message: string; expected?: unknown; actual?: unknown }>;
};
export type AttemptResult = PlannedAttempt & { execution: ProviderRunResult; evaluation: AttemptEvaluation; output: string };
export type PairResult = { caseId: string; trial: number; x?: AttemptResult; y?: AttemptResult; winner: "x" | "y" | "tie" | "indeterminate"; judge?: unknown };
export type RunResult = { id: string; startedAt: string; completedAt: string; attempts: AttemptResult[]; pairs: PairResult[] };

export type JudgeConfig = {
  provider: "claude" | "codex";
  model: string;
  effort?: string;
  cwd: string;
  rubric: string;
  timeoutMs?: number;
  maxRetries?: number;
  seed?: string;
};

export type RunOptions = {
  id?: string;
  x: CandidateConfig;
  y: CandidateConfig;
  cases: EvaluationCase[];
  trials?: number;
  concurrency?: number;
  judge?: JudgeConfig;
  signal?: AbortSignal;
  grade?: (attempt: PlannedAttempt, execution: ProviderRunResult, cwd: string) => AttemptEvaluation | Promise<AttemptEvaluation>;
  onEvent?: (attempt: PlannedAttempt, event: ProviderEvent) => void | Promise<void>;
  prepareAttempt?: (attempt: PlannedAttempt) => string | Promise<string>;
  cleanupAttempt?: (attempt: PlannedAttempt, cwd: string) => void | Promise<void>;
};

const adapters: Record<"claude" | "codex", ProviderAdapter> = { claude: claudeAdapter, codex: codexAdapter };

function outputOf(result: ProviderRunResult): string {
  return result.events.filter((event) => event.type === "text" || event.type === "result").map((event) => event.text || "").join("") || result.stdout;
}

function defaultGrade(_: PlannedAttempt, result: ProviderRunResult): AttemptEvaluation {
  return { passed: result.exitCode === 0 && !result.timedOut && !result.cancelled, failures: result.exitCode || result.timedOut || result.cancelled ? [result.timedOut ? "timed_out" : result.cancelled ? "cancelled" : `exit_${result.exitCode}`] : [] };
}

/** Runs planned candidate attempts and, when configured, a third blind judge. */
export class RunService {
  constructor(private readonly runner: NativeRunner = new NativeRunner(), private readonly providerAdapters: Record<"claude" | "codex", ProviderAdapter> = adapters) {}

  async run(options: RunOptions): Promise<RunResult> {
    const id = options.id ?? crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const attempts: AttemptResult[] = [];
    const scheduler = new Scheduler({ concurrency: options.concurrency ?? 2 });
    const planned = planAttempts(options.cases, options.x, options.y, options.trials ?? 1);
    await Promise.all(planned.map((attempt) => scheduler.add(async () => {
      const adapter = this.providerAdapters[attempt.input.provider];
      if (!adapter) throw new Error(`No adapter for ${attempt.input.provider}`);
      const cwd = options.prepareAttempt ? await options.prepareAttempt(attempt) : attempt.input.cwd;
      try {
        const invocation = adapter.compileAttempt({ ...attempt.input, cwd });
        const execution = await this.runner.run(invocation, (event) => options.onEvent?.(attempt, event), options.signal);
        const evaluation = await (options.grade ?? defaultGrade)(attempt, execution, cwd);
        attempts.push({ ...attempt, execution, evaluation, output: outputOf(execution) });
      } finally {
        await options.cleanupAttempt?.(attempt, cwd);
      }
    })));
    attempts.sort((a, b) => planned.findIndex((item) => item.id === a.id) - planned.findIndex((item) => item.id === b.id));
    const pairs: PairResult[] = [];
    for (const evaluationCase of options.cases) {
      for (let trial = 1; trial <= (options.trials ?? 1); trial += 1) {
        const x = attempts.find((attempt) => attempt.caseId === evaluationCase.id && attempt.trial === trial && attempt.side === "x");
        const y = attempts.find((attempt) => attempt.caseId === evaluationCase.id && attempt.trial === trial && attempt.side === "y");
        const pair: PairResult = { caseId: evaluationCase.id, trial, x, y, winner: winnerFor(x, y) };
        if (pair.winner === "tie" && x?.evaluation.passed && y?.evaluation.passed && options.judge) {
          const judged = await this.judge(options.judge, x.output, y.output, `${id}:${evaluationCase.id}:${trial}`, options.signal);
          pair.judge = judged.result;
          pair.winner = judged.verdict;
        }
        pairs.push(pair);
      }
    }
    return { id, startedAt, completedAt: new Date().toISOString(), attempts, pairs };
  }

  private async judge(config: JudgeConfig, candidateX: string, candidateY: string, pairSeed: string, signal?: AbortSignal): Promise<{ result: unknown; verdict: PairResult["winner"] }> {
    const adapter = this.providerAdapters[config.provider];
    if (!adapter) throw new Error(`No adapter for ${config.provider}`);
    const aIsX = stableHash(`${config.seed ?? "xoxo"}:${pairSeed}`) % 2 === 0;
    const candidateA = aIsX ? candidateX : candidateY;
    const candidateB = aIsX ? candidateY : candidateX;
    const judge: JudgeInput = { provider: config.provider, model: config.model, effort: config.effort, cwd: config.cwd, prompt: `Evaluate two candidate responses. Return JSON with winner (A, B, or tie), confidence, rationale, and evidence.\n\nRubric:\n${config.rubric}\n\nCandidate A:\n${candidateA}\n\nCandidate B:\n${candidateB}`, rubric: config.rubric, candidateA, candidateB, timeoutMs: config.timeoutMs };
    let last = { winner: "indeterminate", raw: "", exitCode: -1 };
    for (let retry = 0; retry <= (config.maxRetries ?? 1); retry += 1) {
      const execution = await this.runner.run(adapter.compileJudge(judge), undefined, signal);
      const text = outputOf(execution).trim();
      try {
        const result = JSON.parse(text) as { winner?: string };
        if (!['A', 'B', 'tie'].includes(result.winner ?? "")) throw new Error("invalid winner");
        const verdict = result.winner === "tie" ? "tie" : result.winner === "A" ? (aIsX ? "x" : "y") : (aIsX ? "y" : "x");
        return { result, verdict };
      } catch { last = { winner: "indeterminate", raw: text, exitCode: execution.exitCode }; }
    }
    return { result: last, verdict: "indeterminate" };
  }
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function winnerFor(x?: AttemptResult, y?: AttemptResult): PairResult["winner"] {
  if (!x || !y || !x.evaluation.passed && !y.evaluation.passed) return "tie";
  if (x.evaluation.passed && !y.evaluation.passed) return "x";
  if (y.evaluation.passed && !x.evaluation.passed) return "y";
  return "tie";
}

export { adapters as providerAdapters };
