/**
 * pi-checklist — session-scoped task checklist for the pi coding agent.
 *
 * Three tools (checklist_create / checklist_read / checklist_update), a
 * widget + footer status, a /checklist overlay + display settings, and
 * session-JSONL persistence (tool result details + appendEntry,
 * reconstructed from the current branch). Display *settings*
 * (displayMode / statusStyle / iconSet) additionally persist globally in
 * `<agentDir>/pi-checklist.json` (agent dir = `PI_CODING_AGENT_DIR` or
 * `~/.pi/agent`, mirroring pi's own getAgentDir), so they survive across
 * sessions; checklist tasks stay session-scoped.
 *
 * Display modes (see /checklist settings):
 * - "statusbar": persistent widget below the input box + footer (default).
 * - "end-of-turn": widget above the input box, shown when a turn settles.
 * - "hidden": no widget or footer; /checklist overlay still works.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI): void;
