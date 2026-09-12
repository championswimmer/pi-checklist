/**
 * Pure checklist store: state machine, FNV-1a 3-char id allocation,
 * cycle detection, ready/blockedBy views, replace/append, reconstruct.
 *
 * No pi / TUI imports — testable with plain node.
 */
import { type Checklist, type ChecklistSnapshot, type CreateInput, type DisplayMode, type Task, type TaskStatus, type TaskView, type UpdateTaskInput } from "./types.js";
export declare const ID_PATTERN: RegExp;
export declare const TASK_STATUSES: readonly TaskStatus[];
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
export declare function toView(task: Task, byId: Map<string, Task>): TaskView;
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
export declare function createOrAppend(current: Checklist | null, input: CreateInput, now?: number): CreateResult;
export interface UpdateResult {
    checklist: Checklist;
    changes: string[];
}
export declare function applyUpdates(current: Checklist | null, updates: UpdateTaskInput[], now?: number): UpdateResult;
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
