import { type LoadedSettings, type SettingsStore, type SettingsStoreOptions } from "pi-extension-settings-tui/store";
import { type DisplayMode, type IconSet, type StatusStyle, type UsageMode } from "./types.js";
export declare const CHECKLIST_SETTINGS_FILE = "pi-checklist.json";
export interface ChecklistPreferences {
    displayMode: DisplayMode;
    statusStyle: StatusStyle;
    iconSet: IconSet;
    usage: UsageMode;
    subtasksEnabled: boolean;
    metaEnabled: boolean;
}
export declare function settingsForPreferences({ displayMode, ...prefs }: Partial<ChecklistPreferences>): Partial<ChecklistSettings>;
export declare function displayModeForSettings({ widgetDisplay, footerEnabled }: Pick<ChecklistSettings, "widgetDisplay" | "footerEnabled">): DisplayMode;
export declare function preferencesForSettings({ widgetDisplay, footerEnabled, ...settings }: ChecklistSettings): ChecklistPreferences;
export declare const checklistSettingsSchema: import("pi-extension-settings-tui/schema").SettingsSchema<{
    widgetDisplay: import("pi-extension-settings-tui/schema").EnumFieldDef<"end-of-turn" | "persistent" | "off", any>;
    footerEnabled: import("pi-extension-settings-tui/schema").BooleanFieldDef<any>;
    statusStyle: import("pi-extension-settings-tui/schema").EnumFieldDef<"color" | "pill" | "icon", any>;
    iconSet: import("pi-extension-settings-tui/schema").EnumFieldDef<"nerd-font" | "emoji", any>;
    usage: import("pi-extension-settings-tui/schema").EnumFieldDef<"moderate" | "aggressive", any>;
    subtasksEnabled: import("pi-extension-settings-tui/schema").BooleanFieldDef<any>;
    metaEnabled: import("pi-extension-settings-tui/schema").BooleanFieldDef<any>;
    preview: import("pi-extension-settings-tui/schema").ExternalFieldDef<{
        statusStyle: StatusStyle;
        iconSet: IconSet;
        subtasksEnabled: boolean;
    }>;
}>;
export type ChecklistSettings = typeof checklistSettingsSchema.Type;
export type ChecklistSettingsStore = SettingsStore<typeof checklistSettingsSchema.fields>;
export declare function createChecklistSettingsStore(options?: SettingsStoreOptions, legacyPreferences?: ChecklistPreferences): ChecklistSettingsStore;
/** Check whether a Pi context trusts the current project directory. */
export declare function isProjectTrusted(ctx?: {
    isProjectTrusted?: () => boolean;
}): boolean;
/** Synchronously load the validated global layer from `<agentDir>/pi-checklist.json`.
 * Returns `{}` when missing, corrupt, symlinked, or unreadable. */
export declare function loadGlobalLayerSync(agentDir?: string): Partial<ChecklistSettings>;
/** Synchronously resolve effective global settings (defaults -> global). */
export declare function loadEffectiveSettingsSync(agentDir?: string): ChecklistSettings;
export declare function loadChecklistSettings(store: ChecklistSettingsStore, trustedProject: boolean, migrate: boolean): Promise<LoadedSettings<ChecklistSettings>>;
/**
 * Patch one or more checklist settings via `SettingsStore`.
 * Keys currently overridden in a trusted project layer update the project layer
 * so quick-set commands take effect immediately; all other keys update global.
 */
export declare function patchChecklistSettings(store: ChecklistSettingsStore, preferences: Partial<ChecklistPreferences>, options: {
    trustedProject: boolean;
}): Promise<LoadedSettings<ChecklistSettings>>;
