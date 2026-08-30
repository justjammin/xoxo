import { describe, expect, test } from "bun:test";
import { compileClaudeAttempt, parseClaudeLine } from "../src/infrastructure/providers/claude";
import { compileCodexAttempt, parseCodexLine } from "../src/infrastructure/providers/codex";

describe("headless provider adapters", () => {
  test("compiles Claude restricted stream-json invocations", () => {
    const invocation = compileClaudeAttempt({ provider: "claude", model: "claude-sonnet", effort: "high", prompt: "inspect", cwd: "/tmp/eval", subagents: { maxConcurrent: 2, maxSpawnDepth: 1, definitions: [{ name: "reviewer", description: "review", prompt: "review files" }] } });
    expect(invocation.command).toBe("claude");
    expect(invocation.args).toContain("--restricted");
    expect(invocation.args).toContain("stream-json");
    expect(invocation.args).toContain("--agents");
    expect(invocation.args).not.toContain("--bare");
    expect(invocation.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe("2");
    expect(invocation.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).toBe("1");
  });

  test("normalizes Claude text/tool/result events and malformed lines", () => {
    expect(parseClaudeLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }))[0]?.type).toBe("text");
    expect(parseClaudeLine(JSON.stringify({ type: "tool_use", name: "Read", input: { path: "a" } }))[0]?.tool).toBe("Read");
    expect(parseClaudeLine("not-json")[0]?.type).toBe("raw");
  });

  test("compiles Codex ephemeral JSONL invocation with explicit isolation", () => {
    const invocation = compileCodexAttempt({ provider: "codex", model: "codex-mini", effort: "medium", prompt: "fix", cwd: "/tmp/eval", sandbox: "read-only", subagents: { enabled: false, maxConcurrent: 2 } });
    expect(invocation.command).toBe("codex");
    expect(invocation.args).toContain("exec");
    expect(invocation.args).toContain("--ephemeral");
    expect(invocation.args).toContain("--ignore-user-config");
    expect(invocation.args).toContain("read-only");
  });

  test("normalizes Codex output text and errors", () => {
    expect(parseCodexLine(JSON.stringify({ type: "response.output_text.delta", delta: "hello" }))[0]?.text).toBe("hello");
    expect(parseCodexLine(JSON.stringify({ type: "turn.failed", message: "nope" }))[0]?.type).toBe("error");
  });
});
