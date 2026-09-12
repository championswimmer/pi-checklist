/**
 * pi-checklist — session-scoped task checklist for the pi coding agent.
 *
 * Three tools (checklist_create / checklist_read / checklist_update), a
 * widget + footer status, a /checklist overlay + display settings, and
 * session-JSONL persistence (tool result details + appendEntry,
 * reconstructed from the current branch).
 *
 * Display modes (see /checklist settings):
 * - "statusbar": persistent widget below the input box + footer (default).
 * - "end-of-turn": widget above the input box, shown when a turn settles.
 * - "hidden": no widget or footer; /checklist overlay still works.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI): void;
