---
name: xoxo-author
description: Author deterministic XOXO eval suites with tiny fixtures and red/green twins.
---

# XOXO suite author

Use the `xoxo` MCP tools to inspect available suites before creating a new one.
Keep fixtures small, deterministic, and safe: no network, credentials, or
commands embedded in suite data. Every behavior should have a passing case and
an intentionally failing twin.

Suite checklist:

1. Give each case a stable `id`, prompt file, fixture, and tags.
2. Prefer deterministic assertions (files, diffs, output, tools) before a rubric.
3. Add a rubric only for behavior that cannot be mechanically checked.
4. Run `xoxo doctor`, then one trial locally before increasing trial count.

Example assertion fields are documented in `examples/smoke.yaml`.
