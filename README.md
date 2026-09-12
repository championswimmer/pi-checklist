# pi-checklist

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that gives the coding agent a **session-scoped task checklist**.

The agent can:

- create a list of tasks for the current coding session
- read the current list
- move tasks through `planned` → `ongoing` → `done` / `cancelled`
- declare `dependsOn` so blocked work is obvious
- render the list in the TUI after each turn so you can see what is done and what is left

## Check out my other Pi extensions

- [![pi-auto-theme](https://img.shields.io/badge/🎨_pi--auto--theme-blue?style=flat-square)](https://github.com/championswimmer/pi-auto-theme) — Auto-syncs Pi theme with OS dark/light mode.
- [![pi-cache-graph](https://img.shields.io/badge/📊_pi--cache--graph-orange?style=flat-square)](https://github.com/championswimmer/pi-cache-graph) — Real-time prompt cache hit rates and token metrics.
- [![pi-checklist](https://img.shields.io/badge/✅_pi--checklist-teal?style=flat-square)](https://github.com/championswimmer/pi-checklist) — Session task checklist with dependencies and a TUI renderer.
- [![pi-context-prune](https://img.shields.io/badge/✂️_pi--context--prune-green?style=flat-square)](https://github.com/championswimmer/pi-context-prune) — Prunes verbose tool outputs from context while preserving history.
- [![pi-context-usage](https://img.shields.io/badge/🪟_pi--context--usage-purple?style=flat-square)](https://github.com/championswimmer/pi-context-usage) — Dot-grid visualization of context window token usage.
- [![pi-speedometer](https://img.shields.io/badge/⚡_pi--speedometer-yellow?style=flat-square)](https://github.com/championswimmer/pi-speedometer) — Live tokens/sec and TTFT in the status bar.
- [![pi-subscription-meter](https://img.shields.io/badge/💳_pi--subscription--meter-red?style=flat-square)](https://github.com/championswimmer/pi-subscription-meter) — Tracks subscription quotas and rate limits across AI providers.

## Status

Implemented (v0.1.0). See [`.agents/plans/001-checklist-extension.md`](.agents/plans/001-checklist-extension.md) for the design.

## Usage

The agent gets three tools:

| Tool | Purpose |
|---|---|
| `checklist_create` | Create (or replace/append) the session task list |
| `checklist_read` | Read tasks, statuses, and which items are blocked |
| `checklist_update` | Move tasks through `planned` / `ongoing` / `done` / `cancelled` |

Each task gets a **3-character alphanumeric id** (FNV-1a hash of the title, e.g. `k7q`). `dependsOn` names those ids. A task cannot become `ongoing` (or shortcut to `done`) until every dependency is `done`.

Status machine: `planned` → `ongoing` / `done` / `cancelled`, `ongoing` → `done` / `cancelled` / `planned`, `cancelled` → `planned`. `done` is terminal in v1.

The TUI shows the live list (widget below the editor + `☑ n/m` footer) refreshed after every tool call and turn, and `/checklist` opens a full overlay (`/checklist hide|show` toggles the widget, `/checklist clear` empties the list).

State lives in the session JSONL (tool-result `details` + `pi.appendEntry`), so it survives `/resume`, `/branch`, `/undo`, and compaction.

## Install

**Quick one-off test:**

```sh
pi -e ./src/index.ts
```

**Development (symlink into pi's global extensions dir):**

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/src/index.ts" ~/.pi/agent/extensions/pi-checklist.ts
```

Hot-reload inside pi with `/reload`.

**As a package:**

```sh
pi install git:github.com/championswimmer/pi-checklist
```
