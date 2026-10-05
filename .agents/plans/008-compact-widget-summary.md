# 008 — Compact widget status summary

Status: Complete

## Scope and design

1. Replace the live widget header's long labels and literal checklist label with a checkmark, done/total ratio and icon/count pairs for done, ongoing, ready, blocked and cancelled. Retain the optional checklist title.
2. Per follow-up request, use the same compact summary in the minimal footer (without title). Always honor the selected Nerd Font or emoji artwork, even when task rows use color/pill style. Keep zero counts visible and leave task ordering, overlay and transcript unchanged. Cancelled tasks remain excluded from the progress denominator.
3. Add regression tests for widget/footer parity, counts, title, style/icon variants, empty lists and narrow-width rendering; document the compact summaries and rebuild tracked `dist/`.

## Verification

- Run `npm test` (build + existing and new regression tests).
- Load `pi -e ./src/index.ts` in print mode and TUI; exercise a checklist and check the below-editor header without changing real global preferences.

## Results

- `npm test`: all 29 tests pass; tracked `dist/` rebuilt.
- Print-mode `/checklist settings statusbar color emoji` loads the source extension successfully with isolated `PI_CODING_AGENT_DIR`.
- PTY TUI smoke with a reconstructed four-task checklist verifies both the compact widget header and minimal footer: `☑️ 1/4  ✅ 1  🔄 1  ▶️ 1  ⛔ 1  ❌ 0`. Pi normalizes repeated spaces in the footer. Project trust was granted for the temporary session only.
- `git diff --check` clean.
