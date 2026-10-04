/**
 * Pure checklist store: state machine, FNV-1a 3-char id allocation,
 * cycle detection, ready/blockedBy views, replace/append, reconstruct.
 *
 * No pi / TUI imports — testable with plain node.
 */
import { CHECKLIST_TOOLS, isChecklistSnapshot, isDisplayMode, isIconSet, isStatusStyle, isUsageMode, } from "./types.js";
export const ID_PATTERN = /^[a-z0-9]{3}$/;
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"; // 36
const RESERVED_IDS = new Set(["all"]);
export const TASK_STATUSES = ["planned", "ongoing", "done", "cancelled"];
/** Session checklists stay deliberately small and scannable. */
export const MAX_CHECKLIST_TASKS = 10;
/** Preview-gated subtasks stay even smaller: a fixed cap per parent task,
 * not user-changeable (like MAX_CHECKLIST_TASKS). */
export const MAX_SUBTASKS_PER_TASK = 3;
/** Error thrown when a subtask payload arrives while the preview is off. */
export function subtasksPreviewError() {
    return new Error("subtasks are a preview feature (disabled): enable them with /checklist settings subtasks before adding or editing subtasks");
}
// ---------------------------------------------------------------------------
// Id allocation (FNV-1a of normalized title, base36, salt on collision)
// ---------------------------------------------------------------------------
function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
function encode3(n) {
    let x = n >>> 0;
    let out = "";
    for (let i = 0; i < 3; i++) {
        out = ALPHABET[x % 36] + out;
        x = Math.floor(x / 36);
    }
    return out;
}
export function normalizeTitleKey(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function allocId(title, used) {
    const key = normalizeTitleKey(title);
    for (let salt = 0; salt < 64; salt++) {
        const id = encode3(fnv1a(salt === 0 ? key : `${key}\0${salt}`));
        if (!used.has(id) && !RESERVED_IDS.has(id))
            return id;
    }
    throw new Error("could not allocate a free 3-char id (list is nearly full)");
}
/** Validate a caller-supplied id; returns the lowercased id. Throws on invalid. */
export function normalizeId(raw) {
    if (typeof raw !== "string" || !ID_PATTERN.test(raw.toLowerCase())) {
        throw new Error(`invalid task id ${JSON.stringify(raw)}: must be exactly 3 alphanumeric chars [a-z0-9] (e.g. "k7q")`);
    }
    const id = raw.toLowerCase();
    if (RESERVED_IDS.has(id)) {
        throw new Error(`invalid task id "all": reserved word`);
    }
    return id;
}
/** Coerce dependsOn (string | string[] | undefined) to a lowercased string[]. */
export function coerceDependsOn(raw) {
    if (raw === undefined)
        return [];
    const arr = typeof raw === "string" ? [raw] : raw;
    if (!Array.isArray(arr) || !arr.every((v) => typeof v === "string")) {
        throw new Error(`invalid dependsOn ${JSON.stringify(raw)}: must be a 3-char id or an array of 3-char ids`);
    }
    return arr.map((v) => normalizeId(v));
}
const ALLOWED = new Set([
    "planned>ongoing",
    "planned>done",
    "planned>cancelled",
    "ongoing>done",
    "ongoing>cancelled",
    "ongoing>planned",
    "cancelled>planned",
]);
export function canTransition(from, to) {
    if (from === to)
        return true; // no-op
    return ALLOWED.has(`${from}>${to}`);
}
export function assertTransition(from, to, id) {
    if (from === to)
        return;
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
export function resolveDisplayMode(snapshot) {
    if (isDisplayMode(snapshot.displayMode))
        return snapshot.displayMode;
    if (snapshot.widgetVisible === false)
        return "hidden";
    return "statusbar";
}
/** Resolve the effective status style. Default "pill" preserves the
 * long-standing status-word look (now rendered on a colored background). */
export function resolveStatusStyle(snapshot) {
    if (isStatusStyle(snapshot.statusStyle))
        return snapshot.statusStyle;
    return "pill";
}
/** Resolve the effective icon set. Default "nerd-font" (Nerd Font glyphs). */
export function resolveIconSet(snapshot) {
    if (isIconSet(snapshot.iconSet))
        return snapshot.iconSet;
    return "nerd-font";
}
/** Resolve the effective usage-guidance mode. Default "moderate". */
export function resolveUsage(snapshot) {
    if (isUsageMode(snapshot.usage))
        return snapshot.usage;
    return "moderate";
}
/** Resolve whether the subtasks preview is enabled. Default `false`.
 * Precedence is handled by the caller (global prefs file > snapshot). */
export function resolveSubtasksEnabled(snapshot) {
    return snapshot.subtasksEnabled === true;
}
// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export function toView(task, byId) {
    const blockedBy = task.dependsOn.filter((dep) => byId.get(dep)?.status !== "done");
    const subs = task.subtasks ?? [];
    const sibById = new Map(subs.map((s) => [s.id, s]));
    return {
        ...task,
        dependsOn: [...task.dependsOn],
        subtasks: subs.map((s) => ({ ...s, dependsOn: [...s.dependsOn] })),
        ready: task.status === "planned" && blockedBy.length === 0,
        blockedBy,
        blocked: blockedBy.length > 0,
        subtaskViews: subs.map((s) => toSubtaskView(s, sibById, blockedBy)),
    };
}
/** Effective subtask view: `blockedBy` is sibling deps not done PLUS the
 * parent's own `blockedBy` when the parent is blocked (primitive S3 —
 * subtasks inherit the parent's blocked state). */
export function toSubtaskView(sub, sibById, parentBlockedBy) {
    const sibBlocked = sub.dependsOn.filter((dep) => sibById.get(dep)?.status !== "done");
    const blockedBy = [...sibBlocked, ...parentBlockedBy.filter((d) => !sibBlocked.includes(d))];
    return {
        ...sub,
        dependsOn: [...sub.dependsOn],
        ready: sub.status === "planned" && blockedBy.length === 0,
        blockedBy,
        blocked: blockedBy.length > 0,
    };
}
export function viewsOf(checklist) {
    const byId = new Map(checklist.tasks.map((t) => [t.id, t]));
    return checklist.tasks.map((t) => toView(t, byId));
}
/** Sort order: ongoing, ready planned, blocked planned, done, cancelled. */
export function sortViews(views) {
    const rank = (v) => {
        if (v.status === "ongoing")
            return 0;
        if (v.status === "planned" && !v.blocked)
            return 1;
        if (v.status === "planned")
            return 2;
        if (v.status === "done")
            return 3;
        return 4;
    };
    return [...views].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}
// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------
/** True if the dep graph (id → dependsOn) contains a cycle. */
export function hasCycle(graph) {
    const state = new Map(); // 1 = in stack, 2 = done
    const visit = (id) => {
        const s = state.get(id);
        if (s === 1)
            return true;
        if (s === 2)
            return false;
        state.set(id, 1);
        for (const dep of graph.get(id) ?? []) {
            if (visit(dep))
                return true;
        }
        state.set(id, 2);
        return false;
    };
    for (const id of graph.keys()) {
        if (visit(id))
            return true;
    }
    return false;
}
/** Build + validate a parent's subtasks (create path). Ids are allocated
 * from the shared checklist-wide `used` set (unique across tasks AND
 * subtasks); `dependsOn` must stay inside the sibling set. */
function buildSubtasks(parentId, raw, used, taskIdSet, subtasksEnabled, now) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw)) {
        throw new Error(`task ${parentId} subtasks must be an array`);
    }
    if (raw.length === 0)
        return [];
    if (!subtasksEnabled)
        throw subtasksPreviewError();
    if (raw.length > MAX_SUBTASKS_PER_TASK) {
        throw new Error(`task ${parentId} supports at most ${MAX_SUBTASKS_PER_TASK} subtasks (preview): got ${raw.length}`);
    }
    // Pass 1: explicit ids first (same-batch DAGs), then hashed titles.
    const ids = new Array(raw.length);
    raw.forEach((s, i) => {
        if (typeof s !== "object" || s === null)
            throw new Error(`subtask at index ${i} of task ${parentId} must be an object`);
        const rawId = s.id;
        if (rawId !== undefined) {
            const id = normalizeId(rawId);
            if (used.has(id))
                throw new Error(`duplicate subtask id "${id}" (task ${parentId}, index ${i})`);
            used.add(id);
            ids[i] = id;
        }
    });
    raw.forEach((s, i) => {
        if (ids[i] !== undefined)
            return;
        const title = requireTitle(s.title, i);
        const id = allocId(`${parentId} ${title}`, used);
        used.add(id);
        ids[i] = id;
    });
    // Pass 2: resolve sibling dependsOn, build subtasks.
    const sibSet = new Set(ids);
    const fresh = raw.map((s, i) => {
        const sub = s;
        const title = requireTitle(sub.title, i);
        const id = ids[i];
        if (sub !== null && typeof sub === "object" && "status" in sub && sub.status !== undefined) {
            throw new Error(`subtask ${id} (task ${parentId}) is born planned: omit status at create, start it via checklist_update`);
        }
        const dependsOn = coerceDependsOn(sub.dependsOn);
        assertSiblingDeps(parentId, id, dependsOn, sibSet, used, taskIdSet);
        let notes;
        if (sub.notes !== undefined) {
            if (typeof sub.notes !== "string")
                throw new Error(`subtask ${id} notes must be a string`);
            notes = sub.notes;
        }
        const built = { id, title, status: "planned", dependsOn, createdAt: now, updatedAt: now };
        if (notes !== undefined)
            built.notes = notes;
        return built;
    });
    assertAcyclic(new Map(fresh.map((s) => [s.id, [...s.dependsOn]])), `subtask cycle in task ${parentId} detected: dependsOn would create a loop`);
    return fresh;
}
/** Validate a subtask dep list against its sibling set. Refs to task ids,
 * other parents' subtasks, or totally unknown ids are rejected — subtasks
 * may only depend on siblings within the same parent task. */
function assertSiblingDeps(parentId, subId, dependsOn, sibSet, used, taskIdSet) {
    if (dependsOn.includes(subId))
        throw new Error(`subtask ${subId} cannot depend on itself`);
    for (const dep of dependsOn) {
        if (sibSet.has(dep))
            continue;
        if (used.has(dep) || taskIdSet.has(dep)) {
            throw new Error(`subtask ${subId} depends on "${dep}" outside task ${parentId}: subtasks may only depend on siblings within the same parent task`);
        }
        throw new Error(`subtask ${subId} depends on unknown subtask "${dep}" (task ${parentId})`);
    }
}
function assertAcyclic(graph, message = "dependency cycle detected: dependsOn would create a loop") {
    if (hasCycle(graph)) {
        throw new Error(message);
    }
}
// ---------------------------------------------------------------------------
// Create / append (two-pass: explicit ids, then hashed titles)
// ---------------------------------------------------------------------------
function requireTitle(raw, index) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new Error(`task at index ${index} needs a non-empty title`);
    }
    return raw.trim();
}
export function createOrAppend(current, input, now = Date.now(), opts) {
    const mode = input.mode ?? "replace";
    if (mode !== "replace" && mode !== "append") {
        throw new Error(`invalid mode ${JSON.stringify(input.mode)}: use "replace" or "append"`);
    }
    if (!Array.isArray(input.tasks)) {
        throw new Error(`invalid tasks: must be an array`);
    }
    const base = mode === "append" && current ? current.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })) : [];
    if (base.length + input.tasks.length > MAX_CHECKLIST_TASKS) {
        throw new Error(`checklists support at most ${MAX_CHECKLIST_TASKS} tasks; this ${mode} request would create ${base.length + input.tasks.length}`);
    }
    const used = new Set(base.map((t) => t.id));
    // Pass 1: allocate ids (explicit first, then hashed).
    const ids = new Array(input.tasks.length);
    input.tasks.forEach((t, i) => {
        if (typeof t !== "object" || t === null)
            throw new Error(`task at index ${i} must be an object`);
        const title = requireTitle(t.title, i);
        void title;
        const rawId = t.id;
        if (rawId !== undefined) {
            const id = normalizeId(rawId);
            if (used.has(id))
                throw new Error(`duplicate task id "${id}" (task at index ${i})`);
            used.add(id);
            ids[i] = id;
        }
    });
    input.tasks.forEach((t, i) => {
        if (ids[i] !== undefined)
            return;
        const title = requireTitle(t.title, i);
        const id = allocId(title, used);
        used.add(id);
        ids[i] = id;
    });
    // Pass 2: resolve dependsOn against existing + new ids, build tasks.
    // taskIdSet stays task-only: tasks may not depend on subtasks.
    const taskIdSet = new Set(used);
    const subtasksEnabled = opts?.subtasksEnabled === true;
    const fresh = input.tasks.map((t, i) => {
        const task = t;
        const title = requireTitle(task.title, i);
        const id = ids[i];
        const dependsOn = coerceDependsOn(task.dependsOn);
        if (dependsOn.includes(id))
            throw new Error(`task ${id} cannot depend on itself`);
        for (const dep of dependsOn) {
            if (used.has(dep) && !taskIdSet.has(dep)) {
                throw new Error(`task ${id} depends on "${dep}": tasks cannot depend on subtasks`);
            }
            if (!taskIdSet.has(dep))
                throw new Error(`task ${id} depends on unknown task "${dep}"`);
        }
        let notes;
        if (task.notes !== undefined) {
            if (typeof task.notes !== "string")
                throw new Error(`task ${id} notes must be a string`);
            notes = task.notes;
        }
        const subs = buildSubtasks(id, task.subtasks, used, taskIdSet, subtasksEnabled, now);
        const built = { id, title, status: "planned", dependsOn, createdAt: now, updatedAt: now };
        if (notes !== undefined)
            built.notes = notes;
        if (subs.length > 0)
            built.subtasks = subs;
        return built;
    });
    const tasks = [...base, ...fresh];
    assertAcyclic(new Map(tasks.map((t) => [t.id, [...t.dependsOn]])));
    let title = mode === "append" ? current?.title : undefined;
    if (input.title !== undefined) {
        if (typeof input.title !== "string")
            throw new Error(`invalid title: must be a string`);
        title = input.title.trim() ? input.title.trim() : undefined;
    }
    const checklist = { tasks, updatedAt: now };
    if (title !== undefined)
        checklist.title = title;
    return {
        checklist,
        assigned: fresh.map((t) => ({ id: t.id, title: t.title })),
    };
}
export function applyUpdates(current, updates, now = Date.now(), opts) {
    if (!current || current.tasks.length === 0) {
        throw new Error("no checklist yet: use checklist_create first");
    }
    if (!Array.isArray(updates) || updates.length === 0) {
        throw new Error("invalid updates: must be a non-empty array");
    }
    // Validate everything against a working copy, then commit.
    // Subtasks are deep-copied too: staging mutates them before the batch commits.
    const next = current.tasks.map((t) => ({
        ...t,
        dependsOn: [...t.dependsOn],
        ...(t.subtasks ? { subtasks: t.subtasks.map((s) => ({ ...s, dependsOn: [...s.dependsOn] })) } : {}),
    }));
    const byId = new Map(next.map((t) => [t.id, t]));
    const changes = [];
    // Normalize inputs first (ids lowercased, dependsOn coerced) so validation
    // sees exactly what would be applied.
    const normalized = updates.map((u, i) => {
        if (typeof u !== "object" || u === null)
            throw new Error(`update at index ${i} must be an object`);
        const id = normalizeId(u.id);
        const task = byId.get(id);
        if (!task)
            throw new Error(`unknown task id "${id}" (update at index ${i})`);
        return { index: i, id, task, update: u };
    });
    // Duplicate ids in one batch touch the same task twice — reject, since
    // per-update transition checks would otherwise see intermediate states.
    const seen = new Set();
    for (const n of normalized) {
        if (seen.has(n.id))
            throw new Error(`duplicate update for task "${n.id}": send one update per task`);
        seen.add(n.id);
    }
    // Field edits + status checks (status guard needs final deps, so dep edits
    // are staged first, then status transitions are checked last).
    const statusMoves = [];
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
            if (typeof update.notes !== "string")
                throw new Error(`task ${n.id} notes must be a string`);
            task.notes = update.notes;
            changes.push(`${n.id} notes updated`);
        }
        if (update.dependsOn !== undefined) {
            const deps = coerceDependsOn(update.dependsOn);
            if (deps.includes(n.id))
                throw new Error(`task ${n.id} cannot depend on itself`);
            for (const dep of deps) {
                if (!byId.has(dep))
                    throw new Error(`task ${n.id} depends on unknown task "${dep}"`);
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
    // Subtask staging (adds + field edits + status intents). Runs after the
    // task field loop so parent dep edits are already final in the working
    // copy; status moves commit later (subtasks before tasks — see below).
    const subtasksEnabled = opts?.subtasksEnabled === true;
    const subtaskMoves = [];
    const stagedParentMove = new Map(statusMoves.map((m) => [m.task.id, m.to]));
    // Checklist-wide id space (tasks + existing subtasks) for alloc + scope checks.
    const usedAll = new Set();
    for (const t of next) {
        usedAll.add(t.id);
        for (const s of t.subtasks ?? [])
            usedAll.add(s.id);
    }
    const taskOnlySet = new Set(next.map((t) => t.id));
    for (const n of normalized) {
        const rawSubs = n.update.subtasks;
        if (rawSubs === undefined)
            continue;
        if (!Array.isArray(rawSubs) || rawSubs.length === 0) {
            if (Array.isArray(rawSubs))
                continue;
            throw new Error(`task ${n.id} subtasks must be an array`);
        }
        if (!subtasksEnabled)
            throw subtasksPreviewError();
        const parent = n.task;
        if (parent.status === "done") {
            throw new Error(`task ${n.id} is done (frozen in v1): cannot edit its subtasks; create a new task instead (update at index ${n.index})`);
        }
        if (parent.status === "cancelled") {
            throw new Error(`task ${n.id} is cancelled: revive it (cancelled → planned) before editing its subtasks (update at index ${n.index})`);
        }
        // A parent finishing alongside its subtasks is the headline batch: it
        // rides in ONE entry ({ status: "done", subtasks: [...] }) — the
        // subtask moves commit first and S1 validates the parent at commit.
        // Cancelling owns the subtasks via the cascade, so mixing any subtask
        // edits with →cancelled is always rejected.
        if (stagedParentMove.get(n.id) === "cancelled") {
            throw new Error(`task ${n.id} moves to cancelled in this batch: drop the subtask edits — the cancel cascade owns the subtasks`);
        }
        const existing = parent.subtasks ?? [];
        const bySubId = new Map(existing.map((s) => [s.id, s]));
        // Classify: id matching an existing subtask = patch; otherwise an add
        // (explicit id when given, hashed title when omitted).
        const addEntries = [];
        const patchEntries = [];
        rawSubs.forEach((e, si) => {
            if (typeof e !== "object" || e === null) {
                throw new Error(`subtask update at index ${si} of task ${n.id} must be an object`);
            }
            const entry = e;
            if (entry.id === undefined) {
                addEntries.push({ entry });
                return;
            }
            const sid = normalizeId(entry.id);
            if (bySubId.has(sid)) {
                if (patchEntries.some((p) => p.sid === sid)) {
                    throw new Error(`duplicate update for subtask "${sid}" of task ${n.id}: send one update per subtask`);
                }
                patchEntries.push({ entry, sid });
            }
            else {
                addEntries.push({ entry, explicitId: sid });
            }
        });
        if (existing.length + addEntries.length > MAX_SUBTASKS_PER_TASK) {
            throw new Error(`task ${n.id} supports at most ${MAX_SUBTASKS_PER_TASK} subtasks (preview): this update would create ${existing.length + addEntries.length}`);
        }
        const sibSet = new Set(existing.map((s) => s.id));
        for (const a of addEntries) {
            if (a.explicitId === undefined)
                continue;
            if (usedAll.has(a.explicitId))
                throw new Error(`duplicate subtask id "${a.explicitId}" (task ${n.id})`);
            usedAll.add(a.explicitId);
            sibSet.add(a.explicitId);
        }
        for (const a of addEntries) {
            if (a.explicitId !== undefined)
                continue;
            const title = requireTitle(a.entry.title, 0);
            const id = allocId(`${n.id} ${title}`, usedAll);
            usedAll.add(id);
            a.explicitId = id;
            sibSet.add(id);
        }
        const builtAdds = addEntries.map((a) => {
            const title = requireTitle(a.entry.title, 0);
            const sid = a.explicitId;
            if (a.entry.status !== undefined) {
                throw new Error(`new subtask ${sid} (task ${n.id}) is born planned: omit status, start it via a later update`);
            }
            const deps = coerceDependsOn(a.entry.dependsOn);
            assertSiblingDeps(n.id, sid, deps, sibSet, usedAll, taskOnlySet);
            let notes;
            if (a.entry.notes !== undefined) {
                if (typeof a.entry.notes !== "string")
                    throw new Error(`subtask ${sid} notes must be a string`);
                notes = a.entry.notes;
            }
            const built = { id: sid, title, status: "planned", dependsOn: deps, createdAt: now, updatedAt: now };
            if (notes !== undefined)
                built.notes = notes;
            changes.push(`${sid} (subtask of ${n.id}) added "${title}"`);
            return built;
        });
        parent.subtasks = [...existing, ...builtAdds];
        for (const { entry, sid } of patchEntries) {
            const sub = bySubId.get(sid);
            if (sub.status === "done") {
                const touchesStatus = entry.status !== undefined && entry.status !== "done";
                if (touchesStatus || entry.title !== undefined || entry.notes !== undefined || entry.dependsOn !== undefined) {
                    throw new Error(`subtask ${sid} (task ${n.id}) is done (frozen in v1): cannot edit; create a new task instead`);
                }
                continue;
            }
            if (entry.title !== undefined) {
                if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
                    throw new Error(`subtask ${sid} (task ${n.id}) title must be a non-empty string`);
                }
                if (entry.title.trim() !== sub.title) {
                    changes.push(`${sid} (subtask of ${n.id}) retitled "${sub.title}" → "${entry.title.trim()}"`);
                    sub.title = entry.title.trim();
                }
            }
            if (entry.notes !== undefined) {
                if (typeof entry.notes !== "string")
                    throw new Error(`subtask ${sid} (task ${n.id}) notes must be a string`);
                sub.notes = entry.notes;
                changes.push(`${sid} (subtask of ${n.id}) notes updated`);
            }
            if (entry.dependsOn !== undefined) {
                const deps = coerceDependsOn(entry.dependsOn);
                assertSiblingDeps(n.id, sid, deps, sibSet, usedAll, taskOnlySet);
                sub.dependsOn = deps;
                changes.push(`${sid} (subtask of ${n.id}) dependsOn → [${deps.join(", ")}]`);
            }
            if (entry.status !== undefined) {
                if (!TASK_STATUSES.includes(entry.status)) {
                    throw new Error(`subtask ${sid} (task ${n.id}) has invalid status ${JSON.stringify(entry.status)}`);
                }
                assertTransition(sub.status, entry.status, `${sid} (subtask of ${n.id})`);
                if (sub.status !== entry.status) {
                    subtaskMoves.push({ parent, sub, from: sub.status, to: entry.status });
                }
            }
            sub.updatedAt = now;
        }
    }
    // Dep guards for moves into ongoing/done from planned, against final deps.
    const finalById = new Map(next.map((t) => [t.id, t]));
    // Commit subtask moves FIRST (primitive S3: sibling + inherited-parent
    // guards) so the S1/S5 task guards below see final subtask states — a
    // batch that finishes the last subtask and the parent together succeeds
    // regardless of entry order.
    const startedParents = new Map(); // parentId → started subtask ids (S2)
    for (const m of subtaskMoves) {
        if (m.from === "planned" && (m.to === "ongoing" || m.to === "done")) {
            const sibById = new Map((m.parent.subtasks ?? []).map((s) => [s.id, s]));
            const sibBlocked = m.sub.dependsOn.filter((dep) => sibById.get(dep)?.status !== "done");
            if (sibBlocked.length > 0) {
                throw new Error(`subtask ${m.sub.id} (task ${m.parent.id}) is blocked by [${sibBlocked.join(", ")}]: cannot move planned → ${m.to} until every sibling dependency is done`);
            }
            const parentBlocked = m.parent.dependsOn.filter((dep) => finalById.get(dep)?.status !== "done");
            if (parentBlocked.length > 0) {
                throw new Error(`subtask ${m.sub.id} inherits parent ${m.parent.id}'s block [${parentBlocked.join(", ")}]: cannot move planned → ${m.to} until the parent is unblocked`);
            }
        }
        m.sub.status = m.to;
        m.sub.updatedAt = now;
        changes.push(`${m.sub.id} (subtask of ${m.parent.id}) ${m.from} → ${m.to}`);
        if (m.from === "planned" && (m.to === "ongoing" || m.to === "done")) {
            const arr = startedParents.get(m.parent.id) ?? [];
            arr.push(m.sub.id);
            startedParents.set(m.parent.id, arr);
        }
    }
    for (const m of statusMoves) {
        if (m.from === "planned" && (m.to === "ongoing" || m.to === "done")) {
            const blockedBy = m.task.dependsOn.filter((dep) => finalById.get(dep)?.status !== "done");
            if (blockedBy.length > 0) {
                throw new Error(`task ${m.task.id} is blocked by [${blockedBy.join(", ")}]: cannot move planned → ${m.to} until every dependency is done`);
            }
        }
        // S1 completion guard: no done parent with open subtasks. Cancelled
        // counts as resolved (otherwise a dropped subtask would brick the parent).
        if (m.to === "done") {
            const open = (m.task.subtasks ?? [])
                .filter((s) => s.status !== "done" && s.status !== "cancelled")
                .map((s) => s.id);
            if (open.length > 0) {
                throw new Error(`task ${m.task.id} has open subtasks [${open.join(", ")}]: finish every subtask (done) before completing the parent`);
            }
        }
        // S5 step-back guard: an ongoing child implies a non-planned parent.
        if (m.from === "ongoing" && m.to === "planned") {
            const running = (m.task.subtasks ?? []).filter((s) => s.status === "ongoing").map((s) => s.id);
            if (running.length > 0) {
                throw new Error(`task ${m.task.id} has ongoing subtasks [${running.join(", ")}]: move them back to planned before moving the parent back to planned`);
            }
        }
        m.task.status = m.to;
        m.task.updatedAt = now;
        changes.push(`${m.task.id} ${m.from} → ${m.to}`);
        // S4 cancel cascade: open subtasks die with the parent. Reviving the
        // parent later does NOT revive them (explicit re-plan required).
        if (m.to === "cancelled") {
            for (const s of m.task.subtasks ?? []) {
                if (s.status === "planned" || s.status === "ongoing") {
                    const prev = s.status;
                    s.status = "cancelled";
                    s.updatedAt = now;
                    changes.push(`${s.id} (subtask of ${m.task.id}) ${prev} → cancelled (parent cancelled)`);
                }
            }
        }
    }
    // S2 auto-progress: a subtask that started pulls a planned parent along.
    // (Blocked parents can't appear here — S3 rejects starting their subtasks.)
    for (const task of next) {
        if (task.status !== "planned")
            continue;
        const started = startedParents.get(task.id);
        if (started && started.length > 0) {
            task.status = "ongoing";
            task.updatedAt = now;
            changes.push(`${task.id} planned → ongoing (subtask ${started[0]} started)`);
        }
    }
    assertAcyclic(new Map(next.map((t) => [t.id, [...t.dependsOn]])));
    for (const t of next) {
        const subs = t.subtasks ?? [];
        if (subs.length > 0) {
            assertAcyclic(new Map(subs.map((s) => [s.id, [...s.dependsOn]])), `subtask cycle in task ${t.id} detected: dependsOn would create a loop`);
        }
    }
    return { checklist: { title: current.title, tasks: next, updatedAt: now }, changes };
}
export function loadFromBranch(branch) {
    let found = { v: 1, checklist: null };
    for (const entry of branch) {
        if (!entry || typeof entry !== "object")
            continue;
        if (entry.type === "custom" && entry.customType === "pi-checklist" && isChecklistSnapshot(entry.data)) {
            found = entry.data;
        }
        else if (entry.type === "message" &&
            entry.message?.role === "toolResult" &&
            typeof entry.message.toolName === "string" &&
            CHECKLIST_TOOLS.has(entry.message.toolName) &&
            isChecklistSnapshot(entry.message.details)) {
            found = entry.message.details;
        }
    }
    return found;
}
// ---------------------------------------------------------------------------
// Text summaries (LLM-facing) and the before_agent_start snippet
// ---------------------------------------------------------------------------
export function countsOf(checklist) {
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
export function formatTaskLine(v) {
    const dep = v.blockedBy.length > 0 ? ` blocked ← ${v.blockedBy.join(", ")}` : "";
    const ready = v.ready ? " ready" : "";
    const notes = v.notes ? ` — ${v.notes}` : "";
    const head = `${v.id} [${v.status}]${ready}${dep} "${v.title}"${notes}`;
    const subs = (v.subtaskViews ?? []).map((s) => {
        const sdep = s.blockedBy.length > 0 ? ` blocked ← ${s.blockedBy.join(", ")}` : "";
        const sready = s.ready ? " ready" : "";
        return `\n  ↳ ${s.id} [${s.status}]${sready}${sdep} "${s.title}"`;
    });
    return head + subs.join("");
}
/** Compact snippet re-injected on before_agent_start so compaction can't hide the list. */
export function buildInjectSnippet(checklist) {
    const c = countsOf(checklist);
    const views = sortViews(viewsOf(checklist)).filter((v) => v.status !== "done" && v.status !== "cancelled");
    const parts = views.slice(0, 8).map((v) => {
        if (v.status === "ongoing")
            return `${v.id} ongoing "${v.title}"`;
        if (v.blocked)
            return `${v.id} blocked ← ${v.blockedBy.join(",")}`;
        return `${v.id} ready "${v.title}"`;
    });
    const extra = views.length > 8 ? ` (+${views.length - 8} more)` : "";
    return (`Current checklist (${c.done}/${c.total} done): ${parts.join("; ")}${extra}. ` +
        `Use checklist_update as work progresses. Do not start blocked tasks. Copy 3-char ids; never invent them.`);
}
