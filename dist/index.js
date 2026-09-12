import { registerChecklistCommand } from "./commands.js";
import { loadGlobalPrefs, saveGlobalPrefs } from "./prefs.js";
import { footerText, paintWidget, renderChecklistResult, renderCreateCall, renderReadCall, renderUpdateCall, } from "./render.js";
import { buildInjectSnippet, loadFromBranch, resolveDisplayMode, resolveIconSet, resolveStatusStyle } from "./store.js";
import { CREATE_GUIDELINES, CREATE_SNIPPET, ChecklistCreateParams, ChecklistReadParams, ChecklistUpdateParams, READ_GUIDELINES, READ_SNIPPET, UPDATE_GUIDELINES, UPDATE_SNIPPET, executeCreate, executeRead, executeUpdate, } from "./tools.js";
const WIDGET_KEY = "checklist";
const STATUS_KEY = "checklist";
const CUSTOM_TYPE = "pi-checklist";
export default function (pi) {
    // In-memory cache; the session JSONL branch is the source of truth for
    // tasks, the global prefs file (`<agentDir>/pi-checklist.json`) is the
    // source of truth for display settings (seeded here so even
    // session-less/print use honors them).
    const globalSeed = loadGlobalPrefs();
    let state = {
        v: 1,
        checklist: null,
        widgetVisible: (globalSeed.displayMode ?? "statusbar") !== "hidden",
        displayMode: globalSeed.displayMode ?? "statusbar",
        statusStyle: globalSeed.statusStyle ?? "pill",
        iconSet: globalSeed.iconSet ?? "nerd-font",
    };
    // True between turn_start and turn_end/agent_settled. In "end-of-turn"
    // mode the widget stays hidden mid-turn and appears when the turn settles.
    let inTurn = false;
    const getDisplayMode = () => resolveDisplayMode(state);
    const getStatusStyle = () => resolveStatusStyle(state);
    const getIconSet = () => resolveIconSet(state);
    const getRenderOpts = () => ({ style: getStatusStyle(), iconSet: getIconSet() });
    function refreshUi(ctx) {
        if (!ctx.hasUI)
            return;
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
            const placement = mode === "end-of-turn" ? undefined : { placement: "belowEditor" };
            ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
                render: (width) => paintWidget(frozen, theme, width, frozenOpts),
                invalidate: () => { },
            }), placement);
        }
        catch {
            // UI refresh must never break a turn. Footer-only fallback: already
            // cleared/failed above; nothing more to do.
        }
    }
    /** Persist the snapshot to the session JSONL (belt-and-braces alongside tool details). */
    function persistSnapshot(snapshot) {
        try {
            pi.appendEntry(CUSTOM_TYPE, snapshot);
        }
        catch {
            // Ephemeral/print sessions have no session file — in-memory still works.
        }
    }
    function commit(snapshot, ctx) {
        state = snapshot;
        persistSnapshot(snapshot);
        refreshUi(ctx);
    }
    /** Write the current display prefs to the global file (best-effort). */
    function savePrefs() {
        saveGlobalPrefs({ displayMode: getDisplayMode(), statusStyle: getStatusStyle(), iconSet: getIconSet() });
    }
    function reconstruct(ctx) {
        try {
            const branch = ctx.sessionManager.getBranch();
            const loaded = loadFromBranch(branch);
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
            };
        }
        catch {
            const global = loadGlobalPrefs();
            state = {
                v: 1,
                checklist: null,
                displayMode: global.displayMode ?? "statusbar",
                statusStyle: global.statusStyle ?? "pill",
                iconSet: global.iconSet ?? "nerd-font",
            };
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
            const mutation = executeCreate(state.checklist, state.widgetVisible, params, getDisplayMode(), getStatusStyle(), getIconSet());
            commit(mutation.snapshot, ctx);
            return { content: [{ type: "text", text: mutation.text }], details: mutation.snapshot };
        },
        renderCall: (args, theme) => renderCreateCall(args, theme),
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
            const mutation = executeUpdate(state.checklist, state.widgetVisible, params, getDisplayMode(), getStatusStyle(), getIconSet());
            commit(mutation.snapshot, ctx);
            return { content: [{ type: "text", text: mutation.text }], details: mutation.snapshot };
        },
        renderCall: (args, theme) => renderUpdateCall(args, theme),
        renderResult: (result, { expanded }, theme) => renderChecklistResult(result, expanded, theme),
    });
    // -- /checklist command ----------------------------------------------------
    registerChecklistCommand(pi, {
        getDisplayMode,
        setDisplayMode: (mode, ctx) => {
            state = { ...state, displayMode: mode, widgetVisible: mode !== "hidden" };
            persistSnapshot(state);
            savePrefs();
            refreshUi(ctx);
        },
        getStatusStyle,
        setStatusStyle: (style, ctx) => {
            state = { ...state, statusStyle: style };
            persistSnapshot(state);
            savePrefs();
            refreshUi(ctx);
        },
        getIconSet,
        setIconSet: (iconSet, ctx) => {
            state = { ...state, iconSet };
            persistSnapshot(state);
            savePrefs();
            refreshUi(ctx);
        },
        getRenderOpts,
        clear: (ctx) => {
            state = {
                v: 1,
                checklist: null,
                widgetVisible: state.widgetVisible,
                displayMode: getDisplayMode(),
                statusStyle: getStatusStyle(),
                iconSet: getIconSet(),
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
        // Minimal always-on hint so the agent knows the extension exists.
        // Kept to one sentence; tool promptGuidelines carry the details.
        const hint = "Checklist available: for any task that breaks into subtasks, track it with checklist_create/read/update and mark progress as you go.";
        const checklist = state.checklist;
        const open = !!checklist &&
            checklist.tasks.length > 0 &&
            checklist.tasks.some((t) => t.status === "planned" || t.status === "ongoing");
        const extra = open ? ` ${buildInjectSnippet(checklist)}` : "";
        return { systemPrompt: `${event.systemPrompt}\n\n${hint}${extra}` };
    });
}
