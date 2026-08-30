Gossip Girl here, your one and only source into the scandalous lives of Manhattan’s coding elite. Spotted on the Upper East Side: two major players competing for the crown, and only one gets to sit on the steps of the Met. Who’s pulling the strings, and who’s getting exposed? Let’s find out.

# XOXO

Spotted: XOXO, the ultimate playground where headless Claude Code and Codex go head-to-head. We put every little candidate through a fresh, isolated fixture, keep receipts with normalized events and redacted secrets, run ruthless assertions, and—when things get really juicy—call in a blind third model to judge their every move. Because around here, darling, reputation is everything.

## Quick start

You can't sit with us unless you have Bun 1.2+ and authenticated `claude` and `codex` CLIs sitting pretty on your `PATH`.

```sh
bun install
bun run xoxo init
bun run xoxo doctor
bun run xoxo compare examples/smoke.yaml \
  --x claude:claude-sonnet-4-6 --x-effort high \
  --y codex:gpt-5.6-sol --y-effort high
bun run xoxo dev
```

Sneak a peek at [http://127.0.0.1:5173](http://127.0.0.1:5173) after running `dev` to dish on all the latest runs. The server stays on loopback by default—we do love our privacy. Want to make a real scene? Run `bun run build && bun run xoxo serve --port 4242` for the full production show.

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

The strict dress code is `claude:<model>` or `codex:<model>`. Want to spice things up? Throw in `--x-effort`, `--y-effort`, `--judge`, `--judge-retries`, `--seed`, `--trials`, `--timeout`, `--case`, `--tag`, `--x-skill`, `--y-skill`, `--x-agent-model`, `--x-agent-effort`, `--x-agent-max-turns`, `--x-agent-concurrency`, and `--x-agent-spawn-depth` (repeat with `y` for your other favorite). Just remember: max turns and spawn depth are exclusive privileges for Claude. XOXO doesn't do double standards when Codex demands strict parity.

## HTTP API

Our Elysia server loves to share all the best gossip. It serves up `GET /healthz`, `/v1/capabilities`, `/v1/suites`, `/v1/suites/:suite/cases`, `POST /v1/runs`, `GET /v1/runs/:id`, `GET /v1/runs/:id/results`, replayable drama via `GET /v1/runs/:id/events` (SSE), `POST /v1/runs/:id/cancel`, and `POST /v1/runs/:id/export`.

## MCP and skills

`xoxo mcp` whispers protocol secrets over stdio, keeping stdout completely pristine for pure protocol messages. It offers the hottest tools in town: `xoxo_list_suites`, `xoxo_get_case`, `xoxo_start_compare`, `xoxo_get_run`, `xoxo_cancel_run`, and `xoxo_export_run`.

Run `xoxo setup agents` to preview who's getting invited and what skills they're showing up with. Add `--apply` if you're bold enough to write directly to `.mcp.json` and `.xoxo/skills/`. The inner circle includes `xoxo-author`, `xoxo-compare`, and `xoxo-triage`.

## Suite format

Check out [`examples/smoke.yaml`](examples/smoke.yaml) if you want a little taste of how it's done. Keep your fixtures deterministic, and make sure your output, file, diff, tool, and subagent assertions are locked down before bringing in semantic rubrics. After all, a good red/green twin is the only way to keep everyone honest.

## Security

We keep our dirty laundry hidden. Runs operate inside native provider restrictions with pristine fixture copies—so if your code is toxic, run it in an external container or VM. XOXO never leaks authentication secrets into reports, refuses to run sketchy shell command strings from suite data, and redacts your dirty little secrets before anyone else can catch a glimpse.

You know you love me,

XOXO
