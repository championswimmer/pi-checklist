# 003 — Settings screen: display placement + status style (pill with bg, icons)

Status: done (implemented, `npm run build` clean, 28-check smoke script ALL PASS).

## Scope

Improve `/checklist settings` (TUI) + quick-set args:

1. **Display placement toggle** (already three modes, now all editable in one screen):
   - `statusbar` — persistent widget below the input box + footer (default).
   - `end-of-turn` — widget above the input box, shown when a turn settles.
   - `hidden` — no widget/footer; `/checklist show` restores + pops overlay.
2. **Progress status style** (`StatusStyle`, default `pill`):
   - `color` — color-coded rows only, no status word (blocked deps `← ids` still shown).
   - `pill` — status word rendered as a real pill: text on a colored background
     via `theme.bg(...)` (NOT just colored text).
   - `icon` — status conveyed by a leading icon only, no status word. Icon set
     switch (`IconSet`): `powerline` (Nerd Font glyphs) vs `emoji`.
3. Settings UI becomes one `SettingsList` screen (Display / Progress style /
   Progress icons) with a live themed preview, replacing the single
   `ctx.ui.select` display picker. Quick-set: `/checklist settings <display>
   [style] [icons]`, e.g. `/checklist settings end-of-turn pill emoji`.

## Icon picks (verified against nerd-fonts repo mappings)

Nerd Font Octicons live at `F400–F533` (second column of
`src/glyphs/octicons/mapping` on master; fetched 2026-09-12):

| state     | powerline (Nerd Font, single-cell) | emoji |
|-----------|------------------------------------|-------|
| ongoing   | sync `U+F46A`                      | 🔄    |
| ready     | play `U+F4FF`                      | ▶️     |
| blocked   | blocked `U+F479`                   | ⛔     |
| done      | check-circle-fill `U+F4A4`         | ✅     |
| cancelled | x-circle-fill `U+F530`             | ❌     |

Written as `\uXXXX` escapes in source with comments. Powerline set needs a
Nerd Font in the terminal (noted in the setting description); emoji are
double-width and handled by `truncateToWidth`/`visibleWidth`.

## Pill colors (`ThemeBg` from pi theme.d.ts)

| state     | bg                | fg        |
|-----------|-------------------|-----------|
| ongoing   | `toolPendingBg`   | `warning` |
| ready     | `selectedBg`      | `accent`  |
| blocked   | `toolErrorBg`     | `error`   |
| done      | `toolSuccessBg`   | `success` |
| cancelled | `customMessageBg` | `dim`     |

Pill = `theme.bg(bg, theme.bold(theme.fg(fg, ` label `)))`.

## Design decisions

- `StatusStyle = "color" | "pill" | "icon"`, `IconSet = "powerline" | "emoji"`
  in `types.ts` (+ `is*` guards, `STATUS_STYLES`/`ICON_SETS` consts).
- Persisted on `ChecklistSnapshot` as optional `statusStyle?` / `iconSet?`;
  `resolveStatusStyle` (default `pill`) / `resolveIconSet` (default
  `powerline`) in `store.ts`, same migration pattern as `resolveDisplayMode`.
- `render.ts` gets shared helpers (`statusKindOf`, `glyphFor`,
  `pillFor`, `paintPill`, `RenderOpts`) used by widget, transcript
  `renderChecklistResult`, and `ChecklistOverlay` so all three agree.
- `snapshotOf`/`executeCreate`/`executeUpdate`/`executeRead` thread the prefs
  through so tool-result `details` (used by transcript rendering + branch
  reconstruction) always carry the current prefs. `renderChecklistResult`
  resolves style from `details`, not globals.
- `index.ts` normalizes prefs on reconstruct; `refreshUi` passes opts to
  `paintWidget`; overlay gets current opts via deps.
- Default `pill` preserves today's status-word look (now with background).

## Verification

- `npm run build` (`tsc -p tsconfig.json`) clean.
- Node smoke script against `dist/` with a stub theme: render widget lines in
  all 3 styles × 2 icon sets; assert pill lines contain bg ANSI (`\x1b[48;`)
  and icon lines contain the expected glyphs; assert color lines have no
  status words.
- `pi -e ./dist/index.js` print-mode round-trip still works (per AGENTS.md).
