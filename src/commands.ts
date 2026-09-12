/** /checklist command: overlay + display-mode settings + show/hide/clear. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DISPLAY_MODE_DESCRIPTIONS, DISPLAY_MODE_LABELS, ChecklistOverlay } from "./render.js";
import { DISPLAY_MODES, isDisplayMode, type DisplayMode } from "./types.js";

export type ChecklistAction =
  | { name: "open" }
  | { name: "show" }
  | { name: "hide" }
  | { name: "clear" }
  | { name: "settings"; mode?: DisplayMode }
  | { name: "help" };

/** Normalize a user-typed mode word to a DisplayMode (accepts shorthands). */
export function normalizeDisplayMode(raw: string): DisplayMode | undefined {
  const word = raw.trim().toLowerCase().replace(/_/g, "-");
  if (word === "statusbar" || word === "status") return "statusbar";
  if (word === "end-of-turn" || word === "endofturn" || word === "end" || word === "turn") return "end-of-turn";
  if (word === "hidden" || word === "hide" || word === "off" || word === "none") return "hidden";
  return undefined;
}

export function parseChecklistArgs(raw: string): ChecklistAction {
  const parts = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const head = parts[0] ?? "";
  if (head === "") return { name: "open" };
  if (head === "show") return { name: "show" };
  if (head === "hide") return { name: "hide" };
  if (head === "clear") return { name: "clear" };
  if (head === "settings" || head === "setting" || head === "mode") {
    const rest = parts[1] ?? "";
    if (!rest) return { name: "settings" };
    const mode = normalizeDisplayMode(rest);
    return mode ? { name: "settings", mode } : { name: "help" };
  }
  return { name: "help" };
}

export const CHECKLIST_USAGE = "Usage: /checklist [hide|show|clear|settings [statusbar|end-of-turn|hidden]]";

export function registerChecklistCommand(
  pi: ExtensionAPI,
  deps: {
    getDisplayMode: () => DisplayMode;
    setDisplayMode: (mode: DisplayMode, ctx: ExtensionCommandContext) => void;
    clear: (ctx: ExtensionCommandContext) => void;
    getChecklist: () => import("./types.js").Checklist | null;
  },
): void {
  pi.registerCommand("checklist", {
    description: "Show the session task checklist (args: hide | show | clear | settings)",
    getArgumentCompletions: (prefix: string) => {
      const lower = prefix.toLowerCase();
      if (lower.startsWith("settings ") || lower === "settings") {
        const rest = lower.startsWith("settings ") ? lower.slice("settings ".length) : "";
        const modes = [...DISPLAY_MODES].filter((m) => m.startsWith(rest));
        const values = modes.map((m) => `settings ${m}`);
        return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
      }
      const opts = ["hide", "show", "clear", "settings"];
      const filtered = opts.filter((o) => o.startsWith(lower));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = parseChecklistArgs(args);
      if (action.name === "hide") {
        deps.setDisplayMode("hidden", ctx);
        ctx.ui.notify("checklist hidden (/checklist show to restore)", "info");
        return;
      }
      if (action.name === "show") {
        deps.setDisplayMode("statusbar", ctx);
        ctx.ui.notify("checklist display: statusbar (below the input box)", "info");
        return;
      }
      if (action.name === "clear") {
        const ok = ctx.hasUI
          ? await ctx.ui.confirm("Clear checklist?", "Remove all tasks from this session's checklist?")
          : true;
        if (!ok) return;
        deps.clear(ctx);
        ctx.ui.notify("checklist cleared", "info");
        return;
      }
      if (action.name === "settings") {
        if (action.mode) {
          deps.setDisplayMode(action.mode, ctx);
          ctx.ui.notify(`checklist display: ${DISPLAY_MODE_LABELS[action.mode]}`, "info");
          return;
        }
        if (!ctx.hasUI) {
          ctx.ui.notify(`${CHECKLIST_USAGE} (interactive picker needs TUI mode)`, "warning");
          return;
        }
        const current = deps.getDisplayMode();
        const labels = [...DISPLAY_MODES].map(
          (m) => `${DISPLAY_MODE_LABELS[m]} — ${DISPLAY_MODE_DESCRIPTIONS[m]}`,
        );
        const picked = await ctx.ui.select(`Checklist display (current: ${current})`, labels);
        if (!picked) return;
        const mode = [...DISPLAY_MODES].find((m) => picked.startsWith(DISPLAY_MODE_LABELS[m]));
        if (mode && isDisplayMode(mode)) {
          deps.setDisplayMode(mode, ctx);
          ctx.ui.notify(`checklist display: ${DISPLAY_MODE_LABELS[mode]}`, "info");
        }
        return;
      }
      if (action.name === "help") {
        ctx.ui.notify(CHECKLIST_USAGE, "warning");
        return;
      }
      // open overlay
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/checklist overlay requires interactive mode", "error");
        return;
      }
      const checklist = deps.getChecklist();
      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          return new ChecklistOverlay(checklist, theme, {
            onClose: () => done(),
            requestRender: () => tui.requestRender(),
          });
        },
        { overlay: true, overlayOptions: { width: "70%", maxHeight: "70%", anchor: "center" } },
      );
    },
  });
}
