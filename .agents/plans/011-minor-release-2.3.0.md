# 011 — Minor release 2.3.0

Status: Complete

## Scope and decisions

1. Verify and commit the user-approved compact summary work (source, tracked dist, regression tests and docs).
2. Origin already has v2.2.0 and the footer-only status-minimal mode. Commit local work and rebase it onto origin/main, preserving that mode and updating its tests for icon summaries. Then run the authoritative `node scripts/release.mjs minor` path from clean `main` to cut v2.3.0. It fast-forwards from origin, builds, checks the package, creates the version commit/tag and pushes main plus tag.
3. Check the tag-triggered Release to npm workflow and npm package version. Do not publish locally or duplicate CI publishing.

## Verification

- `npm test`, `git diff --check`, review pending files.
- Verify clean tree before script and refs/version afterward.
- Inspect Actions status and npm registry once publication completes.

## Results

- Integrated origin's existing v2.2.0/status-minimal work without dropping the footer-only mode; updated its regression tests for the approved icon summary.
- All 33 tests pass; source extension print/TUI smoke passes for full statusbar and footer-only status-minimal with isolated preferences.
- Feature commit: `cb8da8d` (`feat: compact checklist summaries with configurable icons`).
- Release script completed: v2.2.0 → v2.3.0. Version commit `8ebbf10`; main and annotated tag pushed successfully.
- Release workflow succeeded: https://github.com/championswimmer/pi-checklist/actions/runs/37390008391
- CI's trusted publisher accepted `pi-checklist@2.3.0` with provenance; npm reports the package is being processed and may take a few minutes to become available. The immediate registry lookup still returned 404 (propagation), not a publishing failure.
