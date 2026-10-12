import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AddTaskDialog, sanitizeIdInput } from "../dist/add-task-dialog.js";
import { parseChecklistArgs, registerChecklistCommand } from "../dist/commands.js";
import extension from "../dist/index.js";
import { MAX_CHECKLIST_TASKS, addTask, applyUpdates, createOrAppend, suggestTaskId, validateAddTask } from "../dist/store.js";

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };

const KEY = { tab: "\t", shiftTab: "\x1b[Z", up: "\x1b[A", down: "\x1b[B", enter: "\r", esc: "\x1b", ctrlR: "\x12" };

function list(...tasks) {
  return createOrAppend(null, { tasks }, 1).checklist;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

test("suggestTaskId returns a free, valid id and never a task or subtask id", () => {
  const checklist = createOrAppend(
    null,
    { tasks: [{ id: "aaa", title: "A", subtasks: [{ id: "bbb", title: "B" }] }] },
    1,
    { subtasksEnabled: true },
  ).checklist;
  // rng that first yields "aaa", then "bbb", then "ccc" (index 10, 11, 12 → a, b, c)
  const seq = [10, 10, 10, 11, 11, 11, 12, 12, 12];
  let i = 0;
  const id = suggestTaskId(checklist, () => (seq[i++] + 0.5) / 36);
  assert.equal(id, "ccc");
  assert.match(suggestTaskId(null), /^[a-z0-9]{3}$/);
  // "all" is reserved
  const rolls = [10, 21, 21, 0, 0, 0]; // "all", then "000"
  let j = 0;
  assert.equal(suggestTaskId(null, () => (rolls[j++] + 0.5) / 36), "000");
});

test("validateAddTask: id format, reserved, uniqueness (tasks and subtasks), title, capacity, deps", () => {
  const checklist = createOrAppend(
    null,
    { tasks: [{ id: "aaa", title: "A", subtasks: [{ id: "sub", title: "S" }] }, { id: "bbb", title: "B" }] },
    1,
    { subtasksEnabled: true },
  ).checklist;
  const ok = { id: "ccc", title: "C", dependsOn: ["aaa", "bbb"] };
  assert.deepEqual(validateAddTask(checklist, ok), {});
  assert.deepEqual(validateAddTask(null, { id: "ccc", title: "C", dependsOn: [] }), {});

  for (const id of ["", "ab", "abcd", "a-b", "ab "]) {
    assert.match(validateAddTask(checklist, { ...ok, id }).id ?? "", /exactly 3 characters/, JSON.stringify(id));
  }
  assert.equal(validateAddTask(checklist, { ...ok, id: " CCC " }).id, undefined, "trimmed + case-insensitive");
  assert.match(validateAddTask(checklist, { ...ok, id: "all" }).id, /reserved/);
  assert.match(validateAddTask(checklist, { ...ok, id: "AAA" }).id, /already used by a task/);
  assert.match(validateAddTask(checklist, { ...ok, id: "sub" }).id, /already used by a subtask of aaa/);
  assert.match(validateAddTask(checklist, { ...ok, title: "   " }).title, /can't be empty/);
  assert.match(validateAddTask(checklist, { ...ok, dependsOn: ["aaa", "zzz"] }).dependsOn, /unknown task: zzz/);
  assert.match(validateAddTask(checklist, { ...ok, dependsOn: ["sub"] }).dependsOn, /unknown task: sub/);

  const full = createOrAppend(null, { tasks: Array.from({ length: MAX_CHECKLIST_TASKS }, (_, n) => ({ title: `T${n}` })) }, 1).checklist;
  assert.match(validateAddTask(full, ok).form, /full \(10\/10 tasks\)/);
  // all problems are reported together
  const many = validateAddTask(full, { id: "x", title: "", dependsOn: ["zzz"] });
  assert.deepEqual(Object.keys(many).sort(), ["dependsOn", "form", "id", "title"]);
});

test("addTask appends a planned task, trims/lowercases, dedupes deps and leaves the input untouched", () => {
  const base = list({ id: "aaa", title: "A" });
  const result = addTask(base, { id: " BBB ", title: "  Write docs  ", dependsOn: ["AAA", "aaa"] }, 5);
  assert.ok(result.ok);
  assert.equal(base.tasks.length, 1);
  assert.equal(result.checklist.tasks.length, 2);
  assert.deepEqual(
    { id: result.task.id, title: result.task.title, status: result.task.status, dependsOn: result.task.dependsOn },
    { id: "bbb", title: "Write docs", status: "planned", dependsOn: ["aaa"] },
  );
  assert.equal(result.checklist.updatedAt, 5);
  assert.equal(result.checklist.tasks[1], result.task);
  // works on an empty / missing checklist too
  const first = addTask(null, { id: "abc", title: "First", dependsOn: [] });
  assert.ok(first.ok);
  assert.deepEqual(first.checklist.tasks.map((t) => t.id), ["abc"]);
});

test("addTask does not validate dependency status: unfinished, ongoing, done and cancelled deps are all fine", () => {
  let checklist = list({ id: "pln", title: "Planned" }, { id: "ong", title: "Going" }, { id: "don", title: "Done" }, { id: "can", title: "Cancelled" });
  checklist = applyUpdates(checklist, [{ id: "ong", status: "ongoing" }, { id: "don", status: "done" }, { id: "can", status: "cancelled" }], 2).checklist;
  const result = addTask(checklist, { id: "new", title: "After everything", dependsOn: ["pln", "ong", "don", "can"] }, 3);
  assert.ok(result.ok);
  assert.equal(result.task.status, "planned");
  // …and it is simply blocked until they finish (a view concern, not a validation error).
  const added = result.checklist.tasks.find((t) => t.id === "new");
  assert.deepEqual(added.dependsOn, ["pln", "ong", "don", "can"]);
});

test("addTask reports errors without a result and keeps the checklist valid", () => {
  const base = list({ id: "aaa", title: "A" });
  const bad = addTask(base, { id: "aaa", title: "", dependsOn: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.id && bad.errors.title);
});

test("createOrAppend append refuses an id that an existing subtask already uses", () => {
  const base = createOrAppend(null, { tasks: [{ id: "aaa", title: "A", subtasks: [{ id: "sub", title: "S" }] }] }, 1, { subtasksEnabled: true }).checklist;
  assert.throws(() => createOrAppend(base, { mode: "append", tasks: [{ id: "sub", title: "X" }] }, 2, { subtasksEnabled: true }), /duplicate task id "sub"/);
  assert.throws(() => createOrAppend(base, { mode: "append", tasks: [{ id: "new", title: "X", dependsOn: "sub" }] }, 2), /cannot depend on subtasks/);
  // hashed ids also steer clear of subtask ids
  const out = createOrAppend(base, { mode: "append", tasks: [{ title: "Y" }] }, 2).checklist;
  assert.equal(new Set(out.tasks.flatMap((t) => [t.id, ...(t.subtasks ?? []).map((s) => s.id)])).size, 3);
});

test("sanitizeIdInput lowercases, strips and caps at 3", () => {
  assert.equal(sanitizeIdInput("A-b_C9z"), "abc");
  assert.equal(sanitizeIdInput("!!"), "");
});

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function mount(checklist, { id = "xyz", title, maxRows, current = () => checklist } = {}) {
  const submitted = [];
  let closed = 0;
  let renders = 0;
  const dialog = new AddTaskDialog(
    checklist,
    { id, title },
    theme,
    {
      onSubmit: (draft) => {
        submitted.push(draft);
        return addTask(current(), draft);
      },
      onClose: () => closed++,
      requestRender: () => renders++,
      getMaxRows: maxRows === undefined ? undefined : () => maxRows,
    },
    { style: "icon", iconSet: "emoji" },
  );
  const type = (text) => [...text].forEach((ch) => dialog.handleInput(ch));
  // Strip SGR (the Input's reverse-video cursor) but keep the zero-width cursor marker intact.
  const text = (width = 70) => dialog.render(width).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  return { dialog, submitted, type, text, closed: () => closed, renders: () => renders };
}

test("dialog opens on the task field with a generated id, and Enter adds a plain task", () => {
  const { dialog, submitted, type, closed, text } = mount(null);
  const screen = text();
  assert.match(screen, /Add checklist task/);
  assert.match(screen, /ID\s+xyz/);
  assert.match(screen, /what needs doing\?/);
  assert.match(screen, /no tasks yet/);
  type("Write the docs");
  dialog.handleInput(KEY.enter);
  assert.deepEqual(submitted, [{ id: "xyz", title: "Write the docs", dependsOn: [] }]);
  assert.equal(closed(), 1);
});

test("dialog: id is editable, sanitized and Ctrl+R rolls a new one", () => {
  const { dialog, submitted, type, text } = mount(null, { id: "abc", title: "T" });
  dialog.handleInput(KEY.up); // → ID field
  for (let i = 0; i < 3; i++) dialog.handleInput("\x7f"); // backspace ×3
  type("Q-w E9r"); // sanitized: q, w, e (full at 3)
  assert.match(text(), /ID\s+qwe/);
  dialog.handleInput(KEY.ctrlR);
  const rolled = text().match(/ID\s+([a-z0-9]{3})/)[1];
  assert.match(rolled, /^[a-z0-9]{3}$/);
  dialog.handleInput(KEY.enter);
  assert.equal(submitted[0].id, rolled);
  assert.equal(submitted[0].title, "T");
});

test("dialog: prefilled title keeps the cursor at its end", () => {
  const { dialog, submitted, type } = mount(null, { title: "Fix the" });
  type(" bug");
  dialog.handleInput(KEY.enter);
  assert.equal(submitted[0].title, "Fix the bug");
});

test("dialog: picker toggles dependencies; unfinished/done tasks are all selectable", () => {
  let checklist = list({ id: "aaa", title: "Alpha" }, { id: "bbb", title: "Beta" }, { id: "ccc", title: "Gamma" });
  checklist = applyUpdates(checklist, [{ id: "ccc", status: "done" }], 2).checklist;
  const { dialog, submitted, text, closed } = mount(checklist, { id: "new", title: "Later" });
  assert.match(text(), /Depends on\s+\(optional\) · 0 selected/);
  dialog.handleInput(KEY.tab); // title → deps
  assert.match(text(), /› Depends on/);
  dialog.handleInput(" "); // aaa
  dialog.handleInput("j");
  dialog.handleInput("j");
  dialog.handleInput("x"); // ccc (done)
  dialog.handleInput("k");
  dialog.handleInput(" "); // bbb on
  dialog.handleInput(" "); // bbb off again
  assert.match(text(), /· 2 selected/);
  assert.match(text(), /\[x\] .* aaa Alpha/);
  assert.match(text(), /\[ \] .* bbb Beta/);
  assert.match(text(), /\[x\] .* ccc Gamma/);
  dialog.handleInput(KEY.enter); // Enter submits from the picker too
  assert.deepEqual(submitted, [{ id: "new", title: "Later", dependsOn: ["aaa", "ccc"] }]);
  assert.equal(closed(), 1);
});

test("dialog: Tab/Shift+Tab/arrows move between fields; ↑ on the first picker row returns to Task", () => {
  const checklist = list({ id: "aaa", title: "Alpha" });
  const { dialog, text } = mount(checklist, { id: "new" });
  const focusedLabel = () => text().match(/› (ID|Task|Depends on)/)[1];
  assert.equal(focusedLabel(), "Task");
  dialog.handleInput(KEY.tab);
  assert.equal(focusedLabel(), "Depends on");
  dialog.handleInput(KEY.tab); // wraps
  assert.equal(focusedLabel(), "ID");
  dialog.handleInput(KEY.shiftTab); // back to the picker
  assert.equal(focusedLabel(), "Depends on");
  dialog.handleInput(KEY.up); // first row → Task
  assert.equal(focusedLabel(), "Task");
  dialog.handleInput(KEY.down);
  assert.equal(focusedLabel(), "Depends on");
  dialog.handleInput(KEY.down); // already last: stays
  assert.equal(focusedLabel(), "Depends on");
});

test("dialog: with no tasks the picker is skipped", () => {
  const { dialog, text } = mount(null);
  dialog.handleInput(KEY.tab);
  assert.match(text(), /› ID/);
  dialog.handleInput(KEY.tab);
  assert.match(text(), /› Task/);
});

test("dialog: validation errors show inline, move focus, keep the dialog open and clear on edit", () => {
  const checklist = list({ id: "aaa", title: "Alpha" });
  const { dialog, submitted, type, text, closed } = mount(checklist, { id: "aaa" });
  dialog.handleInput(KEY.enter); // duplicate id + empty title
  assert.equal(closed(), 0);
  let screen = text();
  assert.match(screen, /✗ id "aaa" is already used by a task/);
  assert.match(screen, /✗ the task text can't be empty/);
  assert.match(screen, /› ID/, "focus jumps to the first bad field");
  // fix the id (no longer a duplicate) → its error clears on edit
  dialog.handleInput("\x7f");
  assert.doesNotMatch(text(), /already used/);
  type("b");
  dialog.handleInput(KEY.tab);
  type("Now with text");
  assert.doesNotMatch(text(), /can't be empty/);
  dialog.handleInput(KEY.enter);
  assert.equal(closed(), 1);
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].id, "aab");
});

test("dialog: submit is validated against the live checklist, so late changes surface as errors", () => {
  const stale = list({ id: "aaa", title: "Alpha" });
  let live = stale;
  const { dialog, text, closed } = mount(stale, { id: "new", title: "T", current: () => live });
  dialog.handleInput(KEY.tab);
  dialog.handleInput(" "); // depend on aaa
  live = list({ id: "zzz", title: "Replaced by the agent" }); // aaa is gone
  dialog.handleInput(KEY.enter);
  assert.equal(closed(), 0);
  assert.match(text(), /✗ unknown task: aaa/);
  // a full checklist surfaces as a form error
  live = list(...Array.from({ length: MAX_CHECKLIST_TASKS }, (_, n) => ({ title: `T${n}` })));
  dialog.handleInput(" "); // un-pick aaa
  dialog.handleInput(KEY.enter);
  assert.match(text(), /the checklist is full \(10\/10 tasks\)/);
  assert.equal(closed(), 0);
});

test("dialog: Esc and Ctrl+C cancel without submitting", () => {
  for (const key of [KEY.esc, "\x03"]) {
    const { dialog, submitted, closed } = mount(null, { title: "x" });
    dialog.handleInput(key);
    assert.equal(closed(), 1);
    assert.equal(submitted.length, 0);
  }
});

test("dialog: picker windows to the available height and follows the cursor", () => {
  const checklist = list(...Array.from({ length: 10 }, (_, n) => ({ id: `t0${n}`, title: `Task number ${n}` })));
  const { dialog, text, closed } = mount(checklist, { maxRows: 14 });
  dialog.handleInput(KEY.tab);
  const rows = (screen) => screen.split("\n").filter((l) => /\[[ x]\]/.test(l));
  let screen = text();
  assert.ok(dialog.render(70).length <= 14, `height ${dialog.render(70).length}`);
  assert.match(screen, /· 1–\d+ of 10/);
  assert.match(screen, /t00/);
  for (let i = 0; i < 9; i++) dialog.handleInput("j");
  screen = text();
  assert.ok(dialog.render(70).length <= 14);
  assert.match(screen, /t09/, "last row visible after moving to it");
  assert.doesNotMatch(screen, /t00 /);
  assert.match(screen, /of 10/);
  assert.ok(rows(screen).length < 10);
  dialog.handleInput(" ");
  assert.match(text(), /\[x\] .* t09/);
  assert.equal(closed(), 0);
});

test("dialog: every rendered line fits the width, even tiny ones, with errors showing", () => {
  const checklist = list(...Array.from({ length: 4 }, (_, n) => ({ id: `t0${n}`, title: `A rather long task title number ${n} that wraps` })));
  const { dialog } = mount(checklist, { id: "t00" });
  dialog.handleInput(KEY.enter); // errors on
  for (const width of [8, 14, 20, 30, 50, 70, 120]) {
    for (const line of dialog.render(width)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
  }
});

test("dialog implements Focusable: only the visible text input gets the hardware cursor", () => {
  const { dialog, text } = mount(null);
  const CURSOR = "\x1b_pi:c\x07";
  assert.ok(!text().includes(CURSOR));
  dialog.focused = true;
  assert.equal(dialog.focused, true);
  assert.equal(text().split(CURSOR).length - 1, 1);
  dialog.handleInput(KEY.up); // → ID
  assert.equal(text().split(CURSOR).length - 1, 1);
  dialog.focused = false;
  assert.ok(!text().includes(CURSOR));
});

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

test("parseChecklistArgs: add, with and without prefilled text (case preserved)", () => {
  assert.deepEqual(parseChecklistArgs("add"), { name: "add" });
  assert.deepEqual(parseChecklistArgs("  ADD  "), { name: "add" });
  assert.deepEqual(parseChecklistArgs("add Write the README for X"), { name: "add", title: "Write the README for X" });
  assert.deepEqual(parseChecklistArgs("addendum"), { name: "help" });
});

function setup({ checklist = null, mode = "tui", hasUI = true } = {}) {
  let command;
  const state = { checklist, adds: [] };
  const notices = [];
  registerChecklistCommand(
    { registerCommand: (_name, value) => { command = value; } },
    {
      addTask: (draft) => {
        const result = addTask(state.checklist, draft);
        state.adds.push(result);
        if (result.ok) state.checklist = result.checklist;
        return result;
      },
      getChecklist: () => state.checklist,
      getRenderOpts: () => ({ style: "icon", iconSet: "emoji" }),
    },
  );
  let dialog;
  let overlay;
  const ctx = {
    mode,
    hasUI,
    ui: {
      notify: (message, level) => notices.push({ message, level }),
      custom: async (factory, options) => {
        overlay = options;
        await new Promise((resolve) => {
          dialog = factory({ requestRender() {}, terminal: { rows: 40 } }, theme, {}, () => resolve());
          ctx.drive?.(dialog);
        });
      },
    },
  };
  return { command, state, notices, ctx, dialog: () => dialog, overlay: () => overlay };
}

test("/checklist add opens the dialog as a centered overlay and commits through the dep", async () => {
  const base = createOrAppend(null, { tasks: [{ id: "aaa", title: "Alpha" }] }, 1).checklist;
  const t = setup({ checklist: base });
  t.ctx.drive = (dialog) => {
    for (const ch of "Ship it") dialog.handleInput(ch);
    dialog.handleInput("\t"); // → picker
    dialog.handleInput(" "); // aaa
    dialog.handleInput("\r");
  };
  await t.command.handler("add", t.ctx);
  assert.equal(t.overlay().overlay, true);
  assert.equal(t.overlay().overlayOptions.anchor, "center");
  assert.equal(t.state.checklist.tasks.length, 2);
  const added = t.state.checklist.tasks[1];
  assert.match(added.id, /^[a-z0-9]{3}$/);
  assert.deepEqual([added.title, added.status, added.dependsOn], ["Ship it", "planned", ["aaa"]]);
  assert.equal(t.notices.length, 1);
  assert.match(t.notices[0].message, new RegExp(`added ${added.id} "Ship it" \\(depends on aaa\\)`));
});

test("/checklist add <text> prefills the dialog; Esc adds nothing", async () => {
  const t = setup();
  t.ctx.drive = (dialog) => {
    assert.match(dialog.render(70).join("\n"), /Task\s+Prefilled Text/);
    dialog.handleInput("\x1b");
  };
  await t.command.handler("add Prefilled Text", t.ctx);
  assert.equal(t.state.adds.length, 0);
  assert.equal(t.notices.length, 0);
});

test("/checklist add on a full checklist warns and never opens the dialog", async () => {
  const full = createOrAppend(null, { tasks: Array.from({ length: MAX_CHECKLIST_TASKS }, (_, n) => ({ title: `T${n}` })) }, 1).checklist;
  const t = setup({ checklist: full });
  t.ctx.drive = () => assert.fail("dialog must not open");
  await t.command.handler("add", t.ctx);
  assert.equal(t.dialog(), undefined);
  assert.equal(t.notices[0].level, "warning");
  assert.match(t.notices[0].message, /full \(10\/10/);
});

test("/checklist add without a TUI: text adds directly with an auto id, bare add explains", async () => {
  const t = setup({ mode: "print", hasUI: false });
  await t.command.handler("add", t.ctx);
  assert.equal(t.state.adds.length, 0);
  assert.match(t.notices[0].message, /dialog in the TUI/);
  await t.command.handler("add Plain Text Task", t.ctx);
  assert.equal(t.state.checklist.tasks.length, 1);
  assert.equal(t.state.checklist.tasks[0].title, "Plain Text Task");
  assert.match(t.notices[1].message, /added [a-z0-9]{3} "Plain Text Task"/);
});

test("/checklist add is offered in argument completion", () => {
  const t = setup();
  const values = t.command.getArgumentCompletions("a").map((c) => c.value);
  assert.deepEqual(values, ["add"]);
});

// ---------------------------------------------------------------------------
// Full extension wiring: dialog → state → session entry → widget/footer → agent
// ---------------------------------------------------------------------------

test("manual add through the real extension persists, refreshes the widget and reaches the agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "checklist-add-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir; // isolate the global prefs file
  try {
    const events = new Map();
    const tools = new Map();
    const entries = [];
    let command;
    let widget;
    let status;
    extension({
      on: (name, handler) => events.set(name, handler),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (_name, definition) => { command = definition; },
      appendEntry: (_type, snapshot) => entries.push(snapshot),
    });
    const notices = [];
    let drive;
    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager: { getBranch: () => entries.map((data) => ({ type: "custom", customType: "pi-checklist", data })) },
      ui: {
        setWidget: (_key, value) => { widget = value; },
        setStatus: (_key, value) => { status = value; },
        notify: (message, level) => notices.push({ message, level }),
        custom: async (factory) => {
          await new Promise((resolve) => drive(factory({ requestRender() {}, terminal: { rows: 40 } }, theme, {}, () => resolve())));
        },
      },
    };
    await events.get("session_start")({}, ctx);
    assert.equal(status, undefined);

    // 1) the agent creates a list, the human adds a dependent task by hand.
    await tools.get("checklist_create").execute("c", { tasks: [{ id: "aaa", title: "Agent task" }] }, undefined, undefined, ctx);
    const entriesBefore = entries.length;
    drive = (dialog) => {
      for (const ch of "Manual follow-up") dialog.handleInput(ch);
      dialog.handleInput("\t");
      dialog.handleInput(" "); // depends on aaa, which is still planned
      dialog.handleInput("\r");
    };
    await command.handler("add", ctx);

    assert.equal(entries.length, entriesBefore + 1, "one new session entry");
    const snap = entries.at(-1);
    assert.equal(snap.checklist.tasks.length, 2);
    const manual = snap.checklist.tasks[1];
    assert.deepEqual([manual.title, manual.status, manual.dependsOn], ["Manual follow-up", "planned", ["aaa"]]);
    assert.equal(snap.displayMode, "statusbar", "prefs preserved on the snapshot");
    assert.match(status, /0\/2/, "footer counts the new task");
    assert.equal(typeof widget, "function", "widget re-rendered");
    const widgetText = widget({}, theme).render(80).join("\n");
    assert.match(widgetText, /Manual follow-up/);

    // 2) the agent sees it: via checklist_read (blocked on aaa) and the per-turn prompt snippet.
    const read = await tools.get("checklist_read").execute("r", {}, undefined, undefined, ctx);
    assert.match(read.content[0].text, new RegExp(`${manual.id}.*Manual follow-up`));
    assert.match(read.content[0].text, /1 blocked/);
    const prompt = await events.get("before_agent_start")({ systemPrompt: "base" }, ctx);
    assert.match(prompt.systemPrompt, new RegExp(`${manual.id} blocked ← aaa`));

    // 3) it survives branch reconstruction (/resume, /tree).
    await events.get("session_tree")({}, ctx);
    const after = await tools.get("checklist_read").execute("r2", {}, undefined, undefined, ctx);
    assert.match(after.content[0].text, /Manual follow-up/);

    // 4) the agent can work with it like any other task.
    await tools.get("checklist_update").execute("u", { updates: [{ id: "aaa", status: "done" }, { id: manual.id, status: "ongoing" }] }, undefined, undefined, ctx);
    assert.equal(entries.at(-1).checklist.tasks[1].status, "ongoing");
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
