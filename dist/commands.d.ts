/** /checklist command: overlay + display-mode settings + show/hide/clear. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type DisplayMode } from "./types.js";
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
    mode?: DisplayMode;
} | {
    name: "help";
};
/** Normalize a user-typed mode word to a DisplayMode (accepts shorthands). */
export declare function normalizeDisplayMode(raw: string): DisplayMode | undefined;
export declare function parseChecklistArgs(raw: string): ChecklistAction;
export declare const CHECKLIST_USAGE = "Usage: /checklist [show|hide|clear|settings [statusbar|end-of-turn|hidden]]";
export declare function registerChecklistCommand(pi: ExtensionAPI, deps: {
    getDisplayMode: () => DisplayMode;
    setDisplayMode: (mode: DisplayMode, ctx: ExtensionCommandContext) => void;
    clear: (ctx: ExtensionCommandContext) => void;
    getChecklist: () => import("./types.js").Checklist | null;
}): void;
