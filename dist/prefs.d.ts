import { type DisplayMode, type IconSet, type StatusStyle } from "./types.js";
export interface GlobalPrefs {
    displayMode?: DisplayMode;
    statusStyle?: StatusStyle;
    iconSet?: IconSet;
}
/** Resolve the pi agent dir: `PI_CODING_AGENT_DIR` or `~/.pi/agent`. */
export declare function resolveAgentDir(): string;
/** Absolute path of the global prefs file (overridable dir for tests). */
export declare function prefsFilePath(agentDir?: string): string;
/** Load global prefs; `{}` when missing, corrupt, or unreadable. */
export declare function loadGlobalPrefs(agentDir?: string): GlobalPrefs;
/** Save global prefs (best-effort, silent fail for ephemeral/read-only sessions). */
export declare function saveGlobalPrefs(prefs: GlobalPrefs, agentDir?: string): void;
