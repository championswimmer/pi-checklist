# AGENTS.md — pi-checklist

Project context for AI coding agents working in this repo. Keep this file up to date as the project evolves.

## What this project is

`pi-checklist` is a **pi extension** (for the pi coding agent, `@earendil-works/pi-coding-agent`) that gives the agent a session-scoped task checklist:

- Create a list of tasks for the current coding session
- Read the current list
- Update task status through a state machine: `planned` → `ongoing` → `done` / `cancelled`
- Tasks may declare `dependsOn` so the agent knows what must finish before a task can start
- A TUI widget/renderer shows remaining vs completed work after each agent turn

This is **not** a general project-management app. It is a lightweight, in-session working list for the agent (and the human watching the TUI).

## Housekeeping rules (follow these)

1. **Keep this AGENTS.md current.** When you learn something durable about the codebase, pi APIs, or project decisions, record it here.
2. **Plans live in `.agents/plans/`.** Before any non-trivial task, write a numbered plan file (e.g. `.agents/plans/001-checklist-extension.md`) describing scope, design decisions, and verification steps. Update the plan's status when done.
3. **Skills live in `.agents/skills/`.** Project-local skills go here as `SKILL.md` folders. Do not put implementation code in skills.
4. **Keep changes small and reversible.** Prefer Markdown for plans; keep code and docs aligned.
5. **Verify before claiming done.** Load the extension with `pi -e ./src/index.ts` (print and TUI) after behavior changes.

## Repo layout

```
pi-checklist/
├── AGENTS.md                  ← this file
├── README.md                  ← user-facing docs
├── .gitignore
└── .agents/
    ├── plans/                 ← numbered task plans
    └── skills/                ← project-local skills
```

Intended once implementation starts (see `.agents/plans/`):

```
pi-checklist/
├── package.json               ← pi package manifest
├── src/
│   ├── index.ts               ← extension entry (export default function)
│   ├── types.ts               ← Task / Checklist / status types
│   ├── store.ts               ← in-memory store, transitions, dependency checks
│   ├── prefs.ts               ← global display prefs (<agentDir>/pi-checklist.json)
│   ├── tools.ts               ← checklist_create / checklist_read / checklist_update
│   ├── render.ts              ← widget, tool renderers, /checklist overlay
│   └── commands.ts            ← /checklist command
└── .agents/
```

## Key technical facts (researched, don't re-derive)

Pi docs live in the installed package, not this repo:

- Extensions: `~/.nvm/versions/node/v22.21.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Packages: `.../docs/packages.md`
- TUI: `.../docs/tui.md`
- Closest official examples:
  - `examples/extensions/todo.ts` — stateful tool + session-branch reconstruction + `/todos` overlay
  - `examples/extensions/plan-mode/` — `setWidget` todo list + `setStatus` progress during execution
  - `examples/extensions/widget-placement.ts` — above/below-editor widgets
  - `examples/extensions/status-line.ts` — footer status

### How pi extensions work

- Extensions are TypeScript files executed via jiti — **no build step**. Type-only imports are erased.
- Entry point: `export default function (pi: ExtensionAPI) { ... }`.
- Available imports without installing deps: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`. Import **types only** from pi packages when possible — runtime imports of pi internals are fragile.
- For a distributable package, list those four in `peerDependencies` with `"*"` and put any real runtime deps in `dependencies`. Add `"keywords": ["pi-package"]`.
- Local testing: `pi -e ./dist/index.js` (built output, what ships) or `pi -e ./src/index.ts` (sources, no rebuild). Rebuild with `npm run build` before testing dist. Auto-discovery: symlink into `~/.pi/agent/extensions/` (global, `/reload`) or `.pi/extensions/` (project-local, needs trust).
- Install as a package: `pi install git:github.com/championswimmer/pi-checklist` or `pi install npm:pi-checklist` once published.

### State that survives branch / resume

Sessions are JSONL trees under `~/.pi/agent/sessions/` (or `$PI_CODING_AGENT_DIR/sessions` when overridden). **That file is the store for tasks.** Do not use a sidecar for tasks.

Write a versioned snapshot (`{ v: 1, checklist, widgetVisible }`) in two places on every mutation:

1. Tool result `details` — official branching pattern (`extensions.md` State Management, `examples/extensions/todo.ts`). Not sent to the LLM.
2. `pi.appendEntry("pi-checklist", snapshot)` — same JSONL, `type: "custom"`, also not sent to the LLM. Covers human commands (`/checklist clear`) that never produce a tool result.

Reconstruct tasks by walking `ctx.sessionManager.getBranch()` oldest → newest; last matching snapshot wins. **Never `getEntries()`** (that mixes other branches). Re-run on `session_start` (`/resume`) and `session_tree` (`/branch`, `/undo`). Compaction appends a summary; it does not delete old lines, so `getBranch()` still sees the snapshot. The LLM may forget it — re-inject a compact snippet on `before_agent_start`.

Display settings (`displayMode`/`statusStyle`/`iconSet`) persist **globally** in `<agentDir>/pi-checklist.json` (`src/prefs.ts`): agent dir = `$PI_CODING_AGENT_DIR` else `~/.pi/agent` (tilde-expanded), mirroring pi's own `getAgentDir()` (`docs/environment-variables.md`, `dist/config.js`). Validate with `isDisplayMode`/`isStatusStyle`/`isIconSet`; silent fail on read/write. Precedence on reconstruct: global file > branch snapshot > defaults. Settings setters write both session snapshot and global file; task mutations touch only the session.

### TUI surfaces we will use

- `ctx.ui.setWidget(key, lines | Component | undefined, { placement? })` — persistent list above or below the editor. Refresh after checklist mutations and on `turn_end` / `agent_settled`.
- `ctx.ui.setStatus(key, text | undefined)` — compact footer like `☑ 3/8`.
- Tool `renderCall` / `renderResult` — compact themed rows in the transcript.
- `ctx.ui.custom()` — `/checklist` overlay for the human (Escape to close). Guard with `ctx.mode === "tui"` / `ctx.hasUI`.
- `promptSnippet` + `promptGuidelines` on tools so the LLM knows when to create/read/update. Guidelines must name the tool (`Use checklist_create when...`), never "this tool".

### Tool registration notes

- `pi.registerTool()` at factory time is enough; no need for dynamic tools here.
- Return `{ content: [{ type: "text", text }], details }` from `execute`. `content` is what the LLM sees; `details` is the snapshot for reconstruction + custom rendering.
- Truncate large tool output (50KB / 2000 lines). A checklist should stay small; still cap rendered widget lines.

## Current status

- [x] Repo scaffolding (`AGENTS.md`, `README.md`, `.agents/`)
- [x] Plan 001 written (`.agents/plans/001-checklist-extension.md`)
- [x] Extension implemented (`package.json`, `src/types.ts`, `src/store.ts`, `src/tools.ts`, `src/render.ts`, `src/commands.ts`, `src/index.ts`)
- [x] GitHub repo created and pushed (`championswimmer/pi-checklist`)
- [x] Smoke-tested with `pi -e` (print-mode tool round-trip; store unit checks via jiti; wiring checks via mocked pi; `tsc --noEmit` clean)
- [x] Release-ready (plan 002): package renamed to unscoped `pi-checklist` v0.1.0, `tsc` build (`tsconfig.json`, `npm run build`) emitting `dist/`, manifest/main/exports pointing at `./dist/index.js`, npm `files` whitelist + `.npmignore` so the tarball ships built JS only (no `src/*.ts`)
- [x] `dist/` committed to git on purpose: pi installs git packages with `npm install --omit=dev` and no build step, so git installs need built files in the clone. Rebuild before every src-touching commit; `prepublishOnly` rebuilds again on publish
- [x] Footgun fixed: exported tool param schemas are annotated `: TSchema` (type-only import from `typebox`) — otherwise declaration emit fails with TS2742 because `StringEnum` (from `@earendil-works/pi-ai`) brands types with pi's nested typebox copy
- [x] Settings upgrade (plan 003): `/checklist settings` is one `SettingsList` screen (display / progress style / progress icons) with live preview + quick-set (`/checklist settings [display] [style] [icons]`); status styles `color`/`pill`/`icon`, pill = text on `theme.bg` background, icon sets `nerd-font` (NF Octicons U+F46A/F500/F479/F4A4/F530) vs `emoji` (🔄▶️⛔✅❌); prefs persisted on snapshot, widget/transcript/overlay all honor them (28-check smoke ALL PASS); settings is a rounded-corner bordered overlay dialog (frameDialog in render.ts — pi-tui has no bordered box, dialogs draw ╭─╮/│/╰─╯ chrome themselves) with a nerdfonts.com hint under the icons row
- [x] Global settings (plan 004): display prefs also persist in `<agentDir>/pi-checklist.json` (`src/prefs.ts`, agent dir = `$PI_CODING_AGENT_DIR` else `~/.pi/agent`, mirroring pi's `getAgentDir`); precedence global > session snapshot > defaults; tsc clean, prefs unit + mocked wiring smoke pass
- [x] Usage guidance setting (`usage: moderate|aggressive`, default moderate): steers how strongly the injected system prompt pushes checklist use (moderate = long-running/multi-step only, aggressive = almost every task). Persisted in snapshot + global prefs and editable via `/checklist settings`, but baked into the prompt via a value captured at extension load (`usageGuidanceAtLoad` in src/index.ts) — mid-session changes only apply after `/reload`/new session; UI notify + README say so; 19-check mocked smoke verifies the capture semantics
- [x] Checklist dialog border: `ChecklistOverlay.render()` in `src/render.ts` now frames content with `frameDialog()` (same rounded ╭─╮/│/╰─╯ chrome + title-in-top-border as the settings dialog); dropped the old rule-line header
- [x] Release skill (`.agents/skills/release/SKILL.md` + `scripts/release.mjs`): `node scripts/release.mjs <major|minor|patch>` bumps, rebuilds tracked `dist/` (committed first — `npm version` refuses a dirty tree), `npm pack --dry-run`, version-commits, tags `vX.Y.Z`, pushes `main` + tag; tag push publishes via `release.yml`. Invoke as `/skill:release <type>`; bare `/release` needs a local (gitignored, uncommitted) `.pi/prompts/release.md` delegating to the skill — never ship prompts via `package.json`, it would register `/release` for every install user (see pi-context-prune plan 032)
- [x] README Preview section with `docs/checklist-dialog.png` screenshot of the `/checklist` dialog

## Publishing notes

- GitHub repo: `https://github.com/championswimmer/pi-checklist`
- npm name is `pi-checklist` (unscoped), v0.2.0; `publishConfig.access = "public"` kept (harmless unscoped).
- `publishConfig.access = "public"` if scoped.
- Trusted publishing: `.github/workflows/release.yml` publishes to npm on semver tag push (`vX.Y.Z` must match `package.json`) via GitHub OIDC — no `NPM_TOKEN`. One-time manual setup on npmjs.com → package Settings → Trusted Publisher: GitHub Actions `championswimmer` / `pi-checklist` / workflow file `release.yml`. Uses `npm install --ignore-scripts` + `npm run build` + `npm publish --access public --provenance` (provenance is automatic with trusted publishing; flag kept explicit).
