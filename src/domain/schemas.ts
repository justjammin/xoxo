import { z } from "zod";

export const providerSchema = z.enum(["claude", "codex"]);
export const effortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
export const workspacePolicySchema = z.enum(["read-only", "write"]);

export const subagentDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
  effort: effortSchema.optional(),
  maxTurns: z.number().int().positive().optional(),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
});

export const candidateSchema = z.object({
  provider: providerSchema,
  model: z.string().min(1),
  effort: effortSchema.optional(),
  promptVariant: z.string().optional(),
  skills: z.array(z.string()).default([]),
  workspace: workspacePolicySchema.default("write"),
  subagents: z.object({
    enabled: z.boolean().default(false),
    maxConcurrent: z.number().int().positive().optional(),
    maxSpawnDepth: z.number().int().positive().optional(),
    definitions: z.array(subagentDefinitionSchema).default([]),
  }).default({ enabled: false, definitions: [] }),
});

const containsSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
export const assertionsSchema = z.object({
  output: z.object({ includes: z.array(z.string()).default([]), excludes: z.array(z.string()).default([]) }).default({ includes: [], excludes: [] }),
  files: z.object({
    required: z.array(z.string()).default([]),
    forbidden: z.array(z.string()).default([]),
    contains: containsSchema.default({}),
  }).default({ required: [], forbidden: [], contains: {} }),
  tools: z.object({ required: z.array(z.string()).default([]), forbidden: z.array(z.string()).default([]) }).default({ required: [], forbidden: [] }),
  subagents: z.object({ minSpawns: z.number().int().nonnegative().default(0), maxSpawns: z.number().int().nonnegative().optional() }).default({ minSpawns: 0 }),
  json: z.object({ schema: z.record(z.string(), z.unknown()).optional() }).optional(),
});

export const rubricCriterionSchema = z.object({ id: z.string().min(1), description: z.string().min(1), weight: z.number().positive().default(1) });
export const evalCaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().optional(),
  promptFile: z.string().optional(),
  fixture: z.string().min(1),
  tags: z.array(z.string()).default([]),
  assertions: assertionsSchema.default(() => ({ output: { includes: [], excludes: [] }, files: { required: [], forbidden: [], contains: {} }, tools: { required: [], forbidden: [] }, subagents: { minSpawns: 0 } })),
  rubric: z.array(rubricCriterionSchema).default([]),
}).refine((value) => value.prompt || value.promptFile, { message: "case requires prompt or promptFile" });

export const suiteSchema = z.object({
  schema: z.literal("xoxo/v1").default("xoxo/v1"),
  id: z.string().min(1),
  defaults: z.object({ trials: z.number().int().positive().default(1), timeoutMs: z.number().int().positive().default(300_000) }).default({ trials: 1, timeoutMs: 300_000 }),
  cases: z.array(evalCaseSchema).min(1),
});

export const judgeConfigSchema = z.object({ provider: providerSchema, model: z.string().min(1), effort: effortSchema.optional(), maxRetries: z.number().int().nonnegative().default(1) });
export const runConfigSchema = z.object({
  suiteId: z.string().min(1),
  x: candidateSchema,
  y: candidateSchema,
  judge: judgeConfigSchema.optional(),
  trials: z.number().int().positive().default(1),
  timeoutMs: z.number().int().positive().default(300_000),
  concurrency: z.number().int().positive().default(2),
  seed: z.string().optional(),
});
// Stable public aliases for transport implementations.
export const runSchema = runConfigSchema;
export const caseSchema = evalCaseSchema;
export const judgeSchema = judgeConfigSchema;

export const runIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,127}$/);
export const runStateSchema = z.enum(["queued", "preparing", "executing", "grading", "judging", "finalizing", "completed", "cancelling", "cancelled", "failed"]);
export const attemptStateSchema = z.enum(["queued", "preparing", "running", "grading", "passed", "failed", "errored", "timed_out", "cancelled"]);

export const normalizedEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  type: z.enum(["message", "tool", "tool_result", "subagent_start", "subagent_end", "usage", "status", "error"]),
  role: z.enum(["assistant", "user", "system", "tool"]).optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const providerResultSchema = z.object({
  exitCode: z.number().int(),
  output: z.string().default(""),
  stderr: z.string().default(""),
  events: z.array(normalizedEventSchema).default([]),
  usage: z.object({ inputTokens: z.number().nonnegative().optional(), outputTokens: z.number().nonnegative().optional(), totalTokens: z.number().nonnegative().optional(), costUsd: z.number().nonnegative().optional() }).optional(),
  durationMs: z.number().nonnegative().default(0),
  error: z.string().optional(),
});

export type Provider = z.infer<typeof providerSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;
export type Suite = z.infer<typeof suiteSchema>;
export type RunConfig = z.infer<typeof runConfigSchema>;
export type JudgeConfig = z.infer<typeof judgeConfigSchema>;
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type ProviderResult = z.infer<typeof providerResultSchema>;
export type RunState = z.infer<typeof runStateSchema>;
export type AttemptState = z.infer<typeof attemptStateSchema>;

/** Parse the ergonomic `provider:model` CLI representation. */
export function parseCandidateRef(value: string, options: Partial<Omit<Candidate, "provider" | "model">> = {}): Candidate {
  const separator = value.indexOf(":");
  if (separator < 1 || separator === value.length - 1) throw new Error(`Invalid candidate reference: ${value}; expected provider:model`);
  return candidateSchema.parse({ provider: value.slice(0, separator), model: value.slice(separator + 1), ...options });
}
