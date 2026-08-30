/** Provider-neutral events emitted by headless agent processes. */
export type ProviderName = "claude" | "codex";

export type ProviderEventType =
  | "text"
  | "tool_call"
  | "tool_result"
  | "subagent_start"
  | "subagent_end"
  | "result"
  | "error"
  | "raw";

export type ProviderEvent = {
  type: ProviderEventType;
  timestamp: string;
  text?: string;
  tool?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  agent?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  costUsd?: number;
  exitCode?: number;
  error?: string;
  raw?: unknown;
};

export type SubagentDefinition = {
  name: string;
  description: string;
  prompt: string;
  model?: string;
  effort?: string;
  maxTurns?: number;
  skills?: string[];
  tools?: string[];
};

export type AttemptInput = {
  provider: ProviderName;
  model: string;
  effort?: string;
  prompt: string;
  cwd: string;
  sandbox?: "read-only" | "write";
  skills?: string[];
  subagents?: {
    enabled?: boolean;
    maxConcurrent?: number;
    maxSpawnDepth?: number;
    definitions?: SubagentDefinition[];
  };
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type JudgeInput = AttemptInput & {
  rubric: string;
  candidateA: string;
  candidateB: string;
};

export type ProviderCapabilities = {
  provider: ProviderName;
  available: boolean;
  command: string;
  version?: string;
  error?: string;
  supports: {
    effort: boolean;
    subagents: boolean;
    subagentModel: boolean;
    subagentEffort: boolean;
    maxConcurrentSubagents: boolean;
    spawnDepth: boolean;
    perAgentTurns: boolean;
    perAgentTools: boolean;
    streamJson: boolean;
  };
};

export type CompiledInvocation = {
  provider: ProviderName;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  parseLine: (line: string) => ProviderEvent[];
};

export type ProviderRunResult = {
  exitCode: number;
  signal?: string;
  timedOut: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
  events: ProviderEvent[];
  durationMs: number;
};

export type ProviderEventSink = (event: ProviderEvent) => void | Promise<void>;

export interface ProviderAdapter {
  readonly name: ProviderName;
  probe(): Promise<ProviderCapabilities>;
  compileAttempt(input: AttemptInput): CompiledInvocation;
  compileJudge(input: JudgeInput): CompiledInvocation;
}

export const now = () => new Date().toISOString();

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
