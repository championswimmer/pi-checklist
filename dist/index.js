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
    const seeded = preferencesForSettings(loadEffectiveSettingsSync());
    let state = {
        v: 1,
        checklist: null,
        widgetVisible: seeded.displayMode !== "hidden",
        ...seeded,
    };
    let usageGuidanceAtLoad = resolveUsage(state);
    let legacyPreferences;
    const getSettingsStore = (ctx) => createChecklistSettingsStore({ cwd: ctx.cwd }, legacyPreferences);
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
            ctx.ui.setStatus(STATUS_KEY, mode === "widget-only" ? undefined : footerText(checklist, getRenderOpts(), ctx.ui.theme));
            if (mode === "status-minimal") {
                ctx.ui.setWidget(WIDGET_KEY, undefined);
                return;
            }
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
        }
    }
    function persistSnapshot(snapshot) {
        try {
            pi.appendEntry(CUSTOM_TYPE, snapshot);
        }
        catch {
        }
    }
    function commit(snapshot, ctx) {
        state = snapshot;
        persistSnapshot(snapshot);
        refreshUi(ctx);
    }
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
            settings = loadEffectiveSettingsSync();
        }
        if (isSessionStart)
            usageGuidanceAtLoad = settings.usage;
        state = branchState;
        applySettingsToState(preferencesForSettings(settings), ctx, false);
    }
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
    registerChecklistCommand(pi, {
        addTask: (draft, ctx) => {
            const result = addTask(state.checklist, draft, Date.now(), {
                subtasksEnabled: getSubtasksEnabled(),
                metaEnabled: getMetaEnabled(),
            });
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
        const hint = (usageGuidanceAtLoad === "aggressive"
            ? "Checklist expected: use checklist_create/read/update for almost every task, even small ones, and mark progress as you go. Only skip it for trivial single-step questions."
            : "Checklist available: for long-running or multi-step work (refactors, audits, multi-part features), track it with checklist_create/read/update and mark progress as you go. Skip it for quick one-shot questions.") +
            (getSubtasksEnabled()
                ? ` Tasks can have up to ${MAX_SUBTASKS_PER_TASK} subtasks each: use them to break larger tasks down.`
                : " Tasks have no subtasks.") +
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
