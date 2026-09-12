# Plan 004 — global checklist settings (persist across sessions)

**Status:** done (implemented; tsc clean, prefs + wiring smoke pass)
**Goal:** Persist `displayMode` / `statusStyle` / `iconSet` globally in the pi agent dir so they survive across sessions, while checklist tasks stay session-scoped in the session JSONL.

## Confirmed from pi docs (don't re-derive)

- `docs/environment-variables.md`: `PI_CODING_AGENT_DIR` overrides the config directory; default `~/.pi/agent`.
- `dist/config.js` `getAgentDir()`: reads `process.env[ENV_AGENT_DIR]` where `ENV_AGENT_DIR = ${APP_NAME.toUpperCase()}_CODING_AGENT_DIR` (= `PI_CODING_AGENT_DIR`), expands tilde, else `join(homedir(), ".pi", "agent")`.
- `ExtensionContext` has no `agentDir` — extension resolves the dir itself.
- Per `AGENTS.md`, no runtime imports of pi internals — resolve with `node:os`/`node:path` + env var only.

## Design

- New `src/prefs.ts` (pure node, no pi imports):
  - `resolveAgentDir()`: `PI_CODING_AGENT_DIR` (tilde-expanded, non-empty) else `join(homedir(), ".pi", "agent")`.
  - File: `join(resolveAgentDir(), "pi-checklist.json")` → `{ v: 1, displayMode?, statusStyle?, iconSet? }`.
  - `loadGlobalPrefs()`: read+validate (via `isDisplayMode`/`isStatusStyle`/`isIconSet`), `{}` on any failure.
  - `saveGlobalPrefs(p)`: `mkdir -p` + atomic write (tmp+rename); silent fail (ephemeral/print, read-only FS).
- Precedence in `reconstruct()`: checklist tasks from branch; prefs = global file when valid, else branch snapshot, else defaults. Global wins so a newer setting from another session isn't clobbered by resuming an old session.
- Writers: `setDisplayMode/setStatusStyle/setIconSet` update state + `persistSnapshot` (session) + `saveGlobalPrefs` (global). Tool commits (create/update) don't change prefs — no global write needed. `clear` keeps prefs as today.
- Initial state at factory load seeds from `loadGlobalPrefs()` so print-mode/no-session use still honors global prefs.

## Verification

- `npm run build` (`tsc --noEmit` equivalent) clean.
- Node smoke: save prefs → fresh load returns them; `PI_CODING_AGENT_DIR` override respected; corrupt JSON falls back to `{}`; session snapshot without prefs + global file → global wins.
- `pi -e ./src/index.ts` print-mode round-trip still works.
- Rebuild `dist/` before commit (git installs need built files; `prepublishOnly` rebuilds on publish).
