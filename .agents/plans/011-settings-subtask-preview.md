# 011 — Settings subtask preview

Status: complete — implemented, verified and independently reviewed; PR #3 ready to merge

1. Pass the current subtasks toggle into the settings preview renderer, including initial render and invalidation.
2. Keep five existing demo tasks; when enabled, show two children (done/ongoing) under Write the widget and one ready child under Update the docs. Use the same themed glyph/pill styling and indented ↳ convention as checklist rows. No real checklist mutations.
3. Add renderer and interactive settings tests for on/off, stages, style/icon variants, and immediate toggling.
4. Rebuild tracked dist, run all tests, smoke-load source in print and TUI modes, review the diff, and merge through a GitHub PR.

## Verification

- `npm test`: 40/40 passing; build regenerated tracked dist.
- `git diff --check`: clean.
- Source print-mode load (`pi -e ./src/index.ts -p` with explicit extension and discovery disabled): exited successfully.
- Source TUI load in pseudo-terminal: extension appeared in loaded resources with no load errors. Automated terminal input did not open settings, so end-to-end visual toggle verification was inconclusive; the SettingsList keyboard integration test verifies both toggle directions, invalidation and widths 30/60/100.
- `npm install` reported three existing dependency audit advisories; dependency versions were not changed in this scoped UI fix.
