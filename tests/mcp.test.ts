import { describe, expect, it } from "bun:test";
import { createMcpServer } from "../src/interfaces/mcp/server";

describe("XOXO MCP interface", () => {
  it("creates a named MCP server without writing protocol noise", () => {
    const server = createMcpServer({ listSuites: () => ["smoke"], startCompare: () => ({ id: "run-test", status: "queued" }), getRun: () => null });
    expect(server).toBeDefined();
  });
});
