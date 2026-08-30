import { asRecord, now, numberValue, type AttemptInput, type CompiledInvocation, type JudgeInput, type ProviderAdapter, type ProviderCapabilities, type ProviderEvent } from "./types";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const command = process.env.XOXO_CODEX_BIN || "codex";
const timeout = 30 * 60 * 1000;

function compileFor(input: AttemptInput | JudgeInput, executable: string): CompiledInvocation {
  const args = ["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "-C", input.cwd, "-m", input.model, "-s", input.sandbox === "read-only" ? "read-only" : "workspace-write"];
  if (input.effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(input.effort)}`);
  if (input.subagents?.enabled === false) args.push("-c", "agents.enabled=false");
  if (input.subagents?.maxConcurrent !== undefined) args.push("-c", `agents.max_concurrent_threads_per_session=${input.subagents.maxConcurrent}`);
  if (input.subagents?.definitions?.length) {
    args.push("-c", "agents.enabled=true");
    const configRoot = join(input.cwd, ".xoxo-generated", "agents");
    mkdirSync(configRoot, { recursive: true });
    for (const definition of input.subagents.definitions) {
      const name = definition.name.replace(/[^A-Za-z0-9_-]/g, "-");
      const file = join(configRoot, `${name}.toml`);
      const lines = [
        `name = ${JSON.stringify(name)}`,
        `description = ${JSON.stringify(definition.description)}`,
        `developer_instructions = ${JSON.stringify(definition.prompt)}`,
        ...(definition.model ? [`model = ${JSON.stringify(definition.model)}`] : []),
        ...(definition.effort ? [`model_reasoning_effort = ${JSON.stringify(definition.effort)}`] : []),
      ];
      writeFileSync(file, `${lines.join("\n")}\n`);
      args.push("-c", `agents.${name}.description=${JSON.stringify(definition.description)}`);
      args.push("-c", `agents.${name}.config_file=${JSON.stringify(file)}`);
    }
  }
  const prompt = input.skills?.length ? `Use these installed skills where relevant: ${input.skills.join(", ")}\n\n${input.prompt}` : input.prompt;
  // Prompt is last so paths and config values cannot be interpreted as options.
  args.push("--", prompt);
  return { provider: "codex", command: executable, args, cwd: input.cwd, env: { ...input.env }, timeoutMs: input.timeoutMs ?? timeout, parseLine: parseCodexLine };
}
function compile(input: AttemptInput | JudgeInput) { return compileFor(input, command); }

export function parseCodexLine(line: string): ProviderEvent[] {
  if (!line.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [{ type: "raw", timestamp: now(), text: line, raw: line }];
  }
  const event = asRecord(value);
  const type = typeof event.type === "string" ? event.type : "";
  const base = { timestamp: now(), raw: value };
  const events: ProviderEvent[] = [];
  const item = asRecord(event.item);
  const itemType = typeof item.type === "string" ? item.type : "";
  const text = typeof event.text === "string" ? event.text : typeof event.delta === "string" ? event.delta : typeof item.text === "string" ? item.text : undefined;
  if (type === "response.output_text.delta" || type === "output_text_delta" || type === "message" || text) events.push({ ...base, type: "text", text });
  const tool = typeof event.tool === "string" ? event.tool : typeof event.name === "string" ? event.name : typeof item.name === "string" ? item.name : undefined;
  if (type.includes("function_call") || type.includes("tool_call") || itemType.includes("function_call") || itemType.includes("tool_call")) events.push({ ...base, type: "tool_call", tool, toolInput: event.arguments ?? event.input ?? item.arguments ?? item.input });
  if (type.includes("tool_result") || type.includes("tool_output") || itemType.includes("tool_result")) events.push({ ...base, type: "tool_result", tool, toolOutput: event.output ?? event.result ?? item.output ?? item.result });
  if (type === "subagent_started" || type === "agent_started" || type.includes("spawn")) events.push({ ...base, type: "subagent_start", agent: typeof event.agent_id === "string" ? event.agent_id : undefined });
  if (type === "subagent_completed" || type === "agent_completed") events.push({ ...base, type: "subagent_end", agent: typeof event.agent_id === "string" ? event.agent_id : undefined });
  if (type === "turn.completed" || type === "response.completed" || type === "result" || event.usage) {
    const usage = asRecord(event.usage ?? asRecord(event.response).usage);
    events.push({ ...base, type: "result", text: typeof event.output === "string" ? event.output : undefined, usage: { inputTokens: numberValue(usage.input_tokens ?? usage.inputTokens), outputTokens: numberValue(usage.output_tokens ?? usage.outputTokens) } });
  }
  if (type === "error" || type === "turn.failed" || type === "response.failed") events.push({ ...base, type: "error", error: typeof event.message === "string" ? event.message : typeof event.error === "string" ? event.error : "Codex reported an error" });
  return events.length ? events : [{ ...base, type: "raw" }];
}

async function probe(): Promise<ProviderCapabilities> {
  try {
    const proc = Bun.spawn([command, "--version"], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { provider: "codex", available: code === 0, command, version: out.trim() || undefined, error: code ? (err.trim() || `exited ${code}`) : undefined, supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: false, perAgentTurns: false, perAgentTools: false, streamJson: true } };
  } catch (error) {
    return { provider: "codex", available: false, command, error: error instanceof Error ? error.message : String(error), supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: false, perAgentTurns: false, perAgentTools: false, streamJson: true } };
  }
}

export const codexAdapter: ProviderAdapter = { name: "codex", probe, compileAttempt: compile, compileJudge: compile };
export class CodexAdapter implements ProviderAdapter {
  readonly name = "codex" as const;
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
    return { provider: "codex", available: code === 0, command: executable, version: out.trim() || undefined, error: code ? (err.trim() || `exited ${code}`) : undefined, supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: false, perAgentTurns: false, perAgentTools: false, streamJson: true } };
  } catch (error) { return { provider: "codex", available: false, command: executable, error: error instanceof Error ? error.message : String(error), supports: { effort: true, subagents: true, subagentModel: true, subagentEffort: true, maxConcurrentSubagents: true, spawnDepth: false, perAgentTurns: false, perAgentTools: false, streamJson: true } }; }
}
export { compile as compileCodexAttempt };
