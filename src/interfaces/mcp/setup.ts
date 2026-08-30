import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface SetupOptions { apply?: boolean; target?: string; root?: string; }

/**
 * Print the exact changes by default. `--apply` is required for writes because
 * registering an MCP server changes the host agent's configuration.
 */
export async function setupAgents(options: SetupOptions = {}) {
  const root = resolve(options.root ?? process.cwd());
  const target = options.target ?? "both";
  if (!["claude", "codex", "both"].includes(target)) throw new Error("target must be claude, codex, or both");
  const changes: string[] = [];
  const mcpPath = join(root, ".mcp.json");
  let mcp: Record<string, unknown> = {};
  try { mcp = JSON.parse(await readFile(mcpPath, "utf8")) as Record<string, unknown>; } catch { /* create below */ }
  const servers = (mcp.mcpServers && typeof mcp.mcpServers === "object" ? mcp.mcpServers : {}) as Record<string, unknown>;
  servers.xoxo = { command: "xoxo", args: ["mcp"], transport: "stdio" };
  mcp.mcpServers = servers;
  if (target === "claude" || target === "both") changes.push(mcpPath);
  const codexPath = join(root, ".codex", "config.toml");
  if (target === "codex" || target === "both") changes.push(codexPath);

  const skillNames = ["xoxo-author", "xoxo-compare", "xoxo-triage"];
  for (const name of skillNames) changes.push(join(root, ".xoxo", "skills", name, "SKILL.md"));
  if (!options.apply) return { applied: false, target, changes };

  if (target === "claude" || target === "both") {
    await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);
  }
  if (target === "codex" || target === "both") {
    let codexConfig = "";
    try { codexConfig = await readFile(codexPath, "utf8"); } catch { /* create below */ }
    if (!/^\[mcp_servers\.xoxo\]/m.test(codexConfig)) codexConfig += `${codexConfig && !codexConfig.endsWith("\n") ? "\n" : ""}[mcp_servers.xoxo]\ncommand = \"xoxo\"\nargs = [\"mcp\"]\n`;
    await mkdir(dirname(codexPath), { recursive: true });
    await writeFile(codexPath, codexConfig);
  }
  const sourceRoot = resolve(import.meta.dir, "../../../skills");
  for (const name of skillNames) {
    const source = join(sourceRoot, name, "SKILL.md");
    const destination = join(root, ".xoxo", "skills", name, "SKILL.md");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(source, "utf8"));
  }
  return { applied: true, target, changes };
}
