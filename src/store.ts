/**
 * Pure checklist store: state machine, FNV-1a 3-char id allocation,
 * cycle detection, ready/blockedBy views, replace/append, reconstruct.
 *
 * No pi / TUI imports — testable with plain node.
 */
import {
  CHECKLIST_TOOLS,
  type Checklist,
  type ChecklistSnapshot,
  type CreateInput,
  type DisplayMode,
  type Task,
  type TaskStatus,
  type IconSet,
  type StatusStyle,
  type TaskView,
  type UpdateTaskInput,
  type UsageMode,
  isChecklistSnapshot,
  isDisplayMode,
  isIconSet,
  isStatusStyle,
  isUsageMode,
} from "./types.js";

export const ID_PATTERN = /^[a-z0-9]{3}$/;
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"; // 36
const RESERVED_IDS: ReadonlySet<string> = new Set(["all"]);

export const TASK_STATUSES: readonly TaskStatus[] = ["planned", "ongoing", "done", "cancelled"];

// ---------------------------------------------------------------------------
// Id allocation (FNV-1a of normalized title, base36, salt on collision)
// ---------------------------------------------------------------------------

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function encode3(n: number): string {
  let x = n >>> 0;
  let out = "";
  for (let i = 0; i < 3; i++) {
    out = ALPHABET[x % 36] + out;
    x = Math.floor(x / 36);
  }
  return out;
}

export function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function allocId(title: string, used: Set<string>): string {
  const key = normalizeTitleKey(title);
  for (let salt = 0; salt < 64; salt++) {
    const id = encode3(fnv1a(salt === 0 ? key : `${key}\0${salt}`));
    if (!used.has(id) && !RESERVED_IDS.has(id)) return id;
  }
  throw new Error("could not allocate a free 3-char id (list is nearly full)");
}

/** Validate a caller-supplied id; returns the lowercased id. Throws on invalid. */
export function normalizeId(raw: unknown): string {
  if (typeof raw !== "string" || !ID_PATTERN.test(raw.toLowerCase())) {
    throw new Error(
      `invalid task id ${JSON.stringify(raw)}: must be exactly 3 alphanumeric chars [a-z0-9] (e.g. "k7q")`,
    );
  }
  const id = raw.toLowerCase();
  if (RESERVED_IDS.has(id)) {
    throw new Error(`invalid task id "all": reserved word`);
  }
  return id;
}

/** Coerce dependsOn (string | string[] | undefined) to a lowercased string[]. */
export function coerceDependsOn(raw: unknown): string[] {
  if (raw === undefined) return [];
  const arr = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(arr) || !arr.every((v) => typeof v === "string")) {
    throw new Error(`invalid dependsOn ${JSON.stringify(raw)}: must be a 3-char id or an array of 3-char ids`);
  }
  return arr.map((v) => normalizeId(v));
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Transition = { from: TaskStatus; to: TaskStatus };

const ALLOWED: ReadonlySet<string> = new Set<string>([
  "planned>ongoing",
  "planned>done",
  "planned>cancelled",
  "ongoing>done",
  "ongoing>cancelled",
  "ongoing>planned",
  "cancelled>planned",
]);

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true; // no-op
  return ALLOWED.has(`${from}>${to}`);
}

export function assertTransition(from: TaskStatus, to: TaskStatus, id: string): void {
  if (from === to) return;
  if (from === "done") {
    throw new Error(`task ${id} is done (terminal in v1): cannot move done → ${to}; create a new task instead`);
  }
  if (!canTransition(from, to)) {
    throw new Error(`illegal transition for task ${id}: ${from} → ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Display mode (statusbar | end-of-turn | hidden)
// ---------------------------------------------------------------------------

/** Resolve the effective display mode, migrating legacy widgetVisible. */
export function resolveDisplayMode(snapshot: ChecklistSnapshot): DisplayMode {
  if (isDisplayMode(snapshot.displayMode)) return snapshot.displayMode;
  if (snapshot.widgetVisible === false) return "hidden";
  return "statusbar";
}

/** Resolve the effective status style. Default "pill" preserves the
 * long-standing status-word look (now rendered on a colored background). */
export function resolveStatusStyle(snapshot: ChecklistSnapshot): StatusStyle {
  if (isStatusStyle(snapshot.statusStyle)) return snapshot.statusStyle;
  return "pill";
}

/** Resolve the effective icon set. Default "nerd-font" (Nerd Font glyphs). */
export function resolveIconSet(snapshot: ChecklistSnapshot): IconSet {
  if (isIconSet(snapshot.iconSet)) return snapshot.iconSet;
  return "nerd-font";
}

/** Resolve the effective usage-guidance mode. Default "moderate". */
export function resolveUsage(snapshot: ChecklistSnapshot): UsageMode {
  if (isUsageMode(snapshot.usage)) return snapshot.usage;
  return "moderate";
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function toView(task: Task, byId: Map<string, Task>): TaskView {
  const blockedBy = task.dependsOn.filter((dep) => byId.get(dep)?.status !== "done");
  return {
    ...task,
    dependsOn: [...task.dependsOn],
    ready: task.status === "planned" && blockedBy.length === 0,
    blockedBy,
    blocked: blockedBy.length > 0,
  };
}

export function viewsOf(checklist: Checklist): TaskView[] {
  const byId = new Map(checklist.tasks.map((t) => [t.id, t]));
  return checklist.tasks.map((t) => toView(t, byId));
}

/** Sort order: ongoing, ready planned, blocked planned, done, cancelled. */
export function sortViews(views: TaskView[]): TaskView[] {
  const rank = (v: TaskView): number => {
    if (v.status === "ongoing") return 0;
    if (v.status === "planned" && !v.blocked) return 1;
    if (v.status === "planned") return 2;
    if (v.status === "done") return 3;
    return 4;
  };
  return [...views].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/** True if the dep graph (id → dependsOn) contains a cycle. */
export function hasCycle(graph: Map<string, string[]>): boolean {
  const state = new Map<string, 1 | 2>(); // 1 = in stack, 2 = done
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const dep of graph.get(id) ?? []) {
      if (visit(dep)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const id of graph.keys()) {
    if (visit(id)) return true;
  }
  return false;
}

function assertAcyclic(tasks: Task[]): void {
  const graph = new Map(tasks.map((t) => [t.id, [...t.dependsOn]]));
  if (hasCycle(graph)) {
    throw new Error("dependency cycle detected: dependsOn would create a loop");
  }
}

// ---------------------------------------------------------------------------
// Create / append (two-pass: explicit ids, then hashed titles)
// ---------------------------------------------------------------------------

function requireTitle(raw: unknown, index: number): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`task at index ${index} needs a non-empty title`);
  }
  return raw.trim();
}

export interface CreateResult {
  checklist: Checklist;
  /** Assigned ids in input order, for the LLM to copy. */
  assigned: Array<{ id: string; title: string }>;
}

export function createOrAppend(current: Checklist | null, input: CreateInput, now = Date.now()): CreateResult {
  const mode = input.mode ?? "replace";
  if (mode !== "replace" && mode !== "append") {
    throw new Error(`invalid mode ${JSON.stringify(input.mode)}: use "replace" or "append"`);
  }
  if (!Array.isArray(input.tasks)) {
    throw new Error(`invalid tasks: must be an array`);
  }

  const base: Task[] = mode === "append" && current ? current.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })) : [];
  const used = new Set(base.map((t) => t.id));

  // Pass 1: allocate ids (explicit first, then hashed).
  const ids: string[] = new Array(input.tasks.length);
  input.tasks.forEach((t, i) => {
    if (typeof t !== "object" || t === null) throw new Error(`task at index ${i} must be an object`);
    const title = requireTitle((t as { title: unknown }).title, i);
    void title;
    const rawId = (t as { id?: unknown }).id;
    if (rawId !== undefined) {
      const id = normalizeId(rawId);
      if (used.has(id)) throw new Error(`duplicate task id "${id}" (task at index ${i})`);
      used.add(id);
      ids[i] = id;
    }
  });
  input.tasks.forEach((t, i) => {
    if (ids[i] !== undefined) return;
    const title = requireTitle((t as { title: unknown }).title, i);
    const id = allocId(title, used);
    used.add(id);
    ids[i] = id;
  });

  // Pass 2: resolve dependsOn against existing + new ids, build tasks.
  const idSet = new Set(used);
  const fresh: Task[] = input.tasks.map((t, i) => {
    const task = t as { title: string; notes?: unknown; dependsOn?: unknown };
    const title = requireTitle(task.title, i);
    const id = ids[i]!;
    const dependsOn = coerceDependsOn(task.dependsOn);
    if (dependsOn.includes(id)) throw new Error(`task ${id} cannot depend on itself`);
    for (const dep of dependsOn) {
      if (!idSet.has(dep)) throw new Error(`task ${id} depends on unknown task "${dep}"`);
    }
    let notes: string | undefined;
    if (task.notes !== undefined) {
      if (typeof task.notes !== "string") throw new Error(`task ${id} notes must be a string`);
      notes = task.notes;
    }
    const built: Task = { id, title, status: "planned", dependsOn, createdAt: now, updatedAt: now };
    if (notes !== undefined) built.notes = notes;
    return built;
  });

  const tasks = [...base, ...fresh];
  assertAcyclic(tasks);

  let title = mode === "append" ? current?.title : undefined;
  if (input.title !== undefined) {
    if (typeof input.title !== "string") throw new Error(`invalid title: must be a string`);
    title = input.title.trim() ? input.title.trim() : undefined;
  }
  const checklist: Checklist = { tasks, updatedAt: now };
  if (title !== undefined) checklist.title = title;
  return {
    checklist,
    assigned: fresh.map((t) => ({ id: t.id, title: t.title })),
  };
}

// ---------------------------------------------------------------------------
// Update (all-or-nothing)
// ---------------------------------------------------------------------------

export interface UpdateResult {
  checklist: Checklist;
  changes: string[];
}

export function applyUpdates(current: Checklist | null, updates: UpdateTaskInput[], now = Date.now()): UpdateResult {
  if (!current || current.tasks.length === 0) {
    throw new Error("no checklist yet: use checklist_create first");
  }
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error("invalid updates: must be a non-empty array");
  }

  // Validate everything against a working copy, then commit.
  const next: Task[] = current.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] }));
  const byId = new Map(next.map((t) => [t.id, t]));
  const changes: string[] = [];

  // Normalize inputs first (ids lowercased, dependsOn coerced) so validation
  // sees exactly what would be applied.
  const normalized = updates.map((u, i) => {
    if (typeof u !== "object" || u === null) throw new Error(`update at index ${i} must be an object`);
    const id = normalizeId((u as { id: unknown }).id);
    const task = byId.get(id);
    if (!task) throw new Error(`unknown task id "${id}" (update at index ${i})`);
    return { index: i, id, task, update: u as UpdateTaskInput };
  });

  // Duplicate ids in one batch touch the same task twice — reject, since
  // per-update transition checks would otherwise see intermediate states.
  const seen = new Set<string>();
  for (const n of normalized) {
    if (seen.has(n.id)) throw new Error(`duplicate update for task "${n.id}": send one update per task`);
    seen.add(n.id);
  }

  // Field edits + status checks (status guard needs final deps, so dep edits
  // are staged first, then status transitions are checked last).
  const statusMoves: Array<{ task: Task; from: TaskStatus; to: TaskStatus }> = [];
  for (const n of normalized) {
    const { task, update, index } = n;
    if (task.status === "done") {
      const touchesStatus = update.status !== undefined && update.status !== "done";
      if (touchesStatus || update.title !== undefined || update.notes !== undefined || update.dependsOn !== undefined) {
        throw new Error(`task ${n.id} is done (frozen in v1): cannot edit; create a new task instead (update at index ${index})`);
      }
      continue;
    }
    if (update.title !== undefined) {
      if (typeof update.title !== "string" || update.title.trim().length === 0) {
        throw new Error(`task ${n.id} title must be a non-empty string`);
      }
      if (update.title.trim() !== task.title) {
        changes.push(`${n.id} retitled "${task.title}" → "${update.title.trim()}"`);
        task.title = update.title.trim();
      }
    }
    if (update.notes !== undefined) {
      if (typeof update.notes !== "string") throw new Error(`task ${n.id} notes must be a string`);
      task.notes = update.notes;
      changes.push(`${n.id} notes updated`);
    }
    if (update.dependsOn !== undefined) {
      const deps = coerceDependsOn(update.dependsOn);
      if (deps.includes(n.id)) throw new Error(`task ${n.id} cannot depend on itself`);
      for (const dep of deps) {
        if (!byId.has(dep)) throw new Error(`task ${n.id} depends on unknown task "${dep}"`);
      }
      task.dependsOn = deps;
      changes.push(`${n.id} dependsOn → [${deps.join(", ")}]`);
    }
    if (update.status !== undefined) {
      if (!TASK_STATUSES.includes(update.status)) {
        throw new Error(`task ${n.id} has invalid status ${JSON.stringify(update.status)}`);
      }
      assertTransition(task.status, update.status, n.id);
      if (task.status !== update.status) {
        statusMoves.push({ task, from: task.status, to: update.status });
      }
    }
    task.updatedAt = now;
  }

  // Dep guards for moves into ongoing/done from planned, against final deps.
  const finalById = new Map(next.map((t) => [t.id, t]));
  for (const m of statusMoves) {
    if (m.from === "planned" && (m.to === "ongoing" || m.to === "done")) {
      const blockedBy = m.task.dependsOn.filter((dep) => finalById.get(dep)?.status !== "done");
      if (blockedBy.length > 0) {
        throw new Error(
          `task ${m.task.id} is blocked by [${blockedBy.join(", ")}]: cannot move planned → ${m.to} until every dependency is done`,
        );
      }
    }
    m.task.status = m.to;
    m.task.updatedAt = now;
    changes.push(`${m.task.id} ${m.from} → ${m.to}`);
  }

  assertAcyclic(next);

  return { checklist: { title: current.title, tasks: next, updatedAt: now }, changes };
}

// ---------------------------------------------------------------------------
// Reconstruct from the current branch (oldest → newest, last snapshot wins)
// ---------------------------------------------------------------------------

interface BranchLike {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
  message?: { role?: unknown; toolName?: unknown; details?: unknown };
}

export function loadFromBranch(branch: BranchLike[]): ChecklistSnapshot {
  let found: ChecklistSnapshot = { v: 1, checklist: null };
  for (const entry of branch) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "custom" && entry.customType === "pi-checklist" && isChecklistSnapshot(entry.data)) {
      found = entry.data;
    } else if (
      entry.type === "message" &&
      entry.message?.role === "toolResult" &&
      typeof entry.message.toolName === "string" &&
      CHECKLIST_TOOLS.has(entry.message.toolName) &&
      isChecklistSnapshot(entry.message.details)
    ) {
      found = entry.message.details;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Text summaries (LLM-facing) and the before_agent_start snippet
// ---------------------------------------------------------------------------

export function countsOf(checklist: Checklist): { done: number; total: number; ongoing: number; ready: number; blocked: number } {
  const views = viewsOf(checklist);
  const billable = views.filter((v) => v.status !== "cancelled");
  return {
    done: billable.filter((v) => v.status === "done").length,
    total: billable.length,
    ongoing: views.filter((v) => v.status === "ongoing").length,
    ready: views.filter((v) => v.ready).length,
    blocked: views.filter((v) => v.status === "planned" && v.blocked).length,
  };
}

export function formatTaskLine(v: TaskView): string {
  const dep = v.blockedBy.length > 0 ? ` blocked ← ${v.blockedBy.join(", ")}` : "";
  const ready = v.ready ? " ready" : "";
  const notes = v.notes ? ` — ${v.notes}` : "";
  return `${v.id} [${v.status}]${ready}${dep} "${v.title}"${notes}`;
}

/** Compact snippet re-injected on before_agent_start so compaction can't hide the list. */
export function buildInjectSnippet(checklist: Checklist): string {
  const c = countsOf(checklist);
  const views = sortViews(viewsOf(checklist)).filter((v) => v.status !== "done" && v.status !== "cancelled");
  const parts = views.slice(0, 8).map((v) => {
    if (v.status === "ongoing") return `${v.id} ongoing "${v.title}"`;
    if (v.blocked) return `${v.id} blocked ← ${v.blockedBy.join(",")}`;
    return `${v.id} ready "${v.title}"`;
  });
  const extra = views.length > 8 ? ` (+${views.length - 8} more)` : "";
  return (
    `Current checklist (${c.done}/${c.total} done): ${parts.join("; ")}${extra}. ` +
    `Use checklist_update as work progresses. Do not start blocked tasks. Copy 3-char ids; never invent them.`
  );
}
