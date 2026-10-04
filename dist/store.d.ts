/**
 * Pure checklist store: state machine, FNV-1a 3-char id allocation,
 * cycle detection, ready/blockedBy views, replace/append, reconstruct.
 *
 * No pi / TUI imports — testable with plain node.
 */
import { type Checklist, type ChecklistSnapshot, type CreateInput, type DisplayMode, type Subtask, type SubtaskView, type Task, type TaskStatus, type IconSet, type StatusStyle, type TaskView, type UpdateTaskInput, type UsageMode } from "./types.js";
export declare const ID_PATTERN: RegExp;
export declare const TASK_STATUSES: readonly TaskStatus[];
/** Session checklists stay deliberately small and scannable. */
export declare const MAX_CHECKLIST_TASKS = 10;
/** Preview-gated subtasks stay even smaller: a fixed cap per parent task,
 * not user-changeable (like MAX_CHECKLIST_TASKS). */
export declare const MAX_SUBTASKS_PER_TASK = 3;
/** Error thrown when a subtask payload arrives while the preview is off. */
export declare function subtasksPreviewError(): Error;
export declare function normalizeTitleKey(title: string): string;
export declare function allocId(title: string, used: Set<string>): string;
/** Validate a caller-supplied id; returns the lowercased id. Throws on invalid. */
export declare function normalizeId(raw: unknown): string;
/** Coerce dependsOn (string | string[] | undefined) to a lowercased string[]. */
export declare function coerceDependsOn(raw: unknown): string[];
export declare function canTransition(from: TaskStatus, to: TaskStatus): boolean;
export declare function assertTransition(from: TaskStatus, to: TaskStatus, id: string): void;
/** Resolve the effective display mode, migrating legacy widgetVisible. */
export declare function resolveDisplayMode(snapshot: ChecklistSnapshot): DisplayMode;
/** Resolve the effective status style. Default "pill" preserves the
 * long-standing status-word look (now rendered on a colored background). */
export declare function resolveStatusStyle(snapshot: ChecklistSnapshot): StatusStyle;
/** Resolve the effective icon set. Default "nerd-font" (Nerd Font glyphs). */
export declare function resolveIconSet(snapshot: ChecklistSnapshot): IconSet;
/** Resolve the effective usage-guidance mode. Default "moderate". */
export declare function resolveUsage(snapshot: ChecklistSnapshot): UsageMode;
/** Resolve whether the subtasks preview is enabled. Default `false`.
 * Precedence is handled by the caller (global prefs file > snapshot). */
export declare function resolveSubtasksEnabled(snapshot: ChecklistSnapshot): boolean;
export declare function toView(task: Task, byId: Map<string, Task>): TaskView;
/** Effective subtask view: `blockedBy` is sibling deps not done PLUS the
 * parent's own `blockedBy` when the parent is blocked (primitive S3 —
 * subtasks inherit the parent's blocked state). */
export declare function toSubtaskView(sub: Subtask, sibById: Map<string, Subtask>, parentBlockedBy: string[]): SubtaskView;
export declare function viewsOf(checklist: Checklist): TaskView[];
/** Sort order: ongoing, ready planned, blocked planned, done, cancelled. */
export declare function sortViews(views: TaskView[]): TaskView[];
/** True if the dep graph (id → dependsOn) contains a cycle. */
export declare function hasCycle(graph: Map<string, string[]>): boolean;
export interface CreateResult {
    checklist: Checklist;
    /** Assigned ids in input order, for the LLM to copy. */
    assigned: Array<{
        id: string;
        title: string;
    }>;
}
export declare function createOrAppend(current: Checklist | null, input: CreateInput, now?: number, opts?: {
    subtasksEnabled?: boolean;
}): CreateResult;
export interface UpdateResult {
    checklist: Checklist;
    changes: string[];
}
export declare function applyUpdates(current: Checklist | null, updates: UpdateTaskInput[], now?: number, opts?: {
    subtasksEnabled?: boolean;
}): UpdateResult;
interface BranchLike {
    type?: unknown;
    customType?: unknown;
    data?: unknown;
    message?: {
        role?: unknown;
        toolName?: unknown;
        details?: unknown;
    };
}
export declare function loadFromBranch(branch: BranchLike[]): ChecklistSnapshot;
export declare function countsOf(checklist: Checklist): {
    done: number;
    total: number;
    ongoing: number;
    ready: number;
    blocked: number;
};
export declare function formatTaskLine(v: TaskView): string;
/** Compact snippet re-injected on before_agent_start so compaction can't hide the list. */
export declare function buildInjectSnippet(checklist: Checklist): string;
export {};
