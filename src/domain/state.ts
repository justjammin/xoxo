import type { AttemptState, RunState } from "./schemas.ts";

const runTransitions: Record<RunState, readonly RunState[]> = {
  queued: ["preparing", "cancelling", "failed"],
  preparing: ["executing", "cancelling", "failed"],
  executing: ["grading", "cancelling", "failed"],
  grading: ["judging", "finalizing", "cancelling", "failed"],
  judging: ["finalizing", "cancelling", "failed"],
  finalizing: ["completed", "failed"],
  completed: [], cancelling: ["cancelled", "failed"], cancelled: [], failed: [],
};

const attemptTransitions: Record<AttemptState, readonly AttemptState[]> = {
  queued: ["preparing", "cancelled", "errored"],
  preparing: ["running", "cancelled", "errored"],
  running: ["grading", "cancelled", "timed_out", "errored"],
  grading: ["passed", "failed", "errored", "cancelled"],
  passed: [], failed: [], errored: [], timed_out: [], cancelled: [],
};

export function canTransitionRun(from: RunState, to: RunState): boolean { return runTransitions[from].includes(to); }
export function canTransitionAttempt(from: AttemptState, to: AttemptState): boolean { return attemptTransitions[from].includes(to); }
export function transitionRun(from: RunState, to: RunState): RunState {
  if (!canTransitionRun(from, to)) throw new Error(`Invalid run transition: ${from} -> ${to}`);
  return to;
}
export function transitionAttempt(from: AttemptState, to: AttemptState): AttemptState {
  if (!canTransitionAttempt(from, to)) throw new Error(`Invalid attempt transition: ${from} -> ${to}`);
  return to;
}

export const terminalRunStates: readonly RunState[] = ["completed", "cancelled", "failed"];
export const terminalAttemptStates: readonly AttemptState[] = ["passed", "failed", "errored", "timed_out", "cancelled"];
