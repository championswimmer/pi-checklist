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
/** How the checklist renders in the TUI.
 *
 * - "statusbar": persistent widget below the input box + footer counter (current behavior).
 * - "end-of-turn": widget above the input box, shown when a turn settles
 *   (cleared when a turn starts, re-shown on turn_end / agent_settled).
 * - "hidden": no widget or footer; use /checklist (overlay) or
 *   /checklist show (back to statusbar) to see it.
 */
export type DisplayMode = "statusbar" | "end-of-turn" | "hidden";
export declare const DISPLAY_MODES: readonly DisplayMode[];
export declare function isDisplayMode(value: unknown): value is DisplayMode;
/** Versioned snapshot persisted in the session JSONL. */
export interface ChecklistSnapshot {
    v: 1;
    /** null = cleared */
    checklist: Checklist | null;
    /** Legacy persist for /checklist hide (pre-displayMode). Prefer displayMode. */
    widgetVisible?: boolean;
    /** Preferred persist for render mode. Absent = migrate from widgetVisible. */
    displayMode?: DisplayMode;
}
/** Tool names that can carry a ChecklistSnapshot in result details. */
export declare const CHECKLIST_TOOLS: ReadonlySet<string>;
export declare function isChecklistSnapshot(value: unknown): value is ChecklistSnapshot;
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
