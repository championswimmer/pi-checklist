# 015 — Independent display controls

Status: done — all 89 tests pass; source TUI started (timed out intentionally). Print mode loaded the extension but the provider returned HTTP 402 for the prompt.

- Replace the display selector with independent widget and footer on/off controls, preserving legacy display modes and commands.
- Encode widget-only as an additional persisted display mode so snapshots and global preferences remain compatible.
- Test all combinations, persistence and lifecycle; rebuild and smoke-test source in print and TUI modes.
