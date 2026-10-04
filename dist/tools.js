/** Tool schemas, guidelines, and execute logic for pi-checklist. */
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { MAX_CHECKLIST_TASKS, MAX_SUBTASKS_PER_TASK, applyUpdates, countsOf, createOrAppend, formatTaskLine, sortViews, viewsOf } from "./store.js";
// ---------------------------------------------------------------------------
// Schemas (dependsOn coerced at the boundary: string | string[])
// ---------------------------------------------------------------------------
const DependsOn = Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], {
    description: "3-char task ids that must be done first (single id or array)",
}));
const SubtaskCreate = Type.Object({
    id: Type.Optional(Type.String({ description: 'Optional explicit 3-char id (e.g. "k7q") for same-batch DAGs' })),
    title: Type.String({ description: "Short subtask title (required)" }),
    notes: Type.Optional(Type.String({ description: "Optional extra context" })),
    dependsOn: DependsOn,
});
const SubtaskUpdate = Type.Object({
    id: Type.Optional(Type.String({ description: 'Subtask id: present = patch it, omitted = add a new subtask (title required)' })),
    title: Type.Optional(Type.String({ description: "Retitle a non-done subtask, or title for a new one" })),
    notes: Type.Optional(Type.String({ description: "Update notes on a non-done subtask" })),
    status: Type.Optional(StringEnum(["planned", "ongoing", "done", "cancelled"], {
        description: "Move a subtask through planned → ongoing → done/cancelled (omit when adding)",
    })),
    dependsOn: DependsOn,
});
export const ChecklistCreateParams = Type.Object({
    title: Type.Optional(Type.String({ description: "Optional session/goal name shown in the widget header" })),
    mode: Type.Optional(StringEnum(["replace", "append"], { description: 'replace (default) wipes the list; append adds to it' })),
    tasks: Type.Array(Type.Object({
        id: Type.Optional(Type.String({ description: 'Optional explicit 3-char id (e.g. "k7q") for same-batch DAGs' })),
        title: Type.String({ description: "Short task title (required)" }),
        notes: Type.Optional(Type.String({ description: "Optional extra context" })),
        dependsOn: DependsOn,
        subtasks: Type.Optional(Type.Array(SubtaskCreate, {
            description: `Preview (enable with /checklist settings subtasks): nested subtasks, at most ${MAX_SUBTASKS_PER_TASK} per task, depending only on siblings in the same parent`,
        })),
    }), { description: `Tasks to install (replace) or add (append). A checklist holds at most ${MAX_CHECKLIST_TASKS} tasks total at a time. An empty array with mode replace clears the checklist, ready for the next set of tasks.` }),
});
export const ChecklistReadParams = Type.Object({
    status: Type.Optional(StringEnum(["planned", "ongoing", "done", "cancelled"], {
        description: "Optional status filter",
    })),
    includeDone: Type.Optional(Type.Boolean({ description: "Include done tasks (default true)" })),
});
export const ChecklistUpdateParams = Type.Object({
    updates: Type.Array(Type.Object({
        id: Type.String({ description: '3-char task id from checklist_create/read (e.g. "k7q")' }),
        status: Type.Optional(StringEnum(["planned", "ongoing", "done", "cancelled"], {
            description: "Move through planned → ongoing → done/cancelled (done is terminal)",
        })),
        title: Type.Optional(Type.String({ description: "Retitle a non-done task (id is frozen)" })),
        notes: Type.Optional(Type.String({ description: "Update notes on a non-done task" })),
        dependsOn: DependsOn,
        subtasks: Type.Optional(Type.Array(SubtaskUpdate, {
            description: "Preview: patch subtasks (id present) or add new ones (id omitted, title required); finish parent + subtasks together in ONE entry",
        })),
    }), { description: "All-or-nothing batch of updates" }),
});
// ---------------------------------------------------------------------------
// Prompt metadata (guidelines must name the tool — never "this tool")
// ---------------------------------------------------------------------------
export const CREATE_SNIPPET = "Create or replace the session task checklist.";
export const CREATE_GUIDELINES = [
    "Use checklist_create at the start of multi-step work; use mode replace when the plan changes substantially and mode append when new work appears mid-session.",
    "checklist_create task ids are exactly 3 lowercase alphanumeric chars: omit id unless you need a same-batch DAG, then pass explicit 3-char ids. Always copy the returned ids; never invent them.",
    `A checklist holds at most ${MAX_CHECKLIST_TASKS} tasks total at a time; keep it small, split overflow into a follow-up checklist.`,
    `Subtasks are a preview feature (only when enabled via /checklist settings): at most ${MAX_SUBTASKS_PER_TASK} per task, sibling-only dependsOn, born planned.`,
];
export const READ_SNIPPET = "Read the session task checklist.";
export const READ_GUIDELINES = [
    "Use checklist_read after compaction or whenever unsure of task ids, statuses, or what is blocked.",
];
export const UPDATE_SNIPPET = "Advance tasks through the session checklist.";
export const UPDATE_GUIDELINES = [
    "Use checklist_update to mark a task ongoing before starting work and done as soon as the work is actually done; cancel tasks the new plan made irrelevant.",
    "checklist_update cannot start a task whose blockedBy is non-empty: finish every dependsOn task first. Keep at most one ongoing task (or a tight parallel set).",
    "checklist_update transitions: planned → ongoing/done/cancelled, ongoing → done/cancelled/planned, cancelled → planned. done is terminal and frozen.",
    "Subtasks (preview, when enabled): a parent cannot finish with open subtasks; starting a subtask pulls a planned parent to ongoing; subtasks inherit the parent's block.",
];
function snapshotOf(checklist, widgetVisible, displayMode, statusStyle, iconSet, subtasksEnabled) {
    const snap = { v: 1, checklist };
    if (widgetVisible !== undefined)
        snap.widgetVisible = widgetVisible;
    if (displayMode !== undefined)
        snap.displayMode = displayMode;
    if (statusStyle !== undefined)
        snap.statusStyle = statusStyle;
    if (iconSet !== undefined)
        snap.iconSet = iconSet;
    if (subtasksEnabled !== undefined)
        snap.subtasksEnabled = subtasksEnabled;
    return snap;
}
export function executeCreate(current, widgetVisible, raw, displayMode, statusStyle, iconSet, subtasksEnabled) {
    const input = raw;
    const { checklist, assigned } = createOrAppend(current, {
        title: input.title,
        mode: input.mode,
        tasks: (input.tasks ?? []),
    }, Date.now(), { subtasksEnabled });
    const c = countsOf(checklist);
    const lines = assigned.map((a) => `  ${a.id} "${a.title}"`);
    const text = assigned.length === 0
        ? `checklist cleared (0/${c.total} done)`
        : `checklist: ${assigned.length} task(s) installed (${c.done}/${c.total} done)\n${lines.join("\n")}`;
    return { text, snapshot: snapshotOf(checklist, widgetVisible, displayMode, statusStyle, iconSet, subtasksEnabled), changed: true };
}
export function executeRead(current, raw, statusStyle, iconSet, subtasksEnabled) {
    const input = (raw ?? {});
    if (!current || current.tasks.length === 0) {
        return { text: "checklist is empty: use checklist_create first", snapshot: snapshotOf(current, undefined, undefined, statusStyle, iconSet, subtasksEnabled), changed: false };
    }
    const status = input.status;
    const includeDone = input.includeDone ?? true;
    let views = sortViews(viewsOf(current));
    if (status)
        views = views.filter((v) => v.status === status);
    else if (!includeDone)
        views = views.filter((v) => v.status !== "done");
    const c = countsOf(current);
    const header = `checklist${current.title ? ` "${current.title}"` : ""} (${c.done}/${c.total} done, ${c.ongoing} ongoing, ${c.ready} ready, ${c.blocked} blocked)`;
    const body = views.length > 0 ? `\n${views.map(formatTaskLine).join("\n")}` : "\n(no tasks match)";
    return { text: header + body, snapshot: snapshotOf(current, undefined, undefined, statusStyle, iconSet, subtasksEnabled), changed: false };
}
export function executeUpdate(current, widgetVisible, raw, displayMode, statusStyle, iconSet, subtasksEnabled) {
    const input = raw;
    const { checklist, changes } = applyUpdates(current, input.updates ?? [], Date.now(), { subtasksEnabled });
    const c = countsOf(checklist);
    const text = `checklist (${c.done}/${c.total} done):\n${changes.map((l) => `  ${l}`).join("\n")}`;
    return { text, snapshot: snapshotOf(checklist, widgetVisible, displayMode, statusStyle, iconSet, subtasksEnabled), changed: true };
}
