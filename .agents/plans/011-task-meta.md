# 011 — Task `meta` (preview)

Status: done (npm test 52/52 green; mocked-pi wiring, real print-mode round-trip and tmux TUI dialog smoke verified)

## Goal

Let the agent (or another extension via the same tools) hang a few simple
key/value facts off a task — e.g. `{ "agent": "impl-auth", "pr": 42 }` — with
no namespaces, claims or external API. Preview feature, gated like subtasks.

## Design decisions

- **Shape:** optional `meta?: Record<string, string | number | boolean>` on
  `Task` AND `Subtask` (subtasks share the task lifecycle, so they get it
  too). Absent = no meta. An emptied meta object is removed, not stored as `{}`.
- **Values:** string | number (finite) | boolean. `null` is only a *delete*
  marker in update patches. Objects/arrays/undefined are rejected. Limits to keep
  prompts/dialog sane: ≤ 10 keys, key 1–40 chars (trimmed, `__proto__` rejected),
  string values ≤ 200 chars.
- **Create:** `meta: {k: v}` on a task or subtask entry. `null` values at
  create are skipped (nothing to delete).
- **Update:** `meta` on a task entry or subtask patch is a *merge*: new keys
  set, existing keys overwritten, `k: null` deletes `k`. Follows the same freeze
  rules as other fields (done tasks/subtasks are frozen).
- **Gating (like subtasks):** setting `metaEnabled` (default off), shown as
  "Task meta (preview)" in `/checklist settings`, quick-set `meta` / `no-meta`,
  persisted in snapshot + global prefs (precedence global > snapshot > default).
  Non-empty `meta` while disabled throws a preview error. Existing stored
  meta is kept when disabled, just not shown.
- **System prompt:** when enabled, the live `before_agent_start` hint (re-read
  every turn, like subtasks) explains meta on create/update and null deletion.
  Nothing is added when disabled. Tool schema descriptions + guidelines
  mention it statically.
- **Visibility:** `checklist_read` output lists meta when enabled. TUI: only
  the `/checklist` dialog shows aligned `key  value` rows under tasks (and
  expanded subtasks) with meta; they are not selectable rows, so
  selection / expand-collapse is unchanged. Widget, footer, status,
  transcript renderer: untouched.

## Verification

1. `npm test` (rebuilds `dist/`, runs all node tests incl. new `tests/meta.test.mjs`).
2. `pi -e ./src/index.ts` print-mode smoke with isolated `PI_CODING_AGENT_DIR`.
3. TUI smoke of the `/checklist` dialog via ChecklistOverlay render check.
4. README + AGENTS.md updated; `dist/` rebuilt and tracked.
