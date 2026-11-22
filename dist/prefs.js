/**
 * Global display prefs helpers for pi-checklist.
 *
 * Backed by `pi-extension-settings-tui` (`checklistSettingsSchema` + hardened
 * atomic JSON I/O). Keeps the exported `GlobalPrefs` / `resolveAgentDir` /
 * `prefsFilePath` / `loadGlobalPrefs` / `saveGlobalPrefs` surface backwards
 * compatible for callers and tests.
 */
import * as path from "node:path";
import { resolveDefaultAgentDir, resolveScopeFilePath, writeJsonFileHardened, } from "pi-extension-settings-tui/store";
import { checklistSettingsSchema, displayModeForSettings, loadGlobalLayerSync, settingsForPreferences, } from "./settings.js";
/** Resolve the pi agent dir: `PI_CODING_AGENT_DIR` or `~/.pi/agent`. */
export function resolveAgentDir() {
    return resolveDefaultAgentDir();
}
/** Absolute path of the global prefs file (overridable dir for tests). */
export function prefsFilePath(agentDir = resolveAgentDir()) {
    return resolveScopeFilePath(checklistSettingsSchema, "global", { agentDir });
}
/** Load global prefs; `{}` when missing, corrupt, or unreadable. */
export function loadGlobalPrefs(agentDir) {
    const { widgetDisplay, footerEnabled, ...rest } = loadGlobalLayerSync(agentDir);
    const prefs = rest;
    if (widgetDisplay !== undefined || footerEnabled !== undefined) {
        const defaults = checklistSettingsSchema.getDefaults();
        prefs.displayMode = displayModeForSettings({
            widgetDisplay: widgetDisplay ?? defaults.widgetDisplay,
            footerEnabled: footerEnabled ?? defaults.footerEnabled,
        });
    }
    return prefs;
}
/** Save global prefs (best-effort, silent fail for ephemeral/read-only sessions). */
export function saveGlobalPrefs(prefs, agentDir) {
    try {
        const dir = path.resolve(agentDir ?? resolveAgentDir());
        const file = resolveScopeFilePath(checklistSettingsSchema, "global", { agentDir: dir });
        const validated = checklistSettingsSchema.validatePartial(settingsForPreferences(prefs)).values;
        writeJsonFileHardened(file, validated, { baseRoot: dir });
    }
    catch {
        // Global prefs are a convenience — never break a turn for them.
    }
}
