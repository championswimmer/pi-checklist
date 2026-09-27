# Plan 006 — blocked task danger styling

**Status:** complete
**Goal:** Make a task blocked by unfinished dependencies use the danger/error color across its whole rendered row, not only its status pill.

## Design

1. Use the theme `error` foreground for the `blocked` status kind in shared row-color selection. This updates the persistent widget and expanded tool transcript consistently.
2. Update the `/checklist` overlay's separately styled title and dependency suffix so blocked rows also use the same error foreground end-to-end.
3. Build the distributable output and run the project test suite.

## Verification

- `npm run build` succeeds.
- `npm test` succeeds.
- Inspect the built renderer to confirm blocked task rows use the `error` theme foreground.

## Completion

- [x] Implemented
- [x] Verified (`npm test`; source extension print-mode smoke with `pi -ne -e ./src/index.ts`)
