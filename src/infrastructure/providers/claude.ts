import {
  asRecord,
  now,
  numberValue,
  type AttemptInput,
  type CompiledInvocation,
  type JudgeInput,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderEvent,
} from "./types";

const command = process.env.XOXO_CLAUDE_BIN || "claude";
const timeout = 30 * 60 * 1000;

function textFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        const record = asRecord(item);
        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
    return text || undefined;
  }
  return undefined;
}

/** Parse Claude stream-json events, tolerating protocol additions. */
export function parseClaudeLine(line: string): ProviderEvent[] {
  if (!line.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [{ type: "raw", timestamp: now(), text: line, raw: line }];
  }
  const event = asRecord(value);
  const type = typeof event.type === "string" ? event.type : "";
  const message = asRecord(event.message);
  const content = event.content ?? message.content;
  const events: ProviderEvent[] = [];
  const base = { timestamp: now(), raw: value };
  if (type === "assistant" || type === "message" || type === "content_block_delta") {
    const text = textFrom(event.delta) ?? textFrom(content) ?? textFrom(event.text) ?? textFrom(message.content);
    if (text) events.push({ ...base, type: "text", text });
    if (Array.isArray(content)) for (const block of content) {
      const item = asRecord(block);
      if (item.type === "tool_use") events.push({ ...base, type: "tool_call", tool: typeof item.name === "string" ? item.name : undefined, toolInput: item.input });
      if (item.type === "tool_result") events.push({ ...base, type: "tool_result", toolOutput: item.content });
    }
  }
  const toolName = typeof event.name === "string" ? event.name : typeof event.tool_name === "string" ? event.tool_name : undefined;
  if (type === "tool_use" || type === "tool_call" || toolName) {
    events.push({ ...base, type: "tool_call", tool: toolName, toolInput: event.input ?? event.arguments });
  }
  if (type === "tool_result" || type === "tool_output") {
    events.push({ ...base, type: "tool_result", tool: toolName, toolOutput: event.content ?? event.output });
  }
  if (type === "subagent_start" || type === "agent_start") {
    events.push({ ...base, type: "subagent_start", agent: typeof event.agent_id === "string" ? event.agent_id : typeof event.name === "string" ? event.name : undefined });
  }
  if (type === "subagent_end" || type === "agent_end") {
    events.push({ ...base, type: "subagent_end", agent: typeof event.agent_id === "string" ? event.agent_id : undefined });
  }
  if (type === "result" || type === "turn_complete") {
    const usage = asRecord(event.usage ?? message.usage);
    events.push({
      ...base,
      type: "result",
      text: textFrom(event.result) ?? textFrom(event.output),
      usage: { inputTokens: numberValue(usage.input_tokens ?? usage.inputTokens), outputTokens: numberValue(usage.output_tokens ?? usage.outputTokens) },
      costUsd: numberValue(event.total_cost_usd ?? event.cost_usd ?? event.costUsd),
    });
  }
  if (type === "error") events.push({ ...base, type: "error", error: textFrom(event.error) ?? textFrom(event.message) ?? "Claude reported an error" });
  return events.length ? events : [{ ...base, type: "raw" }];
}

function agentJson(input: AttemptInput): string | undefined {
  const defs = input.subagents?.definitions;
  if (!defs?.length) return undefined;
  const agents: Record<string, unknown> = {};
  for (const def of defs) {
    agents[def.name] = {
      description: def.description,
      prompt: def.prompt,
      ...(def.model ? { model: def.model } : {}),
      ...(def.effort ? { effort: def.effort } : {}),
      ...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
      ...(def.skills?.length ? { skills: def.skills } : {}),
      ...(def.tools?.length ? { tools: def.tools } : {}),
    };
  }
  return JSON.stringify(agents);
}

function compileFor(input: AttemptInput | JudgeInput, executable: string): CompiledInvocation {
  const prompt = input.skills?.length ? `Use these installed skills where relevant: ${input.skills.join(", ")}\n\n${input.prompt}` : input.prompt;
  const tools = input.sandbox === "read-only" ? ["Read", "Glob", "Grep"] : ["Read", "Glob", "Grep", "Edit", "Write"];
  if (input.subagents?.enabled) tools.push("Agent");
  const toolList = tools.join(",");
  const args = ["--restricted", "-p", prompt, "--output-format", "stream-json", "--verbose", "--forward-subagent-text", "--no-session-persistence", "--permission-mode", "dontAsk", "--tools", toolList, "--allowedTools", toolList, "--model", input.model];
  if (input.effort) args.push("--effort", input.effort);
  const agents = agentJson(input);
  if (agents) args.push("--agents", agents);
  const env: Record<string, string> = { ...input.env, CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1" };
  if (input.subagents?.maxConcurrent !== undefined) env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = String(input.subagents.maxConcurrent);
  if (input.subagents?.maxSpawnDepth !== undefined) env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = String(input.subagents.maxSpawnDepth);
  return { provider: "claude", command: executable, args, cwd: input.cwd, env, timeoutMs: input.timeoutMs ?? timeout, parseLine: parseClaudeLine };
}
function compile(input: AttemptInput | JudgeInput) { return compileFor(input, command); }

async function probe(): Promise<ProviderCapabilities> {
  try {
    const proc = Bun.spawn([command, "--version"], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { provider: "claude", available: code === 0, command, version: out.trim() || undefined, error: code ? (err.trim() || `exited ${code}`) : undefined, supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: true, perAgentTurns: true, perAgentTools: true, streamJson: true } };
  } catch (error) {
    return { provider: "claude", available: false, command, error: error instanceof Error ? error.message : String(error), supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: true, perAgentTurns: true, perAgentTools: true, streamJson: true } };
  }
}

export const claudeAdapter: ProviderAdapter = { name: "claude", probe, compileAttempt: compile, compileJudge: compile };

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = "claude" as const;
  private readonly executable: string;
  constructor(options: { command?: string } = {}) { this.executable = options.command ?? command; }
  probe = () => probeCommand(this.executable);
  compileAttempt = (input: AttemptInput) => compileFor(input, this.executable);
  compileJudge = (input: JudgeInput) => compileFor(input, this.executable);
}

async function probeCommand(executable: string): Promise<ProviderCapabilities> {
  if (executable === command) return probe();
  try {
    const proc = Bun.spawn([executable, "--version"], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { provider: "claude", available: code === 0, command: executable, version: out.trim() || undefined, error: code ? (err.trim() || `exited ${code}`) : undefined, supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: true, perAgentTurns: true, perAgentTools: true, streamJson: true } };
  } catch (error) { return { provider: "claude", available: false, command: executable, error: error instanceof Error ? error.message : String(error), supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: true, perAgentTurns: true, perAgentTools: true, streamJson: true } }; }
}

export { compile as compileClaudeAttempt };
