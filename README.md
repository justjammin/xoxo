# XOXO

XOXO is a local evaluation harness for comparing headless Claude Code and
Codex. It runs each candidate in a fresh fixture, records normalized events and
redacted artifacts, applies deterministic assertions, and optionally asks a blind
third model to judge semantic rubrics.

## Quick start

Requires Bun 1.2+ and authenticated `claude` and `codex` CLIs on `PATH`.

```sh
bun install
bun run xoxo init
bun run xoxo doctor
bun run xoxo compare examples/smoke.yaml \
  --x claude:claude-sonnet-4-6 --x-effort high \
  --y codex:gpt-5.6-sol --y-effort high
bun run xoxo dev
```

Open `http://127.0.0.1:5173` after `dev` to review runs. The server binds to
loopback by default. Run `bun run build && bun run xoxo serve --port 4242` for
the production dashboard.

## CLI

```text
xoxo init                         create .xoxo/config.yaml
xoxo doctor                       check Bun, Claude, and Codex prerequisites
xoxo dev | serve                  start the local Elysia server
xoxo compare <suite> ...          start an X vs Y comparison
xoxo show <run-id>                inspect a run
xoxo cancel <run-id>              cancel a run
xoxo export <run-id> --format html|json
xoxo mcp                          run the stdout-pure MCP stdio server
xoxo setup agents --target both   print setup changes (add --apply to write)
```

Candidate syntax is `claude:<model>` or `codex:<model>`. Useful flags include
`--x-effort`, `--y-effort`, `--judge`, `--judge-retries`, `--seed`, `--trials`, `--timeout`, `--case`,
`--tag`, `--x-skill`, `--y-skill`, `--x-agent-model`,
`--x-agent-effort`, `--x-agent-max-turns`, `--x-agent-concurrency`, and
`--x-agent-spawn-depth` (repeat with the `y` prefix for Y). Max turns and spawn
depth are Claude-only controls; XOXO rejects them for Codex strict-parity runs.

## HTTP API

The Elysia server exposes `GET /healthz`, `/v1/capabilities`, `/v1/suites`,
`/v1/suites/:suite/cases`, `POST /v1/runs`, `GET /v1/runs/:id`,
`GET /v1/runs/:id/results`, replayable `GET /v1/runs/:id/events` (SSE),
`POST /v1/runs/:id/cancel`, and `POST /v1/runs/:id/export`.

## MCP and skills

`xoxo mcp` speaks MCP over stdio and keeps stdout exclusively for protocol
messages. It provides `xoxo_list_suites`, `xoxo_get_case`,
`xoxo_start_compare`, `xoxo_get_run`, `xoxo_cancel_run`, and `xoxo_export_run`.

Run `xoxo setup agents` to preview registration and skill installation. Add
`--apply` explicitly to write `.mcp.json` and project-local `.xoxo/skills/`.
Bundled skills are `xoxo-author`, `xoxo-compare`, and `xoxo-triage`.

## Suite format

See [`examples/smoke.yaml`](examples/smoke.yaml) for a minimal suite. Keep
fixtures deterministic and use output/file/diff/tool/subagent assertions before
semantic rubrics. A red/green twin makes the harness itself testable.

## Security

Runs use native provider restrictions and isolated fixture copies; use an
external container or VM when fixtures are untrusted. XOXO never copies authentication material into artifacts,
never accepts shell command strings from suite data, and redacts configured
secrets from provider streams and reports.
