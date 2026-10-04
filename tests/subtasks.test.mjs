import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SUBTASKS_PER_TASK,
  applyUpdates,
  createOrAppend,
  viewsOf,
} from "../dist/store.js";
import { widgetLines } from "../dist/render.js";

const ON = { subtasksEnabled: true };
const OFF = { subtasksEnabled: false };
const NOW = 1000;

function parentWithSubs(subs, taskOpts = {}) {
  const { checklist } = createOrAppend(
    null,
    { tasks: [{ id: "aaa", title: "Parent", ...taskOpts, subtasks: subs }] },
    NOW,
    ON,
  );
  return checklist;
}

function subIds(checklist, parentId = "aaa") {
  return checklist.tasks.find((t) => t.id === parentId).subtasks.map((s) => s.id);
}

function update(checklist, updates, opts = ON, now = NOW + 1) {
  return applyUpdates(checklist, updates, now, opts).checklist;
}

// ---------------------------------------------------------------------------
// Gating + capacity
// ---------------------------------------------------------------------------

test("subtask payloads are rejected while the preview is off", () => {
  assert.throws(
    () => createOrAppend(null, { tasks: [{ title: "P", subtasks: [{ title: "S" }] }] }, NOW, OFF),
    /preview feature \(disabled\)/,
  );
  const bare = createOrAppend(null, { tasks: [{ id: "aaa", title: "P" }] }, NOW, OFF).checklist;
  assert.throws(
    () => applyUpdates(bare, [{ id: "aaa", subtasks: [{ title: "S" }] }], NOW + 1, OFF),
    /preview feature \(disabled\)/,
  );
});

test("empty subtask arrays are a no-op regardless of the flag", () => {
  const checklist = createOrAppend(
    null,
    { tasks: [{ id: "aaa", title: "P", subtasks: [] }] },
    NOW,
    OFF,
  ).checklist;
  assert.equal(checklist.tasks[0].subtasks, undefined);
});

test("at most 3 subtasks per task, enforced atomically", () => {
  assert.equal(MAX_SUBTASKS_PER_TASK, 3);
  assert.throws(
    () => parentWithSubs([{ title: "s1" }, { title: "s2" }, { title: "s3" }, { title: "s4" }]),
    /at most 3 subtasks/,
  );
  const checklist = parentWithSubs([{ title: "s1" }, { title: "s2" }, { title: "s3" }]);
  assert.equal(checklist.tasks[0].subtasks.length, 3);
  assert.throws(
    () => update(checklist, [{ id: "aaa", subtasks: [{ title: "s4" }] }]),
    /at most 3 subtasks/,
  );
  // Failed add rolled back: still 3, titles intact.
  assert.deepEqual(checklist.tasks[0].subtasks.map((s) => s.title), ["s1", "s2", "s3"]);
});

test("subtask ids share the checklist-wide space (no task/subtask collisions)", () => {
  assert.throws(
    () =>
      createOrAppend(
        null,
        {
          tasks: [
            { id: "aaa", title: "P", subtasks: [{ id: "zzz", title: "S" }] },
            { id: "zzz", title: "Q" },
          ],
        },
        NOW,
        ON,
      ),
    /duplicate subtask id "zzz"/,
  );
});

test("duplicate subtask id is rejected", () => {
  assert.throws(
    () =>
      createOrAppend(
        null,
        { tasks: [{ id: "aaa", title: "P", subtasks: [{ id: "zzz", title: "S" }] }, { id: "zzz", title: "Q" }] },
        NOW,
        ON,
      ),
    /duplicate subtask id "zzz"/,
  );
});

// ---------------------------------------------------------------------------
// Sibling scope
// ---------------------------------------------------------------------------

test("subtask dependsOn stays within the parent: cross-task refs rejected", () => {
  const { checklist } = createOrAppend(
    null,
    {
      tasks: [
        { id: "aaa", title: "P1", subtasks: [{ id: "s11", title: "S1" }] },
        { id: "bbb", title: "P2" },
      ],
    },
    NOW,
    ON,
  );
  const [s11] = subIds(checklist);
  assert.throws(
    () => update(checklist, [{ id: "bbb", subtasks: [{ title: "S2", dependsOn: [s11] }] }]),
    /only depend on siblings within the same parent task/,
  );
  // Depending on a top-level task id is also out of scope.
  assert.throws(
    () => update(checklist, [{ id: "aaa", subtasks: [{ title: "S2", dependsOn: ["bbb"] }] }]),
    /only depend on siblings within the same parent task/,
  );
  // Depending on a totally unknown id is unknown, not out-of-scope.
  assert.throws(
    () => update(checklist, [{ id: "aaa", subtasks: [{ title: "S2", dependsOn: ["qqq"] }] }]),
    /unknown subtask "qqq"/,
  );
  // Self-dependency rejected.
  assert.throws(
    () => update(checklist, [{ id: "aaa", subtasks: [{ id: "s99", title: "S9", dependsOn: ["s99"] }] }]),
    /cannot depend on itself/,
  );
});

test("sibling dependency chains + same-batch explicit ids work", () => {
  const checklist = parentWithSubs([
    { id: "s01", title: "First" },
    { id: "s02", title: "Second", dependsOn: ["s01"] },
  ]);
  const views = viewsOf(checklist);
  const subs = views[0].subtaskViews;
  assert.equal(subs[0].ready, true);
  assert.deepEqual(subs[1].blockedBy, ["s01"]);
  // Start + finish in dependency order.
  let next = update(checklist, [{ id: "aaa", subtasks: [{ id: "s01", status: "ongoing" }] }]);
  assert.equal(next.tasks[0].status, "ongoing"); // S2 auto-progress
  assert.throws(
    () => update(next, [{ id: "aaa", subtasks: [{ id: "s02", status: "ongoing" }] }]),
    /blocked by \[s01\]/,
  );
  next = update(next, [{ id: "aaa", subtasks: [{ id: "s01", status: "done" }] }]);
  next = update(next, [{ id: "aaa", subtasks: [{ id: "s02", status: "ongoing" }] }]);
  assert.equal(next.tasks[0].subtasks[1].status, "ongoing");
});

test("subtask cycles are rejected on create and on update", () => {
  assert.throws(
    () =>
      parentWithSubs([
        { id: "s01", title: "A", dependsOn: ["s02"] },
        { id: "s02", title: "B", dependsOn: ["s01"] },
      ]),
    /subtask cycle in task aaa/,
  );
  const checklist = parentWithSubs([{ id: "s01", title: "A" }, { id: "s02", title: "B" }]);
  assert.throws(
    () =>
      update(checklist, [
        { id: "aaa", subtasks: [{ id: "s01", dependsOn: ["s02"] }, { id: "s02", dependsOn: ["s01"] }] },
      ]),
    /subtask cycle in task aaa/,
  );
});

// ---------------------------------------------------------------------------
// S1 completion guard
// ---------------------------------------------------------------------------

test("S1: parent cannot finish with open subtasks; cancelled counts as resolved", () => {
  const checklist = parentWithSubs([{ title: "S1" }, { title: "S2" }]);
  const [s1, s2] = subIds(checklist);
  assert.throws(() => update(checklist, [{ id: "aaa", status: "done" }]), new RegExp(`open subtasks \\[${s1}, ${s2}\\]`));
  // Ongoing subtask also blocks.
  let next = update(checklist, [{ id: "aaa", subtasks: [{ id: s1, status: "ongoing" }] }]);
  assert.throws(() => update(next, [{ id: "aaa", status: "done" }]), /open subtasks/);
  // Cancelled resolves; done resolves. A batch finishing everything at once
  // rides in ONE entry (two entries for the same task stay rejected) —
  // including a subtask jumping planned → done directly.
  next = update(next, [{ id: "aaa", subtasks: [{ id: s1, status: "cancelled" }] }]);
  const finished = applyUpdates(next, [
    { id: "aaa", status: "done", subtasks: [{ id: s2, status: "done" }] },
  ], NOW + 9, ON);
  assert.equal(finished.checklist.tasks[0].status, "done");
  assert.equal(finished.checklist.tasks[0].subtasks.find((s) => s.id === s2).status, "done");
});

test("S1: headline batch (finish last subtask + parent together in ONE entry)", () => {
  const checklist = parentWithSubs([{ title: "S1" }, { title: "S2" }]);
  const [s1, s2] = subIds(checklist);
  const next = update(checklist, [{ id: "aaa", subtasks: [{ id: s1, status: "done" }, { id: s2, status: "ongoing" }] }]);
  const r = applyUpdates(next, [
    { id: "aaa", status: "done", subtasks: [{ id: s2, status: "done" }] },
  ], NOW + 5, ON);
  assert.equal(r.checklist.tasks[0].status, "done");
  // ...but adding a fresh planned subtask while completing is still rejected.
  assert.throws(
    () => applyUpdates(next, [
      { id: "aaa", status: "done", subtasks: [{ title: "Sneaky" }] },
    ], NOW + 6, ON),
    /open subtasks/,
  );
  // Two entries for the same task stay rejected (one update per task).
  assert.throws(
    () => applyUpdates(next, [
      { id: "aaa", status: "done" },
      { id: "aaa", subtasks: [{ id: s2, status: "done" }] },
    ], NOW + 7, ON),
    /duplicate update for task "aaa"/,
  );
});

// ---------------------------------------------------------------------------
// S2 auto-progress
// ---------------------------------------------------------------------------

test("S2: starting a subtask pulls a planned parent to ongoing", () => {
  const checklist = parentWithSubs([{ title: "S1" }]);
  const [s1] = subIds(checklist);
  const { checklist: next, changes } = applyUpdates(
    checklist, [{ id: "aaa", subtasks: [{ id: s1, status: "ongoing" }] }], NOW + 1, ON,
  );
  assert.equal(next.tasks[0].status, "ongoing");
  assert.match(changes.join("\n"), new RegExp(`aaa planned → ongoing \\(subtask ${s1} started\\)`));
});

test("S2: direct planned → done subtask jump also pulls the parent along", () => {
  const checklist = parentWithSubs([{ title: "S1" }]);
  const [s1] = subIds(checklist);
  const next = update(checklist, [{ id: "aaa", subtasks: [{ id: s1, status: "done" }] }]);
  assert.equal(next.tasks[0].status, "ongoing");
  assert.equal(next.tasks[0].subtasks[0].status, "done");
});

// ---------------------------------------------------------------------------
// S3 inherited block
// ---------------------------------------------------------------------------

test("S3: subtask cannot start while the parent is blocked; inherits blockedBy", () => {
  const { checklist } = createOrAppend(
    null,
    {
      tasks: [
        { id: "dep", title: "Prereq" },
        { id: "aaa", title: "Parent", dependsOn: ["dep"], subtasks: [{ id: "s01", title: "S1" }] },
      ],
    },
    NOW,
    ON,
  );
  const views = viewsOf(checklist);
  assert.deepEqual(views.find((v) => v.id === "aaa").subtaskViews[0].blockedBy, ["dep"]);
  assert.equal(views.find((v) => v.id === "aaa").subtaskViews[0].ready, false);
  assert.throws(
    () => update(checklist, [{ id: "aaa", subtasks: [{ id: "s01", status: "ongoing" }] }]),
    /inherits parent aaa's block \[dep\]/,
  );
  // Unblock the parent, then the subtask starts.
  let next = update(checklist, [{ id: "dep", status: "done" }]);
  assert.deepEqual(viewsOf(next).find((v) => v.id === "aaa").subtaskViews[0].blockedBy, []);
  next = update(next, [{ id: "aaa", subtasks: [{ id: "s01", status: "ongoing" }] }]);
  assert.equal(next.tasks.find((t) => t.id === "aaa").subtasks[0].status, "ongoing");
});

// ---------------------------------------------------------------------------
// S4 freeze + cancel cascade
// ---------------------------------------------------------------------------

test("S4: subtasks freeze under done/cancelled parents; cancel cascades, no revive", () => {
  const checklist = parentWithSubs([{ title: "S1" }, { title: "S2" }]);
  const [s1, s2] = subIds(checklist);
  let next = update(checklist, [{ id: "aaa", subtasks: [{ id: s1, status: "done" }] }]);
  // Cancelling the parent cascade-cancels the open subtask, keeps the done one.
  const { checklist: cancelled, changes } = applyUpdates(next, [{ id: "aaa", status: "cancelled" }], NOW + 2, ON);
  assert.equal(cancelled.tasks[0].subtasks.find((s) => s.id === s2).status, "cancelled");
  assert.equal(cancelled.tasks[0].subtasks.find((s) => s.id === s1).status, "done");
  assert.match(changes.join("\n"), new RegExp(`${s2} \\(subtask of aaa\\) planned → cancelled \\(parent cancelled\\)`));
  // Frozen: no subtask edits under a cancelled parent.
  assert.throws(
    () => update(cancelled, [{ id: "aaa", subtasks: [{ id: s2, status: "planned" }] }]),
    /is cancelled: revive it/,
  );
  // Reviving the parent does NOT revive the cascade-cancelled subtask.
  next = update(cancelled, [{ id: "aaa", status: "planned" }]);
  assert.equal(next.tasks[0].subtasks.find((s) => s.id === s2).status, "cancelled");
  // Done subtasks stay frozen individually.
  assert.throws(
    () => update(next, [{ id: "aaa", subtasks: [{ id: s1, title: "Renamed" }] }]),
    new RegExp(`subtask ${s1} \\(task aaa\\) is done \\(frozen`),
  );
  // Parent moves to cancelled in-batch own the subtasks: edits rejected.
  assert.throws(
    () => applyUpdates(next, [
      { id: "aaa", status: "cancelled", subtasks: [{ title: "Sneaky" }] },
    ], NOW + 3, ON),
    /cancel cascade owns the subtasks/,
  );
});

// ---------------------------------------------------------------------------
// S5 step-back guard
// ---------------------------------------------------------------------------

test("S5: parent cannot step back to planned while a subtask is ongoing", () => {
  const checklist = parentWithSubs([{ title: "S1" }]);
  const [s1] = subIds(checklist);
  const next = update(checklist, [{ id: "aaa", subtasks: [{ id: s1, status: "ongoing" }] }]);
  assert.equal(next.tasks[0].status, "ongoing");
  assert.throws(
    () => update(next, [{ id: "aaa", status: "planned" }]),
    new RegExp(`ongoing subtasks \\[${s1}\\]`),
  );
  // Step the subtask back first, then the parent follows.
  const back = update(next, [{ id: "aaa", subtasks: [{ id: s1, status: "planned" }] }]);
  const parked = update(back, [{ id: "aaa", status: "planned" }]);
  assert.equal(parked.tasks[0].status, "planned");
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test("widget shows a ↳ marker for tasks with subtasks (no subtask rows), blank slot otherwise", () => {
  const withSubs = parentWithSubs([{ title: "S1" }, { title: "S2" }]);
  const lines = widgetLines(withSubs).map((l) => l.text);
  const parentRow = lines.find((t) => t.includes("aaa"));
  assert.ok(parentRow?.startsWith("↳ ○ aaa"), "parent row has ↳ marker");
  // No subtask rows in the widget at all.
  assert.equal(lines.filter((t) => /  ↳ [a-z]/.test(t)).length, 0);

  // A task without subtasks keeps the same alignment via a blank marker slot.
  const plain = createOrAppend(null, { tasks: [{ id: "zzz", title: "Plain" }] }, 1).checklist;
  const plainRow = widgetLines(plain).find((l) => l.text.includes("zzz"))?.text;
  assert.ok(plainRow?.startsWith("  ○ zzz"), "plain row has blank marker slot");
  assert.equal(plainRow?.indexOf("Plain") - plainRow?.indexOf("zzz"), parentRow?.indexOf("Parent") - parentRow?.indexOf("aaa"), "titles stay aligned");
});
