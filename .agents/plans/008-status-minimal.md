# 008 — Status-minimal display

Status: complete

## Results

- Implemented footer-only summary mode with settings, persistence, docs, and tracked dist output.
- `npm test`: all 24 tests pass; `git diff --check`: clean.
- Source print-mode load passes with `pi -ne -e ./src/index.ts --no-session -p` (disable installed extensions to avoid duplicate checklist tools).
- Source TUI load, quick-set confirmation, and overlay smoke passed via PTY. PTY teardown timed out on SIGTERM; the process exited after the PTY closed (confirmed no remaining process).
- Feature commit/push and minor release follow verification using the release skill.

## Scope and design

- Add `status-minimal` to display modes, settings picker, quick-set parsing, and help.
- Show the existing widget's first-line progress summary in the footer only; clear the task widget, including across mode switches and turn lifecycle events.
- Preserve other display modes and session/global settings persistence. Overlay and tool transcript rendering remain unchanged.
- Update README and AGENTS; rebuild tracked dist before committing.

## Verification

- Node tests for mode validation, parsing, persistence, footer summary, lifecycle, mode switches, and clearing.
- `npm test`, source extension print/TUI load smoke checks.
- Commit and push feature, then run the release skill's minor-release script (2.1.0 → 2.2.0).
