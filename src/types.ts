/** Shared types for pi-checklist. Pure — no pi imports. */

export type TaskStatus = "planned" | "ongoing" | "done" | "cancelled";

export interface Task {
  /** Exactly 3 chars, [a-z0-9], assigned at create, frozen. */
  id: string;
  /** Short required title. */
  title: string;
  /** Optional extra context for the agent. */
  notes?: string;
  status: TaskStatus;
  /** 3-char task ids that must be `done` before this may become `ongoing`. */
  dependsOn: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Checklist {
  /** Optional session/goal name, shown in the widget header. */
  title?: string;
  tasks: Task[];
  updatedAt: number;
}

/** Versioned snapshot persisted in the session JSONL. */
export interface ChecklistSnapshot {
  v: 1;
  /** null = cleared */
  checklist: Checklist | null;
  /** Persist /checklist hide across resume. */
  widgetVisible?: boolean;
}

/** Tool names that can carry a ChecklistSnapshot in result details. */
export const CHECKLIST_TOOLS: ReadonlySet<string> = new Set([
  "checklist_create",
  "checklist_read",
  "checklist_update",
]);

export function isChecklistSnapshot(value: unknown): value is ChecklistSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && ("checklist" in v);
}

/** Computed per-task view (never stored). */
export interface TaskView extends Task {
  /** status === "planned" and every dep is done */
  ready: boolean;
  /** dep ids that are not done (missing deps are validated away, but listed defensively) */
  blockedBy: string[];
  /** blockedBy.length > 0 */
  blocked: boolean;
}

export interface CreateTaskInput {
  id?: string;
  title: string;
  notes?: string;
  dependsOn?: string | string[];
}

export interface CreateInput {
  title?: string;
  mode?: "replace" | "append";
  tasks: CreateTaskInput[];
}

export interface UpdateTaskInput {
  id: string;
  status?: TaskStatus;
  title?: string;
  notes?: string;
  dependsOn?: string | string[];
}

export interface ReadInput {
  status?: TaskStatus;
  includeDone?: boolean;
}
