# pi-checklist

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that gives the coding agent a **session-scoped task checklist**.

The agent can:

- create a list of tasks for the current coding session
- read the current list
- move tasks through `planned` → `ongoing` → `done` / `cancelled`
- declare `dependsOn` so blocked work is obvious
- render the list in the TUI after each turn so you can see what is done and what is left

## Preview

![/checklist dialog](https://raw.githubusercontent.com/championswimmer/pi-checklist/main/docs/checklist-dialog.png)

The `/checklist` dialog (above) — the live widget and `☑ n/m` footer show the same list during a session.

## Check out my other Pi extensions

- [![pi-auto-theme](https://img.shields.io/badge/🎨_pi--auto--theme-blue?style=flat-square)](https://github.com/championswimmer/pi-auto-theme) — Auto-syncs Pi theme with OS dark/light mode.
- [![pi-cache-graph](https://img.shields.io/badge/📊_pi--cache--graph-orange?style=flat-square)](https://github.com/championswimmer/pi-cache-graph) — Real-time prompt cache hit rates and token metrics.
- [![pi-checklist](https://img.shields.io/badge/✅_pi--checklist-teal?style=flat-square)](https://github.com/championswimmer/pi-checklist) — Session task checklist with dependencies and a TUI renderer.
- [![pi-context-prune](https://img.shields.io/badge/✂️_pi--context--prune-green?style=flat-square)](https://github.com/championswimmer/pi-context-prune) — Prunes verbose tool outputs from context while preserving history.
- [![pi-context-usage](https://img.shields.io/badge/🪟_pi--context--usage-purple?style=flat-square)](https://github.com/championswimmer/pi-context-usage) — Dot-grid visualization of context window token usage.
- [![pi-speedometer](https://img.shields.io/badge/⚡_pi--speedometer-yellow?style=flat-square)](https://github.com/championswimmer/pi-speedometer) — Live tokens/sec and TTFT in the status bar.
- [![pi-subscription-meter](https://img.shields.io/badge/💳_pi--subscription--meter-red?style=flat-square)](https://github.com/championswimmer/pi-subscription-meter) — Tracks subscription quotas and rate limits across AI providers.

## Status

Implemented (v1.0.0). See [`.agents/plans/001-checklist-extension.md`](.agents/plans/001-checklist-extension.md) for the design.

## Usage

The agent gets three tools:

| Tool | Purpose |
|---|---|
| `checklist_create` | Create (or replace/append) the session task list |
| `checklist_read` | Read tasks, statuses, and which items are blocked |
| `checklist_update` | Move tasks through `planned` / `ongoing` / `done` / `cancelled` |

Each task gets a **3-character alphanumeric id** (FNV-1a hash of the title, e.g. `k7q`). `dependsOn` names those ids. A task cannot become `ongoing` (or shortcut to `done`) until every dependency is `done`.

Status machine: `planned` → `ongoing` / `done` / `cancelled`, `ongoing` → `done` / `cancelled` / `planned`, `cancelled` → `planned`. `done` is terminal in v1.

The TUI shows the live list plus a `☑ n/m` footer, and `/checklist` (or `/checklist show`) pops the checklist up in a centered TUI dialog box (`/checklist clear` empties the list). `/checklist settings` opens one screen for every display preference (with a live preview), or quick-set them inline, e.g. `/checklist settings end-of-turn pill emoji moderate`:

Display placement:

- `statusbar` — persistent widget below the input box + footer (default).
- `end-of-turn` — widget above the input box, refreshed when each turn settles.
- `hidden` — no widget or footer; reopen with `/checklist` (overlay) or `/checklist show`.

Progress status style:

- `color` — rows are only color-coded, no status word.
- `pill` — the status word is a pill: text on a colored background (default).
- `icon` — status is a leading progress icon only, no status word.

Progress icons (for the `icon` style):

- `nerd-font` — Nerd Font Octicons: sync / play / blocked / check-circle / x-circle (needs a Nerd Font patched font — get one at nerdfonts.com; default).
- `emoji` — 🔄 ▶️ ⛔ ✅ ❌ (works anywhere).

Usage guidance (how strongly the agent is steered toward the checklist):

- `moderate` — the injected hint asks for the checklist on long-running / multi-step work (refactors, audits, multi-part features); quick one-shot questions go untracked (default).
- `aggressive` — the hint asks for the checklist on almost every task, even small ones; only trivial single-step questions go untracked.

Usage guidance is baked into the system prompt, so it is captured once when the extension loads — after changing it, run `/reload` or start a new pi session for it to take effect. The display settings above apply immediately.

`/checklist hide` is shorthand for hidden mode.

State lives in the session JSONL (tool-result `details` + `pi.appendEntry`), so it survives `/resume`, `/branch`, `/undo`, and compaction. Display settings (`displayMode` / `statusStyle` / `iconSet` / `usage`) additionally persist globally in `<agentDir>/pi-checklist.json` (agent dir = `$PI_CODING_AGENT_DIR` or `~/.pi/agent`), so they carry across sessions; the task list itself stays session-scoped.

## Install

**From npm (release):**

```sh
pi install npm:pi-checklist
```

**From git:**

```sh
pi install git:github.com/championswimmer/pi-checklist
```

**Quick one-off test (built output — this is what ships):**

```sh
npm run build
pi -e ./dist/index.js
```

**Development (symlink sources for hot-reload, no rebuild needed):**

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/src/index.ts" ~/.pi/agent/extensions/pi-checklist.ts
```

Hot-reload inside pi with `/reload`.

## Developing / releasing

- Sources live in `src/`; the published + git-installed entry is the
  built output `dist/index.js` (`npm run build`, TypeScript).
- `dist/` is intentionally committed: pi installs git packages with
  `npm install --omit=dev` and no build step, so the built files must
  exist in the clone. Rebuild (`npm run build`) before every commit
  that touches `src/`.
- The npm tarball is a whitelist (`files` in package.json: `dist`,
  `README.md`, `LICENSE`) plus `.npmignore` as backup — no `.ts`
  sources ship, so pi loads plain JS without jiti transpiling.
- Release flow: bump `version` in package.json → `npm run build` →
  commit (including `dist/`) → `git tag vX.Y.Z && git push origin vX.Y.Z`.
  Pushing the tag triggers `.github/workflows/release.yml`, which verifies
  the tag matches `package.json`, builds, and publishes to npm via
  [trusted publishing](https://docs.npmjs.com/trusted-publishers/) (GitHub
  OIDC — no `NPM_TOKEN` needed). One-time setup: on
  npmjs.com/package/pi-checklist → Settings → Trusted Publisher, add GitHub
  Actions publisher `championswimmer` / `pi-checklist` / `release.yml`.
- Maintainers cut releases with `node scripts/release.mjs <major|minor|patch>`
  (see `.agents/skills/release/SKILL.md`) — it bumps, rebuilds `dist/`,
  commits, tags `vX.Y.Z`, and pushes, and the tag push publishes to npm.
