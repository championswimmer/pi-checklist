/** /checklist command: overlay + settings (display / style / icons / usage) + show/hide/clear. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type RenderOpts } from "./render.js";
import { type DisplayMode, type IconSet, type StatusStyle, type UsageMode } from "./types.js";
export type ChecklistAction = {
    name: "open";
} | {
    name: "show";
} | {
    name: "hide";
} | {
    name: "clear";
} | {
    name: "settings";
    displayMode?: DisplayMode;
    statusStyle?: StatusStyle;
    iconSet?: IconSet;
    usage?: UsageMode;
} | {
    name: "help";
};
/** Normalize a user-typed mode word to a DisplayMode (accepts shorthands). */
export declare function normalizeDisplayMode(raw: string): DisplayMode | undefined;
/** Normalize a user-typed style word to a StatusStyle (accepts shorthands). */
export declare function normalizeStatusStyle(raw: string): StatusStyle | undefined;
/** Normalize a user-typed icon-set word to an IconSet (accepts shorthands). */
export declare function normalizeIconSet(raw: string): IconSet | undefined;
/** Normalize a user-typed usage word to a UsageMode (accepts shorthands). */
export declare function normalizeUsageMode(raw: string): UsageMode | undefined;
export declare function parseChecklistArgs(raw: string): ChecklistAction;
export declare const CHECKLIST_USAGE = "Usage: /checklist [show|hide|clear|settings [statusbar|end-of-turn|hidden] [color|pill|icon] [nerd-font|emoji] [moderate|aggressive]]";
export interface ChecklistCommandDeps {
    getDisplayMode: () => DisplayMode;
    setDisplayMode: (mode: DisplayMode, ctx: ExtensionCommandContext) => void;
    getStatusStyle: () => StatusStyle;
    setStatusStyle: (style: StatusStyle, ctx: ExtensionCommandContext) => void;
    getIconSet: () => IconSet;
    setIconSet: (iconSet: IconSet, ctx: ExtensionCommandContext) => void;
    getUsage: () => UsageMode;
    setUsage: (usage: UsageMode, ctx: ExtensionCommandContext) => void;
    getRenderOpts: () => RenderOpts;
    clear: (ctx: ExtensionCommandContext) => void;
    getChecklist: () => import("./types.js").Checklist | null;
}
export declare function registerChecklistCommand(pi: ExtensionAPI, deps: ChecklistCommandDeps): void;
