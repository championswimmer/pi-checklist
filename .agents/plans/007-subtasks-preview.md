# Plan 007 — Subtasks (preview)

**Status:** done (implemented; 20/20 checks green incl. limits suite; tsc clean; print-mode smoke pass; interactive `/checklist settings` TUI eyeball still open)
**Goal:** Preview-gated subtasks: up to 3 per task, sibling-scoped `dependsOn`,
state primitives coupling parent ↔ subtask lifecycles, settings toggle
labelled `(preview)`, lifecycle tests.

## Why

Tasks like "implement auth" decompose into steps the agent wants tracked
without burning top-level slots (max 10). Subtasks give one level of nesting
with strict lifecycle coupling so the parent status always tells the truth.

## Scope

- `Subtask` model nested in `Task.subtasks?` (absent = no subtasks, back-compat).
- `MAX_SUBTASKS_PER_TASK = 3` constant in `store.ts` (like `MAX_CHECKLIST_TASKS`).
- Settings toggle `subtasksEnabled` labelled "Subtasks (preview)", persisted in
  snapshot + `<agentDir>/pi-checklist.json` (precedence global > snapshot >
  default `false`). Tool mutations carrying subtasks are rejected while off.
- Tool surface (only when enabled):
  - `checklist_create` `tasks[].subtasks[]`: `{id?, title, notes?, dependsOn?}`
    (born `planned`; same-batch explicit ids for DAGs, same two-pass alloc).
  - `checklist_update` `updates[].subtasks[]`: entry with `id` patches an
    existing subtask; without `id` adds one (`title` required, starts
    `planned`, `status` rejected on adds). Whole batch stays all-or-nothing.
- Sibling scope: subtask `dependsOn` may reference only subtasks of the same
  parent (self / cross-task / parent-task refs rejected). Per-parent cycle
  detection.

## State primitives (codified in `store.ts`, tested in `tests/subtasks.test.mjs`)

Same per-subtask machine as tasks (`planned→ongoing→done/cancelled`,
`ongoing→done/cancelled/planned`, `cancelled→planned`, `done` terminal/frozen).

- **S1 completion guard:** parent `→ done` requires every subtask terminal
  (`done` or `cancelled` — cancelled counts as resolved, otherwise a dropped
  subtask would brick the parent forever). Error names the open subtasks.
- **S2 auto-progress:** a subtask arriving at `ongoing` (or jumping
  `planned→done`) auto-moves a `planned` parent to `ongoing`. Recorded as an
  explicit change line (`<pid> planned → ongoing (subtask <sid> started)`).
- **S3 inherited block:** subtask `planned → ongoing/done` is rejected while
  the parent is blocked (parent's own `blockedBy` non-empty) — subtasks inherit
  the parent's blocked state. Effective subtask `blockedBy` = sibling deps not
  done + (parent blocked ? parent's `blockedBy` : []). Subtask→sibling-dep
  guard mirrors the task guard.
- **S4 parent terminal freeze:** subtasks of a `done`/`cancelled` parent are
  frozen (same freeze error as done tasks). Parent `→ cancelled`
  cascade-cancels open (`planned`/`ongoing`) subtasks; reviving the parent
  (`cancelled→planned`) does NOT revive subtasks.
- **S5 parent step-back guard:** parent `ongoing→planned` is rejected while any
  subtask is `ongoing` (step the subtasks back first — otherwise S2's invariant
  "ongoing child ⇒ parent not planned" breaks silently).
- **S6 capacity:** adds beyond 3 per task rejected; create-time lists longer
  than 3 rejected. Whole batch rolls back (existing `applyUpdates` copy-first
  pattern covers subtasks too).

Subtask ids share the checklist-wide 3-char space (unique across tasks AND
subtasks) so every tool reference is unambiguous; `all` stays reserved.

## Rendering

- `formatTaskLine` appends indented `↳ <sid> [status] "title"` lines.
- Widget: subtask rows under the shown parents (indented two spaces, pill kept);
  the 5-row cap still counts top-level tasks only (subtasks ride along, each
  parent capped at its 3).
- Overlay + expanded transcript result: same indented rows.
- Footer `☑ n/m` stays task-level (unchanged).

## Settings UI

- Interactive screen: new `SettingItem` "Subtasks (preview)" with values
  `["off","on"]`, description noting the preview status + 3-per-task cap.
- Quick-set: `/checklist settings subtasks` (on) / `no-subtasks` (off);
  completions + `CHECKLIST_USAGE` updated.

## Verification

- `npm test` (tsc + all suites) green; new `tests/subtasks.test.mjs` covers:
  S1 (planned/ongoing subtask blocks parent done; cancelled doesn't; error
  names open ids), S2 (auto-progress + change line; direct planned→done too),
  S3 (blocked parent rejects subtask start; unblocks after dep done; inherited
  blockedBy in view), S4 (freeze; cancel cascade; no revive), S5 (step-back
  rejection then success after subtask planned), S6 (4th add rejected, batch
  atomic), scoping (cross-task dep rejected, self-dep rejected, cycle
  rejected), gating (subtask payload rejected while flag off), cap constant.
- `pi -e ./src/index.ts` print-mode round-trip incl. settings toggle path.
- `tsc --noEmit` clean; rebuild `dist/` before commit (dist is committed).
