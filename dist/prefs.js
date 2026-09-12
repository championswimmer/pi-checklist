/**
 * Global display prefs for pi-checklist.
 *
 * Checklist *tasks* stay session-scoped (session JSONL branch), but the
 * *display settings* (displayMode / statusStyle / iconSet) persist across
 * all sessions in `<agentDir>/pi-checklist.json`.
 *
 * Agent-dir resolution mirrors pi's own `getAgentDir()` (see pi docs
 * `environment-variables.md` and `dist/config.js`): the
 * `PI_CODING_AGENT_DIR` env var wins, otherwise `~/.pi/agent`.
 * No runtime imports from pi packages — `node:os`/`node:path` only.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDisplayMode, isIconSet, isStatusStyle } from "./types.js";
const PREFS_FILE = "pi-checklist.json";
/** Resolve the pi agent dir: `PI_CODING_AGENT_DIR` or `~/.pi/agent`. */
export function resolveAgentDir() {
    const raw = process.env.PI_CODING_AGENT_DIR;
    if (raw && raw.trim().length > 0)
        return expandPath(raw.trim());
    return join(homedir(), ".pi", "agent");
}
function expandPath(p) {
    if (p === "~")
        return homedir();
    if (p.startsWith("~/"))
        return join(homedir(), p.slice(2));
    return p;
}
/** Absolute path of the global prefs file (overridable dir for tests). */
export function prefsFilePath(agentDir = resolveAgentDir()) {
    return join(agentDir, PREFS_FILE);
}
/** Load global prefs; `{}` when missing, corrupt, or unreadable. */
export function loadGlobalPrefs(agentDir) {
    let raw;
    try {
        raw = readFileSync(prefsFilePath(agentDir ?? resolveAgentDir()), "utf-8");
    }
    catch {
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return {};
    }
    if (typeof parsed !== "object" || parsed === null)
        return {};
    const v = parsed;
    const out = {};
    if (isDisplayMode(v.displayMode))
        out.displayMode = v.displayMode;
    if (isStatusStyle(v.statusStyle))
        out.statusStyle = v.statusStyle;
    if (isIconSet(v.iconSet))
        out.iconSet = v.iconSet;
    return out;
}
/** Save global prefs (best-effort, silent fail for ephemeral/read-only sessions). */
export function saveGlobalPrefs(prefs, agentDir) {
    try {
        const dir = agentDir ?? resolveAgentDir();
        mkdirSync(dir, { recursive: true });
        const file = join(dir, PREFS_FILE);
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ v: 1, ...prefs }, null, 2) + "\n", "utf-8");
        renameSync(tmp, file);
    }
    catch {
        // Global prefs are a convenience — never break a turn for them.
    }
}
