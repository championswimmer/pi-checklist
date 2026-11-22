import { ConcurrencyConflictError } from "pi-extension-settings-tui/store";
import { registerChecklistCommand } from "./commands.js";
import { footerText, paintWidget, renderChecklistResult, renderCreateCall, renderReadCall, renderUpdateCall, } from "./render.js";
import { createChecklistSettingsStore, isProjectTrusted, loadChecklistSettings, loadEffectiveSettingsSync, patchChecklistSettings, preferencesForSettings, settingsForPreferences, } from "./settings.js";
import { MAX_CHECKLIST_TASKS, MAX_SUBTASKS_PER_TASK, addTask, buildInjectSnippet, loadFromBranch, resolveDisplayMode, resolveIconSet, resolveMetaEnabled, resolveStatusStyle, resolveSubtasksEnabled, resolveUsage } from "./store.js";
import { CREATE_GUIDELINES, CREATE_SNIPPET, ChecklistCreateParams, ChecklistReadParams, ChecklistUpdateParams, READ_GUIDELINES, READ_SNIPPET, UPDATE_GUIDELINES, UPDATE_SNIPPET, executeCreate, executeRead, executeUpdate, } from "./tools.js";
const WIDGET_KEY = "checklist";
const STATUS_KEY = "checklist";
const CUSTOM_TYPE = "pi-checklist";
export default function (pi) {
    // In-memory cache; the session JSONL branch is the source of truth for
    // tasks, and `pi-extension-settings-tui` (`<agentDir>/pi-checklist.json` +
    // trusted `<cwd>/.pi/pi-checklist.json`) is the source of truth for settings
    // (seeded synchronously here so even session-less/print use honors globals).
    const seeded = preferencesForSettings(loadEffectiveSettingsSync());
    let state = {
        v: 1,
        checklist: null,
        widgetVisible: seeded.displayMode !== "hidden",
        ...seeded,
    };
    // The usage-guidance hint is baked into the system prompt, so it is
    // captured at load time (and refreshed on session_start to honor
    // trusted project overrides). Mid-session edits persist immediately, but the
    // injected hint keeps using this capture until `/reload` or a new session.
    let usageGuidanceAtLoad = resolveUsage(state);
    let legacyPreferences;
    const getSettingsStore = (ctx) => createChecklistSettingsStore({ cwd: ctx.cwd }, legacyPreferences);
    // True between turn_start and turn_end/agent_settled. In "end-of-turn"
    // mode the widget stays hidden mid-turn and appears when the turn settles.
    let inTurn = false;
    const getDisplayMode = () => resolveDisplayMode(state);
    const getStatusStyle = () => resolveStatusStyle(state);
    const getIconSet = () => resolveIconSet(state);
    const getUsage = () => resolveUsage(state);
    const getSubtasksEnabled = () => resolveSubtasksEnabled(state);
    const getMetaEnabled = () => resolveMetaEnabled(state);
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
                ctx.ui.setStatus(STATUS_KEY, mode === "hidden" ? undefined : footerText(checklist, getRenderOpts(), ctx.ui.theme));
                return;
            }
            // Footer stays live in all visible modes, including during turns.
            ctx.ui.setStatus(STATUS_KEY, mode === "widget-only" ? undefined : footerText(checklist, getRenderOpts(), ctx.ui.theme));
            if (mode === "status-minimal") {
                ctx.ui.setWidget(WIDGET_KEY, undefined);
                return;
            }
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
    /** Apply resolved settings to live state, session snapshot, and TUI. */
    function applySettingsToState(next, ctx, persistSession = true) {
        state = {
            ...state,
            widgetVisible: next.displayMode !== "hidden",
            ...next,
        };
        if (persistSession)
            persistSnapshot(state);
        refreshUi(ctx);
    }
    /** Patch one or more settings in-memory, session snapshot, UI, and settings store. */
    async function updateSettings(patch, ctx) {
        const store = getSettingsStore(ctx);
        const trustedProject = isProjectTrusted(ctx);
        try {
            const loaded = await patchChecklistSettings(store, patch, { trustedProject });
            applySettingsToState(preferencesForSettings(loaded.effective), ctx);
        }
        catch (err) {
            if (err instanceof ConcurrencyConflictError) {
                const latest = await store.load({ trustedProject });
                applySettingsToState(preferencesForSettings(latest.effective), ctx, false);
                throw err;
            }
            // Keep quick-set usable in ephemeral and read-only sessions.
            applySettingsToState({
                displayMode: getDisplayMode(),
                statusStyle: getStatusStyle(),
                iconSet: getIconSet(),
                usage: getUsage(),
                subtasksEnabled: getSubtasksEnabled(),
                metaEnabled: getMetaEnabled(),
                ...patch,
            }, ctx);
            if (ctx.hasUI)
                ctx.ui.notify("Checklist settings changed for this session. Could not save all changes.", "warning");
        }
    }
    async function reconstruct(ctx, isSessionStart = false) {
        let branchState = { v: 1, checklist: null };
        try {
            const branch = ctx.sessionManager.getBranch();
            branchState = loadFromBranch(branch);
        }
        catch {
            // Ephemeral contexts may have no branch.
        }
        legacyPreferences = {
            displayMode: resolveDisplayMode(branchState),
            statusStyle: resolveStatusStyle(branchState),
            iconSet: resolveIconSet(branchState),
            usage: resolveUsage(branchState),
            subtasksEnabled: resolveSubtasksEnabled(branchState),
            metaEnabled: resolveMetaEnabled(branchState),
        };
        let settings;
        try {
            // Migrate real files against real layers. The session fallback is not
            // written until the user explicitly saves global settings.
            const trustedProject = isProjectTrusted(ctx);
            const store = createChecklistSettingsStore({ cwd: ctx.cwd });
            const loaded = await loadChecklistSettings(store, trustedProject, isSessionStart);
            settings = loaded.snapshot.globalHash === null
                ? store.schema.resolveEffective({
                    global: settingsForPreferences(legacyPreferences),
                    project: loaded.layers.project,
                }, { includeProject: trustedProject })
                : loaded.effective;
            if (isSessionStart && ctx.hasUI) {
                for (const warning of loaded.warnings) {
                    ctx.ui.notify(`checklist settings: ${warning}`, "warning");
                }
            }
        }
        catch {
            // Global preferences are still available if project settings fail.
            settings = loadEffectiveSettingsSync();
        }
        if (isSessionStart)
            usageGuidanceAtLoad = settings.usage;
        state = branchState;
        applySettingsToState(preferencesForSettings(settings), ctx, false);
    }
    // -- tools ---------------------------------------------------------------
    pi.registerTool({
        name: "checklist_create",
        label: "Checklist Create",
        description: `Create or extend the session task checklist (replace by default, or append). Holds at most ${MAX_CHECKLIST_TASKS} tasks total at a time. Returns 3-char task ids. Send an empty tasks array to clear the checklist for the next set of tasks.`,
        promptSnippet: CREATE_SNIPPET,
        promptGuidelines: CREATE_GUIDELINES,
        parameters: ChecklistCreateParams,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const mutation = executeCreate(state.checklist, state.widgetVisible, params, getDisplayMode(), getStatusStyle(), getIconSet(), getSubtasksEnabled(), getMetaEnabled());
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
            const mutation = executeRead(state.checklist, params, getStatusStyle(), getIconSet(), getSubtasksEnabled(), getMetaEnabled());
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
            const mutation = executeUpdate(state.checklist, state.widgetVisible, params, getDisplayMode(), getStatusStyle(), getIconSet(), getSubtasksEnabled(), getMetaEnabled());
            commit(mutation.snapshot, ctx);
            return { content: [{ type: "text", text: mutation.text }], details: mutation.snapshot };
        },
        renderCall: (args, theme) => renderUpdateCall(args, theme),
        renderResult: (result, { expanded }, theme) => renderChecklistResult(result, expanded, theme),
    });
    // -- /checklist command ----------------------------------------------------
    registerChecklistCommand(pi, {
        // Manual add (/checklist add). Always validates against the live
        // checklist — the agent may have changed it while the dialog was open.
        addTask: (draft, ctx) => {
            const result = addTask(state.checklist, draft, Date.now(), {
                subtasksEnabled: getSubtasksEnabled(),
                metaEnabled: getMetaEnabled(),
            });
            // Same persistence as a tool mutation, minus the tool result: session
            // custom entry + widget/footer refresh. The injected per-turn snippet
            // tells the agent about the new task on its next turn.
            if (result.ok)
                commit({ ...state, checklist: result.checklist }, ctx);
            return result;
        },
        getDisplayMode,
        setDisplayMode: (mode, ctx) => updateSettings({ displayMode: mode }, ctx),
        getStatusStyle,
        setStatusStyle: (style, ctx) => updateSettings({ statusStyle: style }, ctx),
        getIconSet,
        setIconSet: (iconSet, ctx) => updateSettings({ iconSet }, ctx),
        getUsage,
        setUsage: (usage, ctx) => updateSettings({ usage }, ctx),
        getSubtasksEnabled,
        setSubtasksEnabled: (enabled, ctx) => updateSettings({ subtasksEnabled: enabled }, ctx),
        getMetaEnabled,
        setMetaEnabled: (enabled, ctx) => updateSettings({ metaEnabled: enabled }, ctx),
        applySettingsPatch: updateSettings,
        syncSettings: (next, ctx) => applySettingsToState(preferencesForSettings(next), ctx),
        getSettingsStore,
        getRenderOpts,
        clear: (ctx) => {
            state = {
                v: 1,
                checklist: null,
                widgetVisible: state.widgetVisible,
                displayMode: getDisplayMode(),
                statusStyle: getStatusStyle(),
                iconSet: getIconSet(),
                usage: getUsage(),
                subtasksEnabled: getSubtasksEnabled(),
                metaEnabled: getMetaEnabled(),
            };
            persistSnapshot(state);
            refreshUi(ctx);
        },
        getChecklist: () => state.checklist,
    });
    // -- session + turn lifecycle ----------------------------------------------
    pi.on("session_start", async (_event, ctx) => reconstruct(ctx, true));
    pi.on("session_tree", async (_event, ctx) => reconstruct(ctx, false));
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
        const hint = (usageGuidanceAtLoad === "aggressive"
            ? "Checklist expected: use checklist_create/read/update for almost every task, even small ones, and mark progress as you go. Only skip it for trivial single-step questions."
            : "Checklist available: for long-running or multi-step work (refactors, audits, multi-part features), track it with checklist_create/read/update and mark progress as you go. Skip it for quick one-shot questions.") +
            // Live subtasks state (re-evaluated every turn, unlike the usage hint
            // above): explicitly tell the model whether subtasks exist at all.
            (getSubtasksEnabled()
                ? ` Tasks can have up to ${MAX_SUBTASKS_PER_TASK} subtasks each: use them to break larger tasks down.`
                : " Tasks have no subtasks.") +
            // Live task-meta state (same per-turn re-evaluation): only mentioned
            // when enabled, so the default prompt stays unchanged.
            (getMetaEnabled()
                ? " Tasks and subtasks can carry a small meta object of key/value facts (string, number or boolean values): pass meta on checklist_create, merge new keys with meta on checklist_update (listed keys are set, others stay), and set a key to null to delete it."
                : "");
        const checklist = state.checklist;
        const open = !!checklist &&
            checklist.tasks.length > 0 &&
            checklist.tasks.some((t) => t.status === "planned" || t.status === "ongoing");
        const extra = open ? ` ${buildInjectSnippet(checklist)}` : "";
        return { systemPrompt: `${event.systemPrompt}\n\n${hint}${extra}` };
    });
}
