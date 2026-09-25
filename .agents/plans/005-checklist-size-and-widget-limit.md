# Plan 005 — checklist size and live-widget limits

**Status:** complete
**Goal:** Cap each session checklist at 10 tasks while keeping the persistent statusbar/end-of-turn widget compact by showing only its top 5 task rows. The `/checklist show` dialog must continue to render the complete checklist.

## Design

1. Define `MAX_CHECKLIST_TASKS = 10` in `src/store.ts` and validate the resulting total in `createOrAppend()`. This covers both `replace` and `append` atomically, with a clear error before a snapshot is mutated.
2. Replace the line-budget widget behavior with an explicit `WIDGET_MAX_TASKS = 5` in `src/render.ts`: sort using the existing priority order, render only the first five task rows, and add a compact “+N more” summary when tasks are omitted. The footer counter remains unchanged.
3. Leave `ChecklistOverlay` unchanged: it already iterates every sorted view, so bare `/checklist` and `/checklist show` render all tasks.
4. Update user and maintainer docs (`README.md`, `AGENTS.md`) to make the two limits explicit, then rebuild committed `dist/`.
5. Keep the validation permanent in a `tests/` Node built-in test-runner suite and expose it as `npm run test`.

## Verification

- `npm run build` and `npm run test` succeed.
- Permanent store checks prove 10-item replacement/append work and an 11th task is rejected without changing the source checklist.
- Permanent renderer checks prove the widget contains five task rows plus an overflow indicator and the overlay has all task views.
- Load the source extension using `pi -e ./src/index.ts` in print mode (or equivalent non-interactive smoke check).

## Completion

- [x] Implemented and documented
- [x] Built and smoke-tested
- [x] Committed and pushed
