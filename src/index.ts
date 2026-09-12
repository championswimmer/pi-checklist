/**
 * pi-checklist — session-scoped task checklist for the pi coding agent.
 *
 * Three tools (checklist_create / checklist_read / checklist_update), a
 * below-editor widget + footer status, a /checklist overlay, and session-JSONL
 * persistence (tool result details + appendEntry, reconstructed from the
 * current branch).
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
import { buildInjectSnippet, loadFromBranch } from "./store.js";
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
import type { ChecklistSnapshot } from "./types.js";

const WIDGET_KEY = "checklist";
const STATUS_KEY = "checklist";
const CUSTOM_TYPE = "pi-checklist";

export default function (pi: ExtensionAPI) {
  // In-memory cache; the session JSONL branch is the source of truth.
  let state: ChecklistSnapshot = { v: 1, checklist: null, widgetVisible: true };

  const getSnapshot = (): ChecklistSnapshot => state;

  function refreshUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    try {
      const checklist = state.checklist;
      const visible = state.widgetVisible !== false;
      if (!checklist || checklist.tasks.length === 0 || !visible) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
      } else {
        const frozen = checklist;
        ctx.ui.setWidget(
          WIDGET_KEY,
          (_tui, theme) => ({
            render: (width: number) => paintWidget(frozen, theme, width),
            invalidate: () => {},
          }),
          { placement: "belowEditor" },
        );
      }
      ctx.ui.setStatus(STATUS_KEY, visible ? (footerText(checklist) ?? undefined) : undefined);
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
      state = loadFromBranch(branch as Parameters<typeof loadFromBranch>[0]);
    } catch {
      state = { v: 1, checklist: null };
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
      const mutation = executeCreate(state.checklist, state.widgetVisible, params);
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
      const mutation = executeUpdate(state.checklist, state.widgetVisible, params);
      commit(mutation.snapshot, ctx);
      return { content: [{ type: "text", text: mutation.text }], details: mutation.snapshot };
    },
    renderCall: (args, theme) => renderUpdateCall(args as { updates?: Array<{ id?: string }> }, theme),
    renderResult: (result, { expanded }, theme) => renderChecklistResult(result, expanded, theme),
  });

  // -- /checklist command ----------------------------------------------------

  registerChecklistCommand(pi, {
    getSnapshot,
    setWidgetVisible: (visible: boolean, ctx: ExtensionContext) => {
      state = { ...state, widgetVisible: visible };
      persistSnapshot(state);
      refreshUi(ctx);
    },
    clear: (ctx: ExtensionContext) => {
      state = { v: 1, checklist: null, widgetVisible: state.widgetVisible };
      persistSnapshot(state);
      refreshUi(ctx);
    },
  });

  // -- session + turn lifecycle ----------------------------------------------

  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
  pi.on("turn_end", async (_event, ctx) => refreshUi(ctx));
  pi.on("agent_settled", async (_event, ctx) => refreshUi(ctx));

  pi.on("before_agent_start", async (event, ctx) => {
    void ctx;
    const checklist = state.checklist;
    if (!checklist || checklist.tasks.length === 0) return;
    const open = checklist.tasks.some((t) => t.status === "planned" || t.status === "ongoing");
    if (!open) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${buildInjectSnippet(checklist)}` };
  });
}
