#!/usr/bin/env bun

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("xoxo-fake-agent 1.0.0");
  process.exit(0);
}

if (args[0] === "exec") {
  console.log(JSON.stringify({ type: "message", text: "Repository evidence supports a careful plan." }));
  console.log(JSON.stringify({ type: "tool_call", name: "Read", arguments: { path: "README.md" } }));
  console.log(JSON.stringify({ type: "response.completed", output: "Repository evidence supports a careful plan.", usage: { input_tokens: 12, output_tokens: 8 } }));
} else {
  console.log(JSON.stringify({ type: "assistant", message: { content: [
    { type: "text", text: "Repository evidence supports a careful plan." },
    { type: "tool_use", name: "Read", input: { path: "README.md" } },
  ] } }));
  console.log(JSON.stringify({ type: "result", result: "Repository evidence supports a careful plan.", usage: { input_tokens: 12, output_tokens: 8 }, total_cost_usd: 0.0001 }));
}
