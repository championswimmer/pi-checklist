/** /checklist command: overlay + show/hide/clear. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ChecklistOverlay } from "./render.js";
import type { ChecklistSnapshot } from "./types.js";

export interface CommandDeps {
  getSnapshot: () => ChecklistSnapshot;
}

export function parseChecklistArgs(raw: string): "open" | "show" | "hide" | "clear" | "help" {
  const arg = raw.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (arg === "") return "open";
  if (arg === "show") return "show";
  if (arg === "hide") return "hide";
  if (arg === "clear") return "clear";
  return "help";
}

export function registerChecklistCommand(
  pi: ExtensionAPI,
  deps: {
    getSnapshot: () => ChecklistSnapshot;
    setWidgetVisible: (visible: boolean, ctx: ExtensionCommandContext) => void;
    clear: (ctx: ExtensionCommandContext) => void;
  },
): void {
  pi.registerCommand("checklist", {
    description: "Show the session task checklist (args: hide | show | clear)",
    getArgumentCompletions: (prefix: string) => {
      const opts = ["hide", "show", "clear"];
      const filtered = opts.filter((o) => o.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const action = parseChecklistArgs(args);
      if (action === "hide") {
        deps.setWidgetVisible(false, ctx);
        ctx.ui.notify("checklist widget hidden (/checklist show to restore)", "info");
        return;
      }
      if (action === "show") {
        deps.setWidgetVisible(true, ctx);
        ctx.ui.notify("checklist widget shown", "info");
        return;
      }
      if (action === "clear") {
        const ok = ctx.hasUI
          ? await ctx.ui.confirm("Clear checklist?", "Remove all tasks from this session's checklist?")
          : true;
        if (!ok) return;
        deps.clear(ctx);
        ctx.ui.notify("checklist cleared", "info");
        return;
      }
      if (action === "help") {
        ctx.ui.notify("Usage: /checklist [hide|show|clear]", "warning");
        return;
      }
      // open overlay
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/checklist overlay requires interactive mode", "error");
        return;
      }
      const snapshot = deps.getSnapshot();
      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          return new ChecklistOverlay(snapshot.checklist, theme, {
            onClose: () => done(),
            requestRender: () => tui.requestRender(),
          });
        },
        { overlay: true, overlayOptions: { width: "70%", maxHeight: "70%", anchor: "center" } },
      );
    },
  });
}
