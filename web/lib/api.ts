export type Provider = "claude" | "codex";

export type CandidateInput = {
  provider: Provider;
  model: string;
  effort: string;
  subagents: {
    enabled: boolean;
    maxConcurrent: number;
    maxSpawnDepth?: number;
    definitions: Array<{
      name: string;
      description: string;
      prompt: string;
      model?: string;
      effort?: string;
      maxTurns?: number;
    }>;
  };
};

export type RunEvent = {
  seq: number;
  kind: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

export type RunSummary = {
  id: string;
  suiteId: string;
  status: string;
  verdict?: string | null;
  createdAt?: string;
  x?: CandidateInput;
  y?: CandidateInput;
  events?: RunEvent[];
};

export type SuiteSummary = { id: string; cases?: Array<{ id: string; tags?: string[] }> };
export type JudgeInput = { provider: Provider; model: string; effort: string; maxRetries: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listSuites: () => request<{ suites: Array<SuiteSummary | string> } | Array<SuiteSummary | string>>("/v1/suites"),
  listRuns: () => request<{ runs: RunSummary[] } | RunSummary[]>("/v1/runs"),
  getRun: (id: string) => request<RunSummary>(`/v1/runs/${id}`),
  startRun: (body: unknown) =>
    request<{ runId?: string; id?: string; statusUrl?: string; eventsUrl?: string }>("/v1/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelRun: (id: string) => request(`/v1/runs/${id}/cancel`, { method: "POST" }),
};

export function unwrapList<T>(value: T[] | Record<string, T[]> | undefined, key: string): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : ((value as Record<string, T[]>)[key] ?? []);
}
