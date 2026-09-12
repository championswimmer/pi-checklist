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
 * Usage guidance (moderate | aggressive) also persists there, but it is
 * baked into the injected system prompt, so it is captured once at
 * extension load — change it and run /reload (or start a new session)
 * for it to take effect.
 *
 * Display modes (see /checklist settings):
 * - "statusbar": persistent widget below the input box + footer (default).
 * - "end-of-turn": widget above the input box, shown when a turn settles.
 * - "hidden": no widget or footer; /checklist overlay still works.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerChecklistCommand } from "./commands.js";
import { loadGlobalPrefs, saveGlobalPrefs } from "./prefs.js";
import {
  footerText,
  paintWidget,
  renderChecklistResult,
  renderCreateCall,
  renderReadCall,
  renderUpdateCall,
} from "./render.js";
import { buildInjectSnippet, loadFromBranch, resolveDisplayMode, resolveIconSet, resolveStatusStyle, resolveUsage } from "./store.js";
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
import type { ChecklistSnapshot, DisplayMode, IconSet, StatusStyle, UsageMode } from "./types.js";
import type { RenderOpts } from "./render.js";

const WIDGET_KEY = "checklist";
const STATUS_KEY = "checklist";
const CUSTOM_TYPE = "pi-checklist";

export default function (pi: ExtensionAPI) {
  // In-memory cache; the session JSONL branch is the source of truth for
  // tasks, the global prefs file (`<agentDir>/pi-checklist.json`) is the
  // source of truth for display settings (seeded here so even
  // session-less/print use honors them).
  const globalSeed = loadGlobalPrefs();
  let state: ChecklistSnapshot = {
    v: 1,
    checklist: null,
    widgetVisible: (globalSeed.displayMode ?? "statusbar") !== "hidden",
    displayMode: globalSeed.displayMode ?? "statusbar",
    statusStyle: globalSeed.statusStyle ?? "pill",
    iconSet: globalSeed.iconSet ?? "nerd-font",
    usage: globalSeed.usage ?? "moderate",
  };
  // The usage-guidance hint is baked into the system prompt, so it is
  // captured ONCE here at extension load. setUsage below still persists the
  // new value (snapshot + global prefs), but the injected hint keeps using
  // this capture until the extension is reloaded (/reload / new session).
  const usageGuidanceAtLoad: UsageMode = resolveUsage(state);
  // True between turn_start and turn_end/agent_settled. In "end-of-turn"
  // mode the widget stays hidden mid-turn and appears when the turn settles.
  let inTurn = false;

  const getDisplayMode = (): DisplayMode => resolveDisplayMode(state);
  const getStatusStyle = (): StatusStyle => resolveStatusStyle(state);
  const getIconSet = (): IconSet => resolveIconSet(state);
  const getUsage = (): UsageMode => resolveUsage(state);
  const getRenderOpts = (): RenderOpts => ({ style: getStatusStyle(), iconSet: getIconSet() });

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
      const frozenOpts = getRenderOpts();
      const placement = mode === "end-of-turn" ? undefined : { placement: "belowEditor" as const };
      ctx.ui.setWidget(
        WIDGET_KEY,
        (_tui, theme) => ({
          render: (width: number) => paintWidget(frozen, theme, width, frozenOpts),
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

  /** Write the current display prefs to the global file (best-effort). */
  function savePrefs(): void {
    saveGlobalPrefs({
      displayMode: getDisplayMode(),
      statusStyle: getStatusStyle(),
      iconSet: getIconSet(),
      usage: getUsage(),
    });
  }

  function reconstruct(ctx: ExtensionContext): void {
    try {
      const branch = ctx.sessionManager.getBranch();
      const loaded = loadFromBranch(branch as Parameters<typeof loadFromBranch>[0]);
      // Tasks come from the branch; prefs prefer the global file (so a
      // setting changed in another session isn't clobbered by resuming an
      // older session), falling back to the snapshot for back-compat.
      const global = loadGlobalPrefs();
      // Normalize: carry the resolved prefs explicitly so future snapshots
      // (and legacy entries without them) stay consistent.
      state = {
        ...loaded,
        displayMode: global.displayMode ?? resolveDisplayMode(loaded),
        statusStyle: global.statusStyle ?? resolveStatusStyle(loaded),
        iconSet: global.iconSet ?? resolveIconSet(loaded),
        usage: global.usage ?? resolveUsage(loaded),
      };
    } catch {
      const global = loadGlobalPrefs();
      state = {
        v: 1,
        checklist: null,
        displayMode: global.displayMode ?? "statusbar",
        statusStyle: global.statusStyle ?? "pill",
        iconSet: global.iconSet ?? "nerd-font",
        usage: global.usage ?? "moderate",
      };
    }
    refreshUi(ctx);
  }

  // -- tools ---------------------------------------------------------------

  pi.registerTool({
    name: "checklist_create",
    label: "Checklist Create",
    description: "Create or extend the session task checklist (replace by default, or append). Returns 3-char task ids. Send an empty tasks array to clear the checklist for the next set of tasks.",
    promptSnippet: CREATE_SNIPPET,
    promptGuidelines: CREATE_GUIDELINES,
    parameters: ChecklistCreateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mutation = executeCreate(
        state.checklist,
        state.widgetVisible,
        params,
        getDisplayMode(),
        getStatusStyle(),
        getIconSet(),
      );
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
      const mutation = executeRead(state.checklist, params, getStatusStyle(), getIconSet());
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
      const mutation = executeUpdate(
        state.checklist,
        state.widgetVisible,
        params,
        getDisplayMode(),
        getStatusStyle(),
        getIconSet(),
      );
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
      savePrefs();
      refreshUi(ctx);
    },
    getStatusStyle,
    setStatusStyle: (style: StatusStyle, ctx: ExtensionContext) => {
      state = { ...state, statusStyle: style };
      persistSnapshot(state);
      savePrefs();
      refreshUi(ctx);
    },
    getIconSet,
    setIconSet: (iconSet: IconSet, ctx: ExtensionContext) => {
      state = { ...state, iconSet };
      persistSnapshot(state);
      savePrefs();
      refreshUi(ctx);
    },
    getUsage,
    setUsage: (usage: UsageMode, ctx: ExtensionContext) => {
      // Persisted now (snapshot + global prefs), but the injected system
      // prompt keeps the load-time capture until the extension reloads.
      state = { ...state, usage };
      persistSnapshot(state);
      savePrefs();
      refreshUi(ctx);
    },
    getRenderOpts,
    clear: (ctx: ExtensionContext) => {
      state = {
        v: 1,
        checklist: null,
        widgetVisible: state.widgetVisible,
        displayMode: getDisplayMode(),
        statusStyle: getStatusStyle(),
        iconSet: getIconSet(),
        usage: getUsage(),
      };
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
    // The hint uses usageGuidanceAtLoad (captured when the extension
    // loaded), never getUsage(): changing /checklist settings mid-session
    // must not silently rewrite the system prompt — it applies on reload.
    const hint =
      usageGuidanceAtLoad === "aggressive"
        ? "Checklist expected: use checklist_create/read/update for almost every task, even small ones, and mark progress as you go. Only skip it for trivial single-step questions."
        : "Checklist available: for long-running or multi-step work (refactors, audits, multi-part features), track it with checklist_create/read/update and mark progress as you go. Skip it for quick one-shot questions.";
    const checklist = state.checklist;
    const open =
      !!checklist &&
      checklist.tasks.length > 0 &&
      checklist.tasks.some((t) => t.status === "planned" || t.status === "ongoing");
    const extra = open ? ` ${buildInjectSnippet(checklist!)}` : "";
    return { systemPrompt: `${event.systemPrompt}\n\n${hint}${extra}` };
  });
}
