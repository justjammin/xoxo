import type { AttemptInput, ProviderName } from "../infrastructure/providers/types";

export type CandidateConfig = Omit<AttemptInput, "prompt" | "cwd"> & { provider: ProviderName; model: string; name?: string };
export type EvaluationCase = { id: string; prompt: string; cwd: string; tags?: string[]; assertions?: { output?: { includes?: string[]; excludes?: string[] } } };
export type PlannedAttempt = { id: string; caseId: string; trial: number; side: "x" | "y"; input: AttemptInput };

/** Deterministically expands cases, trials and candidates into isolated attempts. */
export function planAttempts(cases: EvaluationCase[], x: CandidateConfig, y: CandidateConfig, trials = 1): PlannedAttempt[] {
  if (!Number.isInteger(trials) || trials < 1) throw new Error("trials must be a positive integer");
  const planned: PlannedAttempt[] = [];
  for (const evaluationCase of cases) {
    for (let trial = 1; trial <= trials; trial += 1) {
      for (const [side, candidate] of [["x", x], ["y", y]] as const) {
        planned.push({ id: `${evaluationCase.id}:${trial}:${side}`, caseId: evaluationCase.id, trial, side, input: { ...candidate, prompt: evaluationCase.prompt, cwd: evaluationCase.cwd } });
      }
    }
  }
  return planned;
}
