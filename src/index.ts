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
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerChecklistCommand } from "./commands.js";
import {
  footerText,
  paintWidget,
  renderChecklistResult,
  renderCreateCall,
  renderReadCall,
  renderUpdateCall,
} from "./render.js";
import { buildInjectSnippet, loadFromBranch, resolveDisplayMode } from "./store.js";
import {
  CREATE_GUIDELINES,
  CREATE_SNIPPET,
  ChecklistCreateParams,
  ChecklistReadParams,
  ChecklistUpdateParams,
  READ_GUIDELINES,
  READ_SNIPPET,
  UPDATE_GUIDELINES,
  UPDATE_SNIPPET,
  executeCreate,
  executeRead,
  executeUpdate,
} from "./tools.js";
import type { ChecklistSnapshot, DisplayMode } from "./types.js";

const WIDGET_KEY = "checklist";
const STATUS_KEY = "checklist";
const CUSTOM_TYPE = "pi-checklist";

export default function (pi: ExtensionAPI) {
  // In-memory cache; the session JSONL branch is the source of truth.
  let state: ChecklistSnapshot = { v: 1, checklist: null, widgetVisible: true, displayMode: "statusbar" };
  // True between turn_start and turn_end/agent_settled. In "end-of-turn"
  // mode the widget stays hidden mid-turn and appears when the turn settles.
  let inTurn = false;

  const getDisplayMode = (): DisplayMode => resolveDisplayMode(state);

  function refreshUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    try {
      const checklist = state.checklist;
      const mode = getDisplayMode();
      const hasTasks = !!checklist && checklist.tasks.length > 0;
      if (mode === "hidden" || !hasTasks) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        ctx.ui.setStatus(STATUS_KEY, mode === "hidden" ? undefined : (footerText(checklist) ?? undefined));
        return;
      }
      // Footer stays live in both visible modes (cheap, out of the way).
      ctx.ui.setStatus(STATUS_KEY, footerText(checklist) ?? undefined);
      // End-of-turn mode defers the full widget until the turn settles.
      if (mode === "end-of-turn" && inTurn) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        return;
      }
      const frozen = checklist;
      const placement = mode === "end-of-turn" ? undefined : { placement: "belowEditor" as const };
      ctx.ui.setWidget(
        WIDGET_KEY,
        (_tui, theme) => ({
          render: (width: number) => paintWidget(frozen, theme, width),
          invalidate: () => {},
        }),
        placement,
      );
    } catch {
      // UI refresh must never break a turn. Footer-only fallback: already
      // cleared/failed above; nothing more to do.
    }
  }

  /** Persist the snapshot to the session JSONL (belt-and-braces alongside tool details). */
  function persistSnapshot(snapshot: ChecklistSnapshot): void {
    try {
      pi.appendEntry(CUSTOM_TYPE, snapshot);
    } catch {
      // Ephemeral/print sessions have no session file — in-memory still works.
    }
  }

  function commit(snapshot: ChecklistSnapshot, ctx: ExtensionContext): void {
    state = snapshot;
    persistSnapshot(snapshot);
    refreshUi(ctx);
  }

  function reconstruct(ctx: ExtensionContext): void {
    try {
      const branch = ctx.sessionManager.getBranch();
      const loaded = loadFromBranch(branch as Parameters<typeof loadFromBranch>[0]);
      // Normalize: carry the resolved mode explicitly so future snapshots
      // (and legacy widgetVisible-only entries) stay consistent.
      state = { ...loaded, displayMode: resolveDisplayMode(loaded) };
    } catch {
      state = { v: 1, checklist: null, displayMode: "statusbar" };
    }
    refreshUi(ctx);
  }

  // -- tools ---------------------------------------------------------------

  pi.registerTool({
    name: "checklist_create",
    label: "Checklist Create",
    description: "Create or extend the session task checklist (replace by default, or append). Returns 3-char task ids.",
    promptSnippet: CREATE_SNIPPET,
    promptGuidelines: CREATE_GUIDELINES,
    parameters: ChecklistCreateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mutation = executeCreate(state.checklist, state.widgetVisible, params, getDisplayMode());
      commit(mutation.snapshot, ctx);
      return { content: [{ type: "text", text: mutation.text }], details: mutation.snapshot };
    },
    renderCall: (args, theme) => renderCreateCall(args as { tasks?: Array<{ title?: string }> }, theme),
    renderResult: (result, { expanded }, theme) => renderChecklistResult(result, expanded, theme),
  });

  pi.registerTool({
    name: "checklist_read",
    label: "Checklist Read",
    description: "Read the session task checklist with ready/blocked status per task.",
    promptSnippet: READ_SNIPPET,
    promptGuidelines: READ_GUIDELINES,
    parameters: ChecklistReadParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const mutation = executeRead(state.checklist, params);
      return { content: [{ type: "text", text: mutation.text }], details: mutation.snapshot };
    },
    renderCall: (_args, theme) => renderReadCall(theme),
    renderResult: (result, { expanded }, theme) => renderChecklistResult(result, expanded, theme),
  });

  pi.registerTool({
    name: "checklist_update",
    label: "Checklist Update",
    description: "Advance session checklist tasks (all-or-nothing): move status, retitle, edit notes/dependsOn.",
    promptSnippet: UPDATE_SNIPPET,
    promptGuidelines: UPDATE_GUIDELINES,
    parameters: ChecklistUpdateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mutation = executeUpdate(state.checklist, state.widgetVisible, params, getDisplayMode());
      commit(mutation.snapshot, ctx);
      return { content: [{ type: "text", text: mutation.text }], details: mutation.snapshot };
    },
    renderCall: (args, theme) => renderUpdateCall(args as { updates?: Array<{ id?: string }> }, theme),
    renderResult: (result, { expanded }, theme) => renderChecklistResult(result, expanded, theme),
  });

  // -- /checklist command ----------------------------------------------------

  registerChecklistCommand(pi, {
    getDisplayMode,
    setDisplayMode: (mode: DisplayMode, ctx: ExtensionContext) => {
      state = { ...state, displayMode: mode, widgetVisible: mode !== "hidden" };
      persistSnapshot(state);
      refreshUi(ctx);
    },
    clear: (ctx: ExtensionContext) => {
      state = { v: 1, checklist: null, widgetVisible: state.widgetVisible, displayMode: getDisplayMode() };
      persistSnapshot(state);
      refreshUi(ctx);
    },
    getChecklist: () => state.checklist,
  });

  // -- session + turn lifecycle ----------------------------------------------

  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
  pi.on("turn_start", async (_event, ctx) => {
    inTurn = true;
    refreshUi(ctx);
  });
  pi.on("turn_end", async (_event, ctx) => {
    inTurn = false;
    refreshUi(ctx);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    inTurn = false;
    refreshUi(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    void ctx;
    const checklist = state.checklist;
    if (!checklist || checklist.tasks.length === 0) return;
    const open = checklist.tasks.some((t) => t.status === "planned" || t.status === "ongoing");
    if (!open) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${buildInjectSnippet(checklist)}` };
  });
}
