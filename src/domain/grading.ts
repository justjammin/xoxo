import { z } from "zod";
import type { EvalCase, ProviderResult, RubricCriterion } from "./schemas.ts";

// These small structural types keep grading independent of a provider implementation.
export type FileSnapshot = Record<string, string>;
export type AttemptEvidence = {
  result: ProviderResult;
  files?: FileSnapshot;
  tools?: string[];
  subagentCount?: number;
  json?: unknown;
};
export type AssertionResult = { id: string; passed: boolean; message: string; expected?: unknown; actual?: unknown };
export type DeterministicGrade = { passed: boolean; score: number; assertions: AssertionResult[] };

/** Evaluate the portable, deterministic part of a case. */
export function gradeDeterministic(testCase: EvalCase, evidence: AttemptEvidence): DeterministicGrade {
  const assertions: AssertionResult[] = [];
  const output = evidence.result.output;
  const expected = testCase.assertions;
  for (const value of expected.output.includes) assertions.push({ id: `output.includes:${value}`, passed: output.includes(value), message: output.includes(value) ? `Output includes ${value}` : `Output does not include ${value}`, expected: value });
  for (const value of expected.output.excludes) assertions.push({ id: `output.excludes:${value}`, passed: !output.includes(value), message: !output.includes(value) ? `Output excludes ${value}` : `Output contains forbidden text ${value}`, expected: value });

  const files = evidence.files ?? {};
  for (const value of expected.files.required) assertions.push({ id: `files.required:${value}`, passed: Object.hasOwn(files, value), message: Object.hasOwn(files, value) ? `File exists: ${value}` : `Required file missing: ${value}`, expected: value });
  for (const value of expected.files.forbidden) assertions.push({ id: `files.forbidden:${value}`, passed: !Object.hasOwn(files, value), message: !Object.hasOwn(files, value) ? `Forbidden file absent: ${value}` : `Forbidden file exists: ${value}`, expected: value });
  for (const [path, needle] of Object.entries(expected.files.contains)) {
    const actual = files[path];
    const needles = Array.isArray(needle) ? needle : [needle];
    for (const text of needles) assertions.push({ id: `files.contains:${path}:${text}`, passed: actual !== undefined && actual.includes(text), message: actual !== undefined && actual.includes(text) ? `File contains expected text: ${path}` : `File does not contain expected text: ${path}`, expected: text, actual });
  }
  const toolNames = new Set(evidence.tools ?? evidence.result.events.filter((event) => event.type === "tool").map((event) => event.name).filter((name): name is string => Boolean(name)));
  for (const value of expected.tools.required) assertions.push({ id: `tools.required:${value}`, passed: toolNames.has(value), message: toolNames.has(value) ? `Tool called: ${value}` : `Required tool not called: ${value}`, expected: value });
  for (const value of expected.tools.forbidden) assertions.push({ id: `tools.forbidden:${value}`, passed: !toolNames.has(value), message: !toolNames.has(value) ? `Forbidden tool not called: ${value}` : `Forbidden tool called: ${value}`, expected: value });
  const subagentCount = evidence.subagentCount ?? evidence.result.events.filter((event) => event.type === "subagent_start").length;
  assertions.push({ id: "subagents.minSpawns", passed: subagentCount >= expected.subagents.minSpawns, message: subagentCount >= expected.subagents.minSpawns ? `Spawned ${subagentCount} subagents` : `Spawned ${subagentCount}; minimum is ${expected.subagents.minSpawns}`, expected: expected.subagents.minSpawns, actual: subagentCount });
  if (expected.subagents.maxSpawns !== undefined) assertions.push({ id: "subagents.maxSpawns", passed: subagentCount <= expected.subagents.maxSpawns, message: subagentCount <= expected.subagents.maxSpawns ? `Spawned ${subagentCount} subagents` : `Spawned ${subagentCount}; maximum is ${expected.subagents.maxSpawns}`, expected: expected.subagents.maxSpawns, actual: subagentCount });
  if (testCase.assertions.json?.schema) assertions.push(...validateJsonSchema(evidence.json ?? parseJson(output), testCase.assertions.json.schema));
  const passed = evidence.result.exitCode === 0 && assertions.every((item) => item.passed);
  return { passed, score: assertions.length === 0 ? (passed ? 1 : 0) : assertions.filter((item) => item.passed).length / assertions.length, assertions };
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

/** Deliberately small JSON-Schema subset for portable case files. */
export function validateJsonSchema(value: unknown, schema: Record<string, unknown>, prefix = "json"): AssertionResult[] {
  const results: AssertionResult[] = [];
  if (schema.type === "object") {
    const object = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    results.push({ id: `${prefix}.type`, passed: Boolean(object), message: Boolean(object) ? "Value is an object" : "Value is not an object", expected: "object", actual: value });
    if (object) {
      for (const key of (Array.isArray(schema.required) ? schema.required : [])) results.push({ id: `${prefix}.required:${String(key)}`, passed: Object.hasOwn(object, String(key)), message: Object.hasOwn(object, String(key)) ? `Property exists: ${String(key)}` : `Property missing: ${String(key)}`, expected: key });
      const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, unknown> : {};
      for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(object, key) && child && typeof child === "object") results.push(...validateJsonSchema(object[key], child as Record<string, unknown>, `${prefix}.${key}`));
    }
  } else if (schema.type === "string") results.push({ id: `${prefix}.type`, passed: typeof value === "string", message: typeof value === "string" ? "Value is a string" : "Value is not a string", expected: "string", actual: value });
  else if (schema.type === "number" || schema.type === "integer") results.push({ id: `${prefix}.type`, passed: typeof value === "number" && Number.isFinite(value) && (schema.type !== "integer" || Number.isInteger(value)), message: `Value is a ${schema.type}`, expected: schema.type, actual: value });
  else if (schema.type === "boolean") results.push({ id: `${prefix}.type`, passed: typeof value === "boolean", message: "Value is a boolean", expected: "boolean", actual: value });
  if (Array.isArray(schema.enum)) results.push({ id: `${prefix}.enum`, passed: schema.enum.includes(value), message: schema.enum.includes(value) ? "Value is allowed" : "Value is not allowed", expected: schema.enum, actual: value });
  return results;
}

export type PairVerdict = "x" | "y" | "tie" | "indeterminate";
export type PairResult = { verdict: PairVerdict; reason: string; x: DeterministicGrade; y: DeterministicGrade; judge?: JudgeResult };
export type JudgeCriterionScore = { criterionId: string; x: number; y: number; evidence?: string };
export type JudgeResult = { verdict: Exclude<PairVerdict, "indeterminate">; confidence: number; rationale: string; scores: JudgeCriterionScore[] };

const judgeResultSchema = z.object({
  winner: z.enum(["A", "B", "tie"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  scores: z.array(z.object({ criterionId: z.string().min(1), A: z.number().min(0).max(1), B: z.number().min(0).max(1), evidence: z.string().optional() })).default([]),
});
export type RawJudgeResult = z.infer<typeof judgeResultSchema>;

export function parseJudgeResult(value: unknown, aIsX: boolean, criteria: readonly RubricCriterion[] = []): JudgeResult {
  const raw = judgeResultSchema.parse(value);
  const verdict: Exclude<PairVerdict, "indeterminate"> = raw.winner === "tie" ? "tie" : (raw.winner === "A") === aIsX ? "x" : "y";
  const criteriaById = new Set(criteria.map((criterion) => criterion.id));
  const scores = raw.scores.filter((score) => criteria.length === 0 || criteriaById.has(score.criterionId)).map((score) => ({ criterionId: score.criterionId, x: aIsX ? score.A : score.B, y: aIsX ? score.B : score.A, evidence: score.evidence }));
  return { verdict, confidence: raw.confidence, rationale: raw.rationale, scores };
}

export function aggregateMajority(verdicts: readonly PairVerdict[]): PairVerdict {
  const valid = verdicts.filter((verdict): verdict is Exclude<PairVerdict, "indeterminate"> => verdict !== "indeterminate");
  if (valid.length === 0) return "indeterminate";
  const counts = { x: valid.filter((v) => v === "x").length, y: valid.filter((v) => v === "y").length, tie: valid.filter((v) => v === "tie").length };
  const max = Math.max(counts.x, counts.y, counts.tie);
  const winners = (Object.entries(counts) as [Exclude<PairVerdict, "indeterminate">, number][]).filter(([, count]) => count === max);
  return winners.length === 1 ? winners[0]![0] : "tie";
}

export function compareGrades(x: DeterministicGrade, y: DeterministicGrade, judge?: JudgeResult): PairResult {
  if (x.passed !== y.passed) return { verdict: x.passed ? "x" : "y", reason: "deterministic gate", x, y };
  if (!x.passed) return { verdict: "tie", reason: "both candidates failed deterministic gates", x, y };
  if (!judge) return { verdict: "tie", reason: "both candidates passed; no semantic rubric", x, y };
  return { verdict: judge.verdict, reason: "blind judge", x, y, judge };
}
