import assert from "node:assert/strict";
import test from "node:test";

import { MAX_CHECKLIST_TASKS, createOrAppend } from "../dist/store.js";
import { ChecklistOverlay, WIDGET_MAX_TASKS, widgetLines } from "../dist/render.js";

const theme = {
  fg: (_name, text) => text,
  bg: (_name, text) => text,
  bold: (text) => text,
};

function tasks(count) {
  return Array.from({ length: count }, (_, index) => ({ title: `Task ${index + 1}` }));
}

function createChecklist(count = MAX_CHECKLIST_TASKS) {
  return createOrAppend(null, { tasks: tasks(count) }, 1).checklist;
}

test("allows exactly 10 tasks but rejects an 11th replacement", () => {
  const checklist = createChecklist();
  assert.equal(checklist.tasks.length, MAX_CHECKLIST_TASKS);

  assert.throws(
    () => createOrAppend(null, { tasks: tasks(MAX_CHECKLIST_TASKS + 1) }, 2),
    /at most 10 tasks/,
  );
});

test("rejects an overflowing append without mutating the existing checklist", () => {
  const checklist = createChecklist();

  assert.throws(
    () => createOrAppend(checklist, { mode: "append", tasks: [{ title: "Eleventh" }] }, 2),
    /at most 10 tasks/,
  );
  assert.equal(checklist.tasks.length, MAX_CHECKLIST_TASKS);
  assert.deepEqual(checklist.tasks.map((task) => task.title), tasks(MAX_CHECKLIST_TASKS).map((task) => task.title));
});

test("widget shows the top five tasks while the checklist overlay shows all ten", () => {
  const checklist = createChecklist();
  const lines = widgetLines(checklist);
  const taskRows = lines.filter((line) => !["header", "summary"].includes(line.kind));

  assert.equal(taskRows.length, WIDGET_MAX_TASKS);
  assert.deepEqual(taskRows.map((line) => line.text.match(/Task \d+/)?.[0]), ["Task 1", "Task 2", "Task 3", "Task 4", "Task 5"]);
  assert.match(lines.at(-1).text, /\+5 more/);

  const overlay = new ChecklistOverlay(checklist, theme, { onClose() {}, requestRender() {} });
  assert.equal(overlay.render(100).filter((line) => /Task \d/.test(line)).length, MAX_CHECKLIST_TASKS);
});
