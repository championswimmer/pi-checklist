/** Tool schemas, guidelines, and execute logic for pi-checklist. */
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";
import { applyUpdates, countsOf, createOrAppend, formatTaskLine, sortViews, viewsOf } from "./store.js";
import type {
  Checklist,
  ChecklistSnapshot,
  CreateInput,
  DisplayMode,
  IconSet,
  ReadInput,
  StatusStyle,
  TaskStatus,
  UpdateTaskInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Schemas (dependsOn coerced at the boundary: string | string[])
// ---------------------------------------------------------------------------

const DependsOn = Type.Optional(
  Type.Union([Type.String(), Type.Array(Type.String())], {
    description: "3-char task ids that must be done first (single id or array)",
  }),
);

export const ChecklistCreateParams: TSchema = Type.Object({
  title: Type.Optional(Type.String({ description: "Optional session/goal name shown in the widget header" })),
  mode: Type.Optional(
    StringEnum(["replace", "append"] as const, { description: 'replace (default) wipes the list; append adds to it' }),
  ),
  tasks: Type.Array(
    Type.Object({
      id: Type.Optional(Type.String({ description: 'Optional explicit 3-char id (e.g. "k7q") for same-batch DAGs' })),
      title: Type.String({ description: "Short task title (required)" }),
      notes: Type.Optional(Type.String({ description: "Optional extra context" })),
      dependsOn: DependsOn,
    }),
    { description: "Tasks to install (replace) or add (append). An empty array with mode replace clears the checklist, ready for the next set of tasks." },
  ),
});

export const ChecklistReadParams: TSchema = Type.Object({
  status: Type.Optional(
    StringEnum(["planned", "ongoing", "done", "cancelled"] as const, {
      description: "Optional status filter",
    }),
  ),
  includeDone: Type.Optional(Type.Boolean({ description: "Include done tasks (default true)" })),
});

export const ChecklistUpdateParams: TSchema = Type.Object({
  updates: Type.Array(
    Type.Object({
      id: Type.String({ description: '3-char task id from checklist_create/read (e.g. "k7q")' }),
      status: Type.Optional(
        StringEnum(["planned", "ongoing", "done", "cancelled"] as const, {
          description: "Move through planned → ongoing → done/cancelled (done is terminal)",
        }),
      ),
      title: Type.Optional(Type.String({ description: "Retitle a non-done task (id is frozen)" })),
      notes: Type.Optional(Type.String({ description: "Update notes on a non-done task" })),
      dependsOn: DependsOn,
    }),
    { description: "All-or-nothing batch of updates" },
  ),
});

// ---------------------------------------------------------------------------
// Prompt metadata (guidelines must name the tool — never "this tool")
// ---------------------------------------------------------------------------

export const CREATE_SNIPPET = "Create or replace the session task checklist.";
export const CREATE_GUIDELINES = [
  "Use checklist_create at the start of multi-step work; use mode replace when the plan changes substantially and mode append when new work appears mid-session.",
  "checklist_create task ids are exactly 3 lowercase alphanumeric chars: omit id unless you need a same-batch DAG, then pass explicit 3-char ids. Always copy the returned ids; never invent them.",
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
];

// ---------------------------------------------------------------------------
// Execute helpers — pure over (checklist | null), return LLM text + snapshot
// ---------------------------------------------------------------------------

export interface Mutation {
  text: string;
  snapshot: ChecklistSnapshot;
  /** True when the checklist changed and the caller should appendEntry + refresh UI. */
  changed: boolean;
}

function snapshotOf(
  checklist: Checklist | null,
  widgetVisible?: boolean,
  displayMode?: DisplayMode,
  statusStyle?: StatusStyle,
  iconSet?: IconSet,
): ChecklistSnapshot {
  const snap: ChecklistSnapshot = { v: 1, checklist };
  if (widgetVisible !== undefined) snap.widgetVisible = widgetVisible;
  if (displayMode !== undefined) snap.displayMode = displayMode;
  if (statusStyle !== undefined) snap.statusStyle = statusStyle;
  if (iconSet !== undefined) snap.iconSet = iconSet;
  return snap;
}

export function executeCreate(
  current: Checklist | null,
  widgetVisible: boolean | undefined,
  raw: unknown,
  displayMode?: DisplayMode,
  statusStyle?: StatusStyle,
  iconSet?: IconSet,
): Mutation {
  const input = raw as CreateInput;
  const { checklist, assigned } = createOrAppend(current, {
    title: input.title,
    mode: input.mode,
    tasks: (input.tasks ?? []) as CreateInput["tasks"],
  });
  const c = countsOf(checklist);
  const lines = assigned.map((a) => `  ${a.id} "${a.title}"`);
  const text =
    assigned.length === 0
      ? `checklist cleared (0/${c.total} done)`
      : `checklist: ${assigned.length} task(s) installed (${c.done}/${c.total} done)\n${lines.join("\n")}`;
  return { text, snapshot: snapshotOf(checklist, widgetVisible, displayMode, statusStyle, iconSet), changed: true };
}

export function executeRead(
  current: Checklist | null,
  raw: unknown,
  statusStyle?: StatusStyle,
  iconSet?: IconSet,
): Mutation {
  const input = (raw ?? {}) as ReadInput;
  if (!current || current.tasks.length === 0) {
    return { text: "checklist is empty: use checklist_create first", snapshot: snapshotOf(current, undefined, undefined, statusStyle, iconSet), changed: false };
  }
  const status = input.status as TaskStatus | undefined;
  const includeDone = input.includeDone ?? true;
  let views = sortViews(viewsOf(current));
  if (status) views = views.filter((v) => v.status === status);
  else if (!includeDone) views = views.filter((v) => v.status !== "done");
  const c = countsOf(current);
  const header = `checklist${current.title ? ` "${current.title}"` : ""} (${c.done}/${c.total} done, ${c.ongoing} ongoing, ${c.ready} ready, ${c.blocked} blocked)`;
  const body = views.length > 0 ? `\n${views.map(formatTaskLine).join("\n")}` : "\n(no tasks match)";
  return { text: header + body, snapshot: snapshotOf(current, undefined, undefined, statusStyle, iconSet), changed: false };
}

export function executeUpdate(
  current: Checklist | null,
  widgetVisible: boolean | undefined,
  raw: unknown,
  displayMode?: DisplayMode,
  statusStyle?: StatusStyle,
  iconSet?: IconSet,
): Mutation {
  const input = raw as { updates: UpdateTaskInput[] };
  const { checklist, changes } = applyUpdates(current, input.updates ?? []);
  const c = countsOf(checklist);
  const text = `checklist (${c.done}/${c.total} done):\n${changes.map((l) => `  ${l}`).join("\n")}`;
  return { text, snapshot: snapshotOf(checklist, widgetVisible, displayMode, statusStyle, iconSet), changed: true };
}
