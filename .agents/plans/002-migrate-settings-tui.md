# Plan 002 · Migrate Checklist settings to the shared library

Status: complete

## Design

- Use the published `pi-extension-settings-tui` 0.6 series for settings, storage, and the dialog. Prepare Checklist 4.0.0 with Pi 1.5.0 and Node.js 22.19.0 as minimum versions.
- Keep separate widget and footer controls, the existing quick-set commands, and the settings shortcut from the main checklist. Use a Preview row for the themed sample because the library has no inline preview slot.
- Migrate legacy global and trusted project settings at session startup. Keep the filenames, convert `displayMode` to `widgetDisplay` and `footerEnabled`, and preserve the other supported preferences.
- Use old session preferences as a fallback when the global settings file is absent. Keep an empty global file after a reset so old session preferences cannot reappear.
- Save global and trusted project overrides through the shared store. Apply display and preview-feature edits immediately and capture usage guidance at each session start.

## Verification

- Run the complete suite with Pi 1.5.0 and 1.6.0 peers and check the npm tarball.
- Run source and distribution entry points in actual Pi 1.5.0 and 1.6.0. Verify migration in print and TUI mode, keyboard access in the regular TUI, and mouse access in fullscreen mode.
