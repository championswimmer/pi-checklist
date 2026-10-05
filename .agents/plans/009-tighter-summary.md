# 009 — Tighter checklist summaries

Status: Complete

## Scope

1. Hide state counters whose count is zero in both header and footer.
2. Remove spaces between each icon and its count; use one space between groups. Keep the checkmark, done/total ratio, selected artwork and optional widget title.
3. Update regression tests and docs, rebuild tracked dist, run npm test and print/TUI smoke checks with isolated preferences.

Example: `☑️2/5 ✅2 🔄3`.

## Results

- `npm test`: 30 tests pass; tracked dist rebuilt. Regression coverage includes zero-state hiding in all styles and both icon sets.
- Source extension print-mode load and PTY TUI smoke pass with isolated preferences; widget and footer both show `☑️1/4 ✅1 🔄1 ▶️1 ⛔1`, omitting the zero cancelled count.
- `git diff --check` clean.
