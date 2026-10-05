# 010 — Approved summary icon spacing

Status: Complete

## Scope

1. Add one space after each summary icon in the widget header and footer; keep single spaces between groups and hide zero states.
2. Preserve selected artwork and optional widget title. Approved samples: `☑️ 2/5 ✅ 2 🔄 3` and ` 2/5  2  3`.
3. Update tests/docs, rebuild dist, and verify with npm test plus source print/TUI smoke checks using isolated preferences.

## Results

- All 30 tests pass; tracked dist rebuilt; git diff --check clean.
- Source extension loads in print mode and both header/footer render the approved spacing in PTY TUI tests for emoji and Nerd Font sets. Preferences isolated to a temporary agent directory.
