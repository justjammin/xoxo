---
name: xoxo-compare
description: Drive an XOXO model comparison through the local MCP server.
---

# XOXO compare

Use `xoxo_list_suites` and `xoxo_get_case` to confirm the suite. Start a run
with `xoxo_start_compare`, passing explicit provider/model JSON for both X and
Y. Include effort, skills, and subagent settings in each candidate when they
matter. Poll `xoxo_get_run` until it is terminal; use `xoxo_export_run` for a
portable report.

Never infer parity: if a provider reports an unsupported effort or subagent
control, surface it as a warning and stop the comparison rather than silently
downgrading it.
