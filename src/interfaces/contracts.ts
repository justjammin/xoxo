/** Public boundary shared by the CLI, HTTP server and MCP adapter.
 *
 * The application layer deliberately owns the implementation.  Interfaces only
 * depend on this small contract, which also makes the transports straightforward
 * to exercise with a fake harness in tests.
 */
export type ProviderName = "claude" | "codex";

export interface CandidateConfig {
  provider: ProviderName;
  model: string;
  effort?: string;
  skills?: string[];
  workspace?: "read-only" | "write";
  subagents?: {
    enabled?: boolean;
    maxConcurrent?: number;
    maxSpawnDepth?: number;
    definitions?: Array<Record<string, unknown>>;
  };
  [key: string]: unknown;
}

export interface CompareRequest {
  suite: string;
  x: CandidateConfig;
  y: CandidateConfig;
  judge?: CandidateConfig;
  trials?: number;
  concurrency?: number;
  timeoutMs?: number;
  seed?: string;
  cases?: string[];
  tags?: string[];
  profile?: string;
  [key: string]: unknown;
}

export type RunStatus =
  | "queued"
  | "preparing"
  | "executing"
  | "grading"
  | "judging"
  | "finalizing"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export interface RunSummary {
  id: string;
  suite?: string;
  status: RunStatus | string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  progress?: { completed: number; total: number };
  winner?: "x" | "y" | "tie" | "indeterminate";
  [key: string]: unknown;
}

export interface RunEvent {
  id?: string;
  runId: string;
  type: string;
  timestamp?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface HarnessFacade {
  listSuites(): Promise<unknown[]> | unknown[];
  listRuns?(): Promise<RunSummary[]> | RunSummary[];
  getSuiteCases?(suite: string): Promise<unknown[]> | unknown[];
  startCompare(request: CompareRequest): Promise<RunSummary> | RunSummary;
  getRun(id: string): Promise<RunSummary | null> | RunSummary | null;
  getResults?(id: string): Promise<unknown> | unknown;
  cancelRun?(id: string): Promise<RunSummary | null | boolean> | RunSummary | null | boolean;
  exportRun?(id: string, format?: string): Promise<unknown> | unknown;
  capabilities?(): Promise<unknown> | unknown;
  subscribe?(id: string, listener: (event: RunEvent) => void): () => void;
}

export function asPromise<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value);
}

export function nowIso() {
  return new Date().toISOString();
}
