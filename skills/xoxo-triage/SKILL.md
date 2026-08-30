---
name: xoxo-triage
description: Triage XOXO failures using evidence without rerunning unnecessarily.
---

# XOXO triage

Read the run with `xoxo_get_run` first. Separate provider/process errors,
deterministic assertion failures, and judge indeterminacy. Inspect the saved
diff and event evidence in the exported report before recommending a rerun.

Report: case and trial, candidate, terminal state, failed assertion, relevant
tool/subagent event, and the smallest next action. Do not call a model failure
when the process timed out, the fixture was invalid, or judge output was
malformed.
