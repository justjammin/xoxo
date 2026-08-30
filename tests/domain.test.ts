import { describe, expect, test } from "bun:test";
import { aggregateMajority, compareGrades, gradeDeterministic, parseCandidateRef, parseJudgeResult } from "../src/domain/index.ts";
import { providerResultSchema, suiteSchema } from "../src/domain/index.ts";

const result = (output: string, exitCode = 0) => providerResultSchema.parse({ output, exitCode, events: [], durationMs: 1 });

describe("domain contracts", () => {
  test("parses candidate references and applies defaults", () => {
    expect(parseCandidateRef("claude:opus").provider).toBe("claude");
    expect(() => parseCandidateRef("not-a-reference")).toThrow();
  });
  test("validates suite cases", () => {
    const suite = suiteSchema.parse({ id: "smoke", cases: [{ id: "one", prompt: "hi", fixture: "fixtures/one" }] });
    expect(suite.defaults.trials).toBe(1);
  });
  test("grades output, files, tools, and subagents", () => {
    const testCase = suiteSchema.parse({ id: "smoke", cases: [{ id: "one", prompt: "hi", fixture: "fixtures/one", assertions: { output: { includes: ["done"] }, files: { required: ["a.txt"] }, tools: { required: ["Read"] }, subagents: { minSpawns: 1 } } }] }).cases[0]!;
    const grade = gradeDeterministic(testCase, { result: result("done"), files: { "a.txt": "ok" }, tools: ["Read"], subagentCount: 1 });
    expect(grade.passed).toBe(true);
  });
  test("deterministic failures beat judge results", () => {
    const x = { passed: false, score: 0, assertions: [] }; const y = { passed: true, score: 1, assertions: [] };
    expect(compareGrades(x, y).verdict).toBe("y");
  });
  test("majority ties and blind labels are deterministic", () => {
    expect(aggregateMajority(["x", "y"])).toBe("tie");
    expect(parseJudgeResult({ winner: "A", confidence: 0.9, rationale: "evidence" }, true).verdict).toBe("x");
    expect(parseJudgeResult({ winner: "A", confidence: 0.9, rationale: "evidence" }, false).verdict).toBe("y");
  });
});
