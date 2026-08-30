import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { asPromise, type CandidateConfig, type CompareRequest, type HarnessFacade } from "../contracts";

const text = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: text(value) }] });
const failure = (error: unknown) => ({ isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] });

function parseCandidate(value: string): CandidateConfig {
  const parsed = JSON.parse(value) as CandidateConfig;
  if (!parsed || (parsed.provider !== "claude" && parsed.provider !== "codex") || !parsed.model) throw new Error("candidate must contain provider (claude|codex) and model");
  return parsed;
}

export function createMcpServer(facade: HarnessFacade) {
  const server = new McpServer({ name: "xoxo", version: "0.1.0" });
  server.tool("xoxo_list_suites", "List suites available to the local XOXO harness", {}, async () => {
    try { return result(await asPromise(facade.listSuites())); } catch (error) { return failure(error); }
  });
  server.tool("xoxo_get_case", "Get cases in an XOXO suite", { suite: z.string() }, async ({ suite }) => {
    try { return result(await asPromise(facade.getSuiteCases?.(suite) ?? [])); } catch (error) { return failure(error); }
  });
  server.tool("xoxo_start_compare", "Start an asynchronous X vs Y model comparison", {
    suite: z.string(),
    x: z.string().describe("JSON candidate, e.g. {provider:'claude',model:'...'}"),
    y: z.string().describe("JSON candidate, e.g. {provider:'codex',model:'...'}"),
    judge: z.string().optional().describe("Optional JSON candidate used as a blind judge"),
    trials: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }, async ({ suite, x, y, judge, trials, timeoutMs }) => {
    try {
      const request: CompareRequest = { suite, x: parseCandidate(x), y: parseCandidate(y), judge: judge ? parseCandidate(judge) : undefined, trials, timeoutMs };
      return result(await asPromise(facade.startCompare(request)));
    } catch (error) { return failure(error); }
  });
  server.tool("xoxo_get_run", "Read the current state of a comparison run", { id: z.string() }, async ({ id }) => {
    try { const run = await asPromise(facade.getRun(id)); return run ? result(run) : failure("run not found"); } catch (error) { return failure(error); }
  });
  server.tool("xoxo_cancel_run", "Cancel a queued or running comparison", { id: z.string() }, async ({ id }) => {
    try { if (!facade.cancelRun) return failure("cancellation unavailable"); const run = await asPromise(facade.cancelRun(id)); return run ? result(run) : failure("run not found"); } catch (error) { return failure(error); }
  });
  server.tool("xoxo_export_run", "Export a completed run as a portable JSON or HTML report", { id: z.string(), format: z.enum(["html", "json"]).optional() }, async ({ id, format }) => {
    try { if (!facade.exportRun) return failure("export unavailable"); const report = await asPromise(facade.exportRun(id, format ?? "html")); return report ? result(report) : failure("run not found"); } catch (error) { return failure(error); }
  });
  server.resource("xoxo-capabilities", "xoxo://capabilities", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: text(await asPromise(facade.capabilities?.() ?? { providers: ["claude", "codex"] })) }] }));
  server.resource("xoxo-suites", "xoxo://suites", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: text(await asPromise(facade.listSuites())) }] }));
  server.prompt("compare-agents", "Build a concise comparison request for XOXO", { suite: z.string(), x: z.string(), y: z.string() }, ({ suite, x, y }) => ({ messages: [{ role: "user", content: { type: "text", text: `Start an XOXO comparison for ${suite}. X=${x}; Y=${y}. Use xoxo_start_compare, then poll xoxo_get_run.` } }] }));
  server.prompt("triage-run", "Guide evidence-first triage of a run", { id: z.string() }, ({ id }) => ({ messages: [{ role: "user", content: { type: "text", text: `Triage XOXO run ${id}. Call xoxo_get_run first, separate provider errors from assertion failures, and only then recommend a rerun.` } }] }));
  server.prompt("audit-skill", "Audit a skill using an XOXO suite", { suite: z.string(), skill: z.string() }, ({ suite, skill }) => ({ messages: [{ role: "user", content: { type: "text", text: `Audit skill ${skill} with XOXO suite ${suite}. Confirm capabilities, run a small comparison, and report deterministic evidence.` } }] }));
  return server;
}

/** Keep stdout exclusively under the MCP transport; diagnostics belong on stderr. */
export async function runMcpServer(facade: HarnessFacade) {
  const server = createMcpServer(facade);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
