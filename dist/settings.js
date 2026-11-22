/**
 * Declarative settings schema and layered JSON store for pi-checklist,
 * powered by `pi-extension-settings-tui`.
 *
 * Persists to `<agentDir>/pi-checklist.json` (Global) and
 * `<cwd>/.pi/pi-checklist.json` (Project, when trusted).
 */
import * as path from "node:path";
import { defineSettings, field } from "pi-extension-settings-tui/schema";
import { createJsonFileStorageAdapter, createSettingsStore, readJsonFileHardened, resolveDefaultAgentDir, resolveScopeFilePath, stripSecretKeys, } from "pi-extension-settings-tui/store";
import { isDisplayMode } from "./types.js";
export const CHECKLIST_SETTINGS_FILE = "pi-checklist.json";
const displaySettings = {
    statusbar: { widgetDisplay: "persistent", footerEnabled: true },
    "widget-only": { widgetDisplay: "persistent", footerEnabled: false },
    "status-minimal": { widgetDisplay: "off", footerEnabled: true },
    "end-of-turn": { widgetDisplay: "end-of-turn", footerEnabled: true },
    hidden: { widgetDisplay: "off", footerEnabled: false },
};
export function settingsForPreferences({ displayMode, ...prefs }) {
    return displayMode === undefined ? prefs : { ...prefs, ...displaySettings[displayMode] };
}
export function displayModeForSettings({ widgetDisplay, footerEnabled }) {
    if (widgetDisplay === "off")
        return footerEnabled ? "status-minimal" : "hidden";
    if (!footerEnabled)
        return "widget-only";
    return widgetDisplay === "end-of-turn" ? "end-of-turn" : "statusbar";
}
export function preferencesForSettings({ widgetDisplay, footerEnabled, ...settings }) {
    return { ...settings, displayMode: displayModeForSettings({ widgetDisplay, footerEnabled }) };
}
const legacyDefaults = {
    statusStyle: "pill",
    iconSet: "nerd-font",
    usage: "moderate",
    subtasksEnabled: false,
    metaEnabled: false,
    ...displaySettings.statusbar,
};
export const checklistSettingsSchema = defineSettings({
    id: "pi-checklist",
    title: "Checklist Settings",
    description: "Configure how the session checklist is displayed and how the agent uses it.",
    version: 2,
    settingsFile: CHECKLIST_SETTINGS_FILE,
    scopes: ["global", "project"],
    defaultScope: "global",
    saveMode: "immediate",
    migrate: (raw, scope) => {
        if ("v" in raw && raw.v !== 1)
            return raw;
        const next = { ...raw };
        const isLegacyV1 = next.v === 1;
        const displayMode = next.displayMode === undefined && next.widgetVisible === false
            ? "hidden"
            : next.displayMode;
        if (isDisplayMode(displayMode)) {
            next.widgetDisplay ??= displaySettings[displayMode].widgetDisplay;
            next.footerEnabled ??= displaySettings[displayMode].footerEnabled;
        }
        else if (displayMode !== undefined) {
            // Let validation report an invalid legacy setting before any disk rewrite.
            return next;
        }
        delete next.displayMode;
        delete next.v;
        delete next.widgetVisible;
        if (isLegacyV1 && scope === "global") {
            for (const [key, defaultValue] of Object.entries(legacyDefaults)) {
                if (next[key] === defaultValue) {
                    delete next[key];
                }
            }
        }
        return next;
    },
    normalizeDraft: (draft, key) => {
        if (key === "footerEnabled" && draft.widgetDisplay === "end-of-turn") {
            // Changing the footer from the legacy end-of-turn mode resumes the
            // persistent widget, as in the old independent switches.
            return { ...draft, widgetDisplay: "persistent" };
        }
        if (key === "widgetDisplay" && draft.widgetDisplay === "end-of-turn") {
            return { ...draft, footerEnabled: true };
        }
        return draft;
    },
    fields: {
        widgetDisplay: field.enum({
            label: "Statusbar widget",
            description: "Show the task widget below the editor or at the end of each turn.",
            default: "persistent",
            options: [
                {
                    value: "persistent",
                    label: "On",
                    description: "Persistent widget below the input box.",
                    tone: "accent",
                },
                {
                    value: "off",
                    label: "Off",
                    description: "Open the task list on demand with /checklist.",
                    tone: "muted",
                },
                {
                    value: "end-of-turn",
                    label: "End of turn",
                    description: "Widget above the input box when each turn settles, plus footer.",
                    tone: "default",
                },
            ],
        }),
        footerEnabled: field.boolean({
            label: "Status footer",
            description: "Show the compact progress summary in the footer.",
            default: true,
        }),
        statusStyle: field.enum({
            label: "Progress style",
            description: "color: colored rows only · pill: status on colored background · icon: leading progress icon only.",
            default: "pill",
            options: [
                {
                    value: "pill",
                    label: "Pill",
                    description: "Status word as a colored background badge (PROG / REDY / BLCK / DONE).",
                    tone: "accent",
                },
                {
                    value: "color",
                    label: "Color",
                    description: "Color-coded rows only, no status word.",
                    tone: "default",
                },
                {
                    value: "icon",
                    label: "Icon",
                    description: "Leading progress icon only, using the selected icon set.",
                    tone: "default",
                },
            ],
        }),
        iconSet: field.enum({
            label: "Progress icons",
            description: "nerd-font needs a Nerd Font patched font (nerdfonts.com); emoji works in any modern terminal.",
            default: "nerd-font",
            options: [
                {
                    value: "nerd-font",
                    label: "Nerd Font",
                    description: "Nerd Font Octicons (needs a patched font from nerdfonts.com).",
                    tone: "accent",
                },
                {
                    value: "emoji",
                    label: "Emoji",
                    description: "🔄 ▶️ ⛔ ✅ ❌ — works in any modern terminal.",
                    tone: "default",
                },
            ],
        }),
        usage: field.enum({
            label: "Usage guidance",
            description: "Steers the system prompt (moderate: multi-step work · aggressive: almost every task). Takes effect after /reload or a new session.",
            default: "moderate",
            options: [
                {
                    value: "moderate",
                    label: "Moderate",
                    description: "Track long-running / multi-step work only; skip quick one-shot questions.",
                    tone: "default",
                },
                {
                    value: "aggressive",
                    label: "Aggressive",
                    description: "Track almost every task, even small ones.",
                    tone: "warn",
                },
            ],
        }),
        subtasksEnabled: field.boolean({
            label: "Subtasks",
            description: "Nested subtasks inside tasks (at most 3 per task, sibling-only dependsOn).",
            default: false,
            experimental: true,
        }),
        metaEnabled: field.boolean({
            label: "Task meta",
            description: "Key/value metadata on tasks and subtasks (set on create, merge on update, null deletes); shown in /checklist.",
            default: false,
            experimental: true,
        }),
    },
});
export function createChecklistSettingsStore(options, legacyPreferences) {
    if (options?.adapter)
        return createSettingsStore(checklistSettingsSchema, options);
    // A global reset leaves an empty file so pre-global snapshots cannot
    // restore preferences that the user explicitly cleared.
    const global = createJsonFileStorageAdapter(checklistSettingsSchema, { ...options, deleteWhenEmpty: false });
    const project = createJsonFileStorageAdapter(checklistSettingsSchema, { ...options, deleteWhenEmpty: true });
    const legacyOverrides = legacyPreferences && settingsForPreferences(legacyPreferences);
    if (legacyOverrides) {
        const defaults = checklistSettingsSchema.getDefaults();
        for (const key of checklistSettingsSchema.persistedFieldKeys) {
            if (legacyOverrides[key] === defaults[key])
                delete legacyOverrides[key];
        }
    }
    return createSettingsStore(checklistSettingsSchema, {
        ...options,
        adapter: {
            getPaths: global.getPaths,
            async readLayer(scope) {
                const read = await global.readLayer(scope);
                if (scope === "global" && !read.exists && legacyOverrides) {
                    // Pre-global Checklist versions kept preferences only in the
                    // session. Keep the missing file's hash for optimistic writes.
                    return { ...read, exists: true, data: legacyOverrides };
                }
                return read;
            },
            writeLayer: (scope, data, writeOptions) => (scope === "global" ? global : project).writeLayer(scope, data, writeOptions),
        },
    });
}
/** Check whether a Pi context trusts the current project directory. */
export function isProjectTrusted(ctx) {
    return typeof ctx?.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
}
/** Synchronously load the validated global layer from `<agentDir>/pi-checklist.json`.
 * Returns `{}` when missing, corrupt, symlinked, or unreadable. */
export function loadGlobalLayerSync(agentDir) {
    try {
        const resolvedAgentDir = path.resolve(agentDir ?? resolveDefaultAgentDir());
        const filePath = resolveScopeFilePath(checklistSettingsSchema, "global", agentDir !== undefined ? { agentDir } : undefined);
        const read = readJsonFileHardened(filePath, { baseRoot: resolvedAgentDir });
        if (!read.exists || read.data === null)
            return {};
        let raw = stripSecretKeys(read.data).cleaned;
        if (checklistSettingsSchema.config.migrate) {
            raw = checklistSettingsSchema.config.migrate(raw, "global");
            raw = stripSecretKeys(raw).cleaned;
        }
        return checklistSettingsSchema.validatePartial(raw).values;
    }
    catch {
        return {};
    }
}
/** Synchronously resolve effective global settings (defaults -> global). */
export function loadEffectiveSettingsSync(agentDir) {
    return checklistSettingsSchema.resolveEffective({ global: loadGlobalLayerSync(agentDir), project: {} }, { includeProject: false });
}
export async function loadChecklistSettings(store, trustedProject, migrate) {
    const loaded = await store.load({ trustedProject });
    if (!migrate || loaded.migratedScopes.length === 0 || loaded.warnings.length > 0)
        return loaded;
    try {
        return await store.load({ trustedProject, persistMigration: true });
    }
    catch (err) {
        // The settings are still usable if the file or directory is read-only.
        const message = err instanceof Error ? err.message : String(err);
        return { ...loaded, warnings: [`Could not rewrite legacy settings: ${message}`] };
    }
}
/**
 * Patch one or more checklist settings via `SettingsStore`.
 * Keys currently overridden in a trusted project layer update the project layer
 * so quick-set commands take effect immediately; all other keys update global.
 */
export async function patchChecklistSettings(store, preferences, options) {
    const { trustedProject } = options;
    let loaded = await store.load({ trustedProject });
    const patch = settingsForPreferences(preferences);
    const displayInProject = trustedProject &&
        (loaded.layers.project.widgetDisplay !== undefined || loaded.layers.project.footerEnabled !== undefined);
    const globalPatch = {};
    const projectPatch = {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined)
            continue;
        const inProject = key === "widgetDisplay" || key === "footerEnabled"
            ? displayInProject
            : trustedProject && loaded.layers.project[key] !== undefined;
        if (inProject) {
            projectPatch[key] = value;
        }
        else {
            globalPatch[key] = value;
        }
    }
    if (Object.keys(globalPatch).length > 0) {
        loaded = (await store.patch(globalPatch, { scope: "global", trustedProject, expectedSnapshot: loaded.snapshot })).loaded;
    }
    if (Object.keys(projectPatch).length > 0) {
        loaded = (await store.patch(projectPatch, { scope: "project", trustedProject, expectedSnapshot: loaded.snapshot })).loaded;
    }
    return loaded;
}
