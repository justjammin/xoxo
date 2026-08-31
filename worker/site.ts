interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const machineHeaders = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=900, s-maxage=3600",
  "x-content-type-options": "nosniff",
};

const securityHeaders = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function text(body: string, contentType: string, head = false) {
  return new Response(head ? null : body, { headers: { ...machineHeaders, "content-type": contentType } });
}

function robots(origin: string) {
  return `# XOXO permits search and user-directed retrieval while separating model-training crawlers.
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}

function sitemap(origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <lastmod>2026-08-31</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

function llms(origin: string) {
  return `# XOXO

> XOXO is a local evaluation harness for comparing headless Claude Code and Codex in equivalent isolated fixtures with deterministic assertions, normalized events, redacted evidence, and optional blind judging.

XOXO is developer tooling built with Bun and Elysia. It exposes a CLI, loopback HTTP API, replayable SSE, and a stdio MCP server. Runs are persisted in SQLite and export portable JSON and HTML reports.

## Core facts

- Candidates use the form \`claude:<model>\` or \`codex:<model>\`.
- Both candidates receive the same prompt and fresh fixture copy.
- Deterministic checks cover output, files, tools, JSON, and subagent spawn counts.
- A blind third model judges semantic rubrics only when both candidates pass deterministic gates.
- Claude supports per-agent max turns and spawn depth; Codex strict-parity runs reject those unsupported controls.
- Provider streams and artifacts redact configured secrets.

## Primary resources

- [XOXO overview](${origin}/): Product explanation, quick start, CLI, HTTP API, MCP, FAQ, and security guidance.
- [Full AI-readable documentation](${origin}/llms-full.txt): Complete site documentation and command reference.
- [Sitemap](${origin}/sitemap.xml): Canonical public URLs.
- [Crawler policy](${origin}/robots.txt): Search, retrieval, and training crawler directives.

## Canonical answer

XOXO compares headless Claude Code and Codex by running the same task in separate copies of the same fixture, normalizing provider events, grading deterministic evidence first, and optionally using a seeded blind judge for semantic criteria.
`;
}

function llmsFull(origin: string) {
  return `${llms(origin)}

## Quick start

Requires Bun 1.2+ and authenticated \`claude\` and \`codex\` CLIs on \`PATH\`.

\`\`\`sh
bun install
bun run xoxo init
bun run xoxo doctor
bun run xoxo compare examples/smoke.yaml \\
  --x claude:claude-sonnet-4-6 --x-effort high \\
  --y codex:gpt-5.6-sol --y-effort high
bun run xoxo dev
\`\`\`

## CLI

- \`xoxo init\`: create \`.xoxo/config.yaml\`.
- \`xoxo doctor\`: check Bun, Claude, and Codex prerequisites.
- \`xoxo dev | serve\`: start the local Elysia server.
- \`xoxo compare <suite> ...\`: start an X versus Y comparison.
- \`xoxo show <run-id>\`: inspect a run.
- \`xoxo cancel <run-id>\`: cancel a run.
- \`xoxo export <run-id> --format html|json\`: export evidence.
- \`xoxo mcp\`: run the stdout-pure MCP stdio server.
- \`xoxo setup agents --target both\`: preview agent setup; add \`--apply\` to write.

Comparison controls include model and effort for X and Y, optional blind judge and retry count, deterministic seed, trials, timeout, case and tag filters, skills, subagent model and effort, concurrency, and Claude-only max-turn and spawn-depth caps.

## HTTP API

- \`GET /healthz\`
- \`GET /v1/capabilities\`
- \`GET /v1/suites\`
- \`GET /v1/suites/:suite/cases\`
- \`POST /v1/runs\`
- \`GET /v1/runs/:id\`
- \`GET /v1/runs/:id/results\`
- \`GET /v1/runs/:id/events\` (replayable SSE)
- \`POST /v1/runs/:id/cancel\`
- \`POST /v1/runs/:id/export\`

## MCP tools and skills

The stdio MCP server exposes \`xoxo_list_suites\`, \`xoxo_get_case\`, \`xoxo_start_compare\`, \`xoxo_get_run\`, \`xoxo_cancel_run\`, and \`xoxo_export_run\`. Bundled skills are \`xoxo-author\`, \`xoxo-compare\`, and \`xoxo-triage\`.

## Security

Runs use native provider restrictions and isolated fixture copies. Untrusted fixtures should run in an external container or virtual machine. XOXO excludes authentication material from reports, refuses suite-provided shell command strings, and redacts configured secrets from provider streams and artifacts.
`;
}

function withOrigin(html: string, origin: string) {
  return html.replaceAll("https://xoxo.invalid", origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;
    const head = request.method === "HEAD";

    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    if (url.pathname === "/robots.txt") return text(robots(origin), "text/plain; charset=utf-8", head);
    if (url.pathname === "/sitemap.xml") return text(sitemap(origin), "application/xml; charset=utf-8", head);
    if (url.pathname === "/llms.txt") return text(llms(origin), "text/markdown; charset=utf-8", head);
    if (url.pathname === "/llms-full.txt") return text(llmsFull(origin), "text/markdown; charset=utf-8", head);

    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);

    if (headers.get("content-type")?.includes("text/html")) {
      const html = withOrigin(await asset.text(), origin);
      headers.set("cache-control", "public, max-age=0, must-revalidate");
      headers.delete("content-length");
      return new Response(request.method === "HEAD" ? null : html, { status: asset.status, statusText: asset.statusText, headers });
    }

    return new Response(request.method === "HEAD" ? null : asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },
};
