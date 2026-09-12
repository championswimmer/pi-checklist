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

export const DISPLAY_MODES: readonly DisplayMode[] = ["statusbar", "end-of-turn", "hidden"];

export function isDisplayMode(value: unknown): value is DisplayMode {
  return value === "statusbar" || value === "end-of-turn" || value === "hidden";
}

/** How per-task progress status is shown in the widget / overlay / transcript.
 *
 * - "color": rows are only color-coded, no status word.
 * - "pill": the status word is rendered as a pill — text on a colored
 *   background (theme.bg), e.g. ` ongoing `.
 * - "icon": status is conveyed by a leading progress icon only, no status
 *   word. The icon artwork comes from `IconSet`.
 */
export type StatusStyle = "color" | "pill" | "icon";

export const STATUS_STYLES: readonly StatusStyle[] = ["color", "pill", "icon"];

export function isStatusStyle(value: unknown): value is StatusStyle {
  return value === "color" || value === "pill" || value === "icon";
}

/** Which icon artwork the "icon" status style uses.
 *
 * - "nerd-font": Nerd Font glyphs (Octicons block, single-cell; needs a
 *   Nerd Font patched font in the terminal — see nerdfonts.com).
 * - "emoji": emoji glyphs (double-width, work in any modern terminal).
 */
export type IconSet = "nerd-font" | "emoji";

export const ICON_SETS: readonly IconSet[] = ["nerd-font", "emoji"];

export function isIconSet(value: unknown): value is IconSet {
  return value === "nerd-font" || value === "emoji";
}

/** Versioned snapshot persisted in the session JSONL. */
export interface ChecklistSnapshot {
  v: 1;
  /** null = cleared */
  checklist: Checklist | null;
  /** Legacy persist for /checklist hide (pre-displayMode). Prefer displayMode. */
  widgetVisible?: boolean;
  /** Preferred persist for render mode. Absent = migrate from widgetVisible. */
  displayMode?: DisplayMode;
  /** Preferred persist for status style. Absent = default ("pill"). */
  statusStyle?: StatusStyle;
  /** Preferred persist for icon set. Absent = default ("nerd-font"). */
  iconSet?: IconSet;
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
