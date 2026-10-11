import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_META_KEYS,
  MAX_META_STRING_LENGTH,
  applyUpdates,
  createOrAppend,
  formatMeta,
  formatTaskLine,
  mergeMeta,
  resolveMetaEnabled,
  viewsOf,
} from "../dist/store.js";
import { ChecklistOverlay, widgetLines, footerText, metaRows } from "../dist/render.js";
import { executeCreate, executeRead, executeUpdate, ChecklistCreateParams, ChecklistUpdateParams } from "../dist/tools.js";
import { parseChecklistArgs, normalizeMetaSetting } from "../dist/commands.js";
import { loadGlobalPrefs, saveGlobalPrefs } from "../dist/prefs.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const THEME = {
  fg: (name, text) => `<${name}>${text}</${name}>`,
  bg: (name, text) => `<bg:${name}>${text}</bg:${name}>`,
  bold: (text) => text,
};
// Markup-free theme: the fake <tag> theme above counts as visible width, which
// would skew column math. Real themes emit zero-width ANSI.
const PLAIN = { fg: (_n, t) => t, bg: (_n, t) => t, bold: (t) => t };
const strip = (l) => l.replace(/<\/?[a-z:A-Z]+>/g, "");

const RIGHT = "\x1b[C";
const DOWN = "\x1b[B";

const ON = { metaEnabled: true, subtasksEnabled: true };
const OFF = { metaEnabled: false, subtasksEnabled: true };
const NOW = 1000;

function one(meta, opts = ON) {
  return createOrAppend(null, { tasks: [{ id: "aaa", title: "Task", meta }] }, NOW, opts).checklist;
}
const metaOf = (c, id = "aaa") => c.tasks.find((t) => t.id === id).meta;

// ---------------------------------------------------------------------------
// Create / update semantics
// ---------------------------------------------------------------------------

test("create accepts meta on tasks and subtasks (string/number/boolean)", () => {
  const { checklist } = createOrAppend(
    null,
    {
      tasks: [
        {
          id: "aaa",
          title: "T",
          meta: { agent: "impl-auth", pr: 42, draft: true },
          subtasks: [{ id: "bbb", title: "S", meta: { owner: "me" } }],
        },
      ],
    },
    NOW,
    ON,
  );
  assert.deepEqual(metaOf(checklist), { agent: "impl-auth", pr: 42, draft: true });
  assert.deepEqual(checklist.tasks[0].subtasks[0].meta, { owner: "me" });
  // Views copy meta (no aliasing with the store).
  const view = viewsOf(checklist)[0];
  view.meta.agent = "changed";
  assert.equal(metaOf(checklist).agent, "impl-auth");
});

test("create skips null values and omits empty meta", () => {
  const c = one({ gone: null });
  assert.equal("meta" in c.tasks[0], false);
  const c2 = one({ keep: 1, gone: null });
  assert.deepEqual(metaOf(c2), { keep: 1 });
});

test("update merges: sets new keys, overwrites, keeps unlisted, null deletes", () => {
  const c0 = one({ a: 1, b: "x", c: true });
  const { checklist: c1, changes } = applyUpdates(c0, [{ id: "aaa", meta: { b: "y", d: 4, c: null } }], NOW + 1, ON);
  assert.deepEqual(metaOf(c1), { a: 1, b: "y", d: 4 });
  assert.ok(changes.some((l) => l.startsWith("aaa meta") && l.includes('b="y"') && l.includes("-c")));
  // Original untouched (all-or-nothing copy semantics).
  assert.deepEqual(metaOf(c0), { a: 1, b: "x", c: true });
  // Deleting the last keys removes meta entirely; deleting an absent key is a no-op.
  const c2 = applyUpdates(c1, [{ id: "aaa", meta: { a: null, b: null, d: null, nope: null } }], NOW + 2, ON).checklist;
  assert.equal("meta" in c2.tasks[0], false);
});

test("meta-only update works without touching status, and bumps updatedAt", () => {
  const c0 = one({ a: 1 });
  const c1 = applyUpdates(c0, [{ id: "aaa", meta: { a: 2 } }], NOW + 5, ON).checklist;
  assert.equal(c1.tasks[0].status, "planned");
  assert.equal(c1.tasks[0].updatedAt, NOW + 5);
  assert.deepEqual(metaOf(c1), { a: 2 });
});

test("subtask meta: patch merges/deletes, adds can carry meta", () => {
  const c0 = createOrAppend(null, { tasks: [{ id: "aaa", title: "T", subtasks: [{ id: "bbb", title: "S", meta: { k: 1, z: 2 } }] }] }, NOW, ON).checklist;
  const c1 = applyUpdates(
    c0,
    [{ id: "aaa", subtasks: [{ id: "bbb", meta: { k: null, n: "v" } }, { id: "ccc", title: "New", meta: { who: "bot" } }] }],
    NOW + 1,
    ON,
  ).checklist;
  const subs = c1.tasks[0].subtasks;
  assert.deepEqual(subs[0].meta, { z: 2, n: "v" });
  assert.deepEqual(subs[1].meta, { who: "bot" });
});

test("batch is all-or-nothing when a later meta payload is invalid", () => {
  const c0 = createOrAppend(null, { tasks: [{ id: "aaa", title: "A" }, { id: "bbb", title: "B" }] }, NOW, ON).checklist;
  assert.throws(() => applyUpdates(c0, [{ id: "aaa", meta: { ok: 1 } }, { id: "bbb", meta: { bad: { x: 1 } } }], NOW + 1, ON), /string, number or boolean/);
  assert.equal("meta" in c0.tasks[0], false);
});

test("done tasks stay frozen, meta included", () => {
  const c0 = createOrAppend(null, { tasks: [{ id: "aaa", title: "A", meta: { k: 1 } }] }, NOW, ON).checklist;
  const done = applyUpdates(c0, [{ id: "aaa", status: "done" }], NOW + 1, ON).checklist;
  assert.throws(() => applyUpdates(done, [{ id: "aaa", meta: { k: 2 } }], NOW + 2, ON), /frozen/);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("value types and limits are validated", () => {
  for (const bad of [{ a: {} }, { a: [1] }, { a: undefined }, { a: Number.NaN }, { a: Infinity }]) {
    assert.throws(() => one(bad), /must be a string, number or boolean/, JSON.stringify(bad));
  }
  assert.throws(() => one({ "": 1 }), /invalid/);
  assert.throws(() => one({ [" ".repeat(3)]: 1 }), /invalid/);
  assert.throws(() => one({ ["k".repeat(41)]: 1 }), /invalid/);
  assert.throws(() => one(JSON.parse('{"__proto__": 1}')), /invalid/);
  assert.throws(() => one({ a: "x".repeat(MAX_META_STRING_LENGTH + 1) }), /too long/);
  assert.doesNotThrow(() => one({ a: "x".repeat(MAX_META_STRING_LENGTH) }));
  assert.throws(() => one(["a"]), /must be an object/);
  assert.throws(() => one("nope"), /must be an object/);
  const many = Object.fromEntries(Array.from({ length: MAX_META_KEYS + 1 }, (_, i) => [`k${i}`, i]));
  assert.throws(() => one(many), /at most/);
  // Keys are trimmed.
  assert.deepEqual(metaOf(one({ " pad ": 1 })), { pad: 1 });
});

test("mergeMeta is pure", () => {
  const before = { a: 1 };
  const { meta, parts } = mergeMeta(before, { a: 2, b: null }, "task x");
  assert.deepEqual(before, { a: 1 });
  assert.deepEqual(meta, { a: 2 });
  assert.deepEqual(parts, ["a=2"]);
});

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

test("non-empty meta is rejected while the preview is off; empty meta is a no-op", () => {
  assert.throws(() => one({ a: 1 }, OFF), /task meta is a preview feature \(disabled\)/);
  assert.throws(
    () => createOrAppend(null, { tasks: [{ title: "T", subtasks: [{ title: "S", meta: { a: 1 } }] }] }, NOW, OFF),
    /task meta is a preview feature/,
  );
  const bare = createOrAppend(null, { tasks: [{ id: "aaa", title: "A", subtasks: [{ id: "bbb", title: "S" }] }] }, NOW, OFF).checklist;
  assert.throws(() => applyUpdates(bare, [{ id: "aaa", meta: { a: 1 } }], NOW + 1, OFF), /preview feature/);
  assert.throws(() => applyUpdates(bare, [{ id: "aaa", subtasks: [{ id: "bbb", meta: { a: 1 } }] }], NOW + 1, OFF), /preview feature/);
  assert.doesNotThrow(() => one({}, OFF));
  assert.doesNotThrow(() => applyUpdates(bare, [{ id: "aaa", status: "ongoing", meta: {} }], NOW + 1, OFF));
});

test("stored meta survives the preview being switched off, and is hidden from tool text", () => {
  const c = one({ agent: "x" });
  const off = executeRead(c, {}, undefined, undefined, true, false);
  assert.ok(!off.text.includes("agent"));
  assert.equal(metaOf(applyUpdates(c, [{ id: "aaa", status: "ongoing" }], NOW + 1, OFF).checklist).agent, "x");
  const on = executeRead(c, {}, undefined, undefined, true, true);
  assert.ok(on.text.includes('{agent="x"}'), on.text);
  assert.equal(on.snapshot.metaEnabled, true);
});

test("tool executors thread metaEnabled and report meta changes", () => {
  const created = executeCreate(null, undefined, { tasks: [{ id: "aaa", title: "T", meta: { a: 1 } }] }, undefined, undefined, undefined, true, true);
  assert.deepEqual(metaOf(created.snapshot.checklist), { a: 1 });
  assert.equal(created.snapshot.metaEnabled, true);
  const updated = executeUpdate(created.snapshot.checklist, undefined, { updates: [{ id: "aaa", meta: { a: null, b: "z" } }] }, undefined, undefined, undefined, true, true);
  assert.ok(updated.text.includes("aaa meta"), updated.text);
  assert.ok(updated.text.includes("-a"), updated.text);
  assert.deepEqual(metaOf(updated.snapshot.checklist), { b: "z" });
  assert.throws(() => executeUpdate(created.snapshot.checklist, undefined, { updates: [{ id: "aaa", meta: { a: 2 } }] }, undefined, undefined, undefined, true, false), /preview/);
});

test("formatMeta / formatTaskLine", () => {
  assert.equal(formatMeta(undefined), "");
  assert.equal(formatMeta({ a: "x", n: 1, t: false }), '{a="x", n=1, t=false}');
  const c = createOrAppend(null, { tasks: [{ id: "aaa", title: "T", meta: { a: 1 }, subtasks: [{ id: "bbb", title: "S", meta: { b: 2 } }] }] }, NOW, ON).checklist;
  const [v] = viewsOf(c);
  assert.ok(!formatTaskLine(v).includes("{"));
  const line = formatTaskLine(v, true);
  assert.ok(line.includes("{a=1}") && line.includes("{b=2}"), line);
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

test("tool schemas expose meta (create: values only; update: null allowed)", () => {
  const create = JSON.stringify(ChecklistCreateParams);
  const update = JSON.stringify(ChecklistUpdateParams);
  assert.ok(create.includes('"meta"') && update.includes('"meta"'));
  assert.ok(!create.includes('"null"'), "create meta has no null values");
  assert.ok(update.includes('"null"'), "update meta allows null");
});

// ---------------------------------------------------------------------------
// Settings plumbing
// ---------------------------------------------------------------------------

test("settings: resolve, quick-set parsing, global prefs", () => {
  assert.equal(resolveMetaEnabled({ v: 1, checklist: null }), false);
  assert.equal(resolveMetaEnabled({ v: 1, checklist: null, metaEnabled: true }), true);
  assert.equal(normalizeMetaSetting("meta"), true);
  assert.equal(normalizeMetaSetting("no-meta"), false);
  assert.equal(normalizeMetaSetting("on"), undefined, "bare on/off stay with subtasks");
  assert.deepEqual(parseChecklistArgs("settings meta"), { name: "settings", displayMode: undefined, statusStyle: undefined, iconSet: undefined, usage: undefined, subtasksEnabled: undefined, metaEnabled: true });
  assert.equal(parseChecklistArgs("settings no-meta subtasks").metaEnabled, false);
  assert.equal(parseChecklistArgs("settings no-meta subtasks").subtasksEnabled, true);
  assert.equal(parseChecklistArgs("settings meta meta").name, "help");
  const dir = mkdtempSync(join(tmpdir(), "pi-checklist-meta-"));
  assert.equal(loadGlobalPrefs(dir).metaEnabled, undefined);
  saveGlobalPrefs({ metaEnabled: true }, dir);
  assert.equal(loadGlobalPrefs(dir).metaEnabled, true);
  saveGlobalPrefs({ metaEnabled: false }, dir);
  assert.equal(loadGlobalPrefs(dir).metaEnabled, false);
});

// ---------------------------------------------------------------------------
// TUI: dialog shows aligned meta; widget/footer never do
// ---------------------------------------------------------------------------

function sample() {
  return createOrAppend(
    null,
    {
      tasks: [
        { id: "aaa", title: "Parent", meta: { agent: "impl-auth", pr: 42, draft: false }, subtasks: [{ id: "bbb", title: "Sub", meta: { owner: "me" } }] },
        { id: "ccc", title: "Plain" },
      ],
    },
    NOW,
    ON,
  ).checklist;
}

test("dialog shows aligned meta rows only when enabled", () => {
  const checklist = sample();
  const off = new ChecklistOverlay(checklist, PLAIN, { onClose() {}, requestRender() {} }, undefined, false).render(100).map(strip);
  assert.ok(!off.some((l) => l.includes("agent:")), "no meta when disabled");

  const on = new ChecklistOverlay(checklist, PLAIN, { onClose() {}, requestRender() {} }, undefined, true).render(100).map(strip);
  const rows = on.filter((l) => /(agent|pr|draft):/.test(l));
  assert.equal(rows.length, 3);
  // Values line up in one column; keys line up at the same indent.
  const valueCols = rows.map((l) => l.search(/impl-auth|42|false/));
  assert.equal(new Set(valueCols).size, 1, `values aligned: ${rows.join("|")}`);
  const keyCols = rows.map((l) => l.search(/(agent|pr|draft):/));
  assert.equal(new Set(keyCols).size, 1, "keys aligned");
  // Meta sits directly under its task row and before the next task.
  const iParent = on.findIndex((l) => l.includes("aaa"));
  const iPlain = on.findIndex((l) => l.includes("ccc"));
  assert.ok(iParent < on.findIndex((l) => l.includes("agent:")) && on.findIndex((l) => l.includes("draft:")) < iPlain);
  // Meta indent lines up with the id column of the task row.
  assert.equal(keyCols[0], on[iParent].indexOf("aaa"));
  // Subtask meta is hidden while collapsed.
  assert.ok(!on.some((l) => l.includes("owner:")));
});

test("meta rows are not selectable and do not disturb expand/collapse navigation", () => {
  const overlay = new ChecklistOverlay(sample(), PLAIN, { onClose() {}, requestRender() {} }, undefined, true);
  const lines = () => overlay.render(100).map(strip);
  const cursorLine = () => lines().filter((l) => l.includes("›"));
  assert.ok(cursorLine()[0].includes("aaa"));
  overlay.handleInput(RIGHT); // expand
  assert.ok(lines().some((l) => l.includes("owner:")), "subtask meta appears when expanded");
  overlay.handleInput(DOWN); // → subtask row, not a meta row
  assert.equal(cursorLine().length, 1);
  assert.ok(cursorLine()[0].includes("bbb"), cursorLine()[0]);
  overlay.handleInput(DOWN);
  assert.ok(cursorLine()[0].includes("ccc"), cursorLine()[0]);
  overlay.handleInput("h"); // no-op on plain task
  overlay.handleInput("k");
  overlay.handleInput("k");
  overlay.handleInput("h"); // collapse parent
  assert.ok(!lines().some((l) => l.includes("owner:")));
  assert.ok(lines().some((l) => l.includes("agent:")), "task meta stays under the task");
});

test("meta never shows in the widget or footer", () => {
  const checklist = sample();
  const text = JSON.stringify(widgetLines(checklist)) + footerText(checklist);
  assert.ok(!/impl-auth|agent|owner/.test(text));
});

test("metaRows sanitizes control chars and skips non-primitive values", () => {
  const rows = metaRows({ "a\nb": "x\ny", ok: 1, bad: { z: 1 }, arr: [1] }, "  ", THEME).map(strip);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !r.includes("\n")));
  assert.deepEqual(metaRows(undefined, "", THEME), []);
});

// ---------------------------------------------------------------------------
// Height-aware dialog: pi-tui slices overlay lines to maxHeight (no scroll)
// ---------------------------------------------------------------------------

function tall() {
  const tenKeys = () => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`key${i}`, `val${i}`]));
  return createOrAppend(
    null,
    { tasks: [{ id: "aaa", title: "First", meta: tenKeys() }, { id: "bbb", title: "Second", meta: tenKeys() }, { id: "ccc", title: "Third" }] },
    NOW,
    ON,
  ).checklist;
}

test("dialog fits maxRows with meta, keeps borders/footer, and scrolls with the selection", () => {
  // 24-row terminal → pi-tui maxHeight = floor(24 * 0.7) = 16 rows.
  const MAX = 16;
  const overlay = new ChecklistOverlay(tall(), PLAIN, { onClose() {}, requestRender() {}, getMaxRows: () => MAX }, undefined, true);
  const check = () => {
    const lines = overlay.render(100);
    assert.ok(lines.length <= MAX, `fits: ${lines.length} <= ${MAX}`);
    assert.ok(lines[0].startsWith("╭") && lines.at(-1).startsWith("╰"), "borders visible");
    assert.ok(lines.at(-2).includes("Esc/q to close"), "footer hint visible");
    const sel = lines.filter((l) => l.includes("›"));
    assert.equal(sel.length, 1, "selected row is visible");
    return lines;
  };
  let lines = check();
  // Budget = 16 − 6 chrome rows = 10; the selected task's block (row + 10 meta) is 11, so it is
  // clipped to the row + 8 meta rows + an explicit "… +2 more" marker.
  assert.ok(lines.some((l) => l.includes("aaa")) && lines.some((l) => l.includes("key7:")) && !lines.some((l) => l.includes("key8:")));
  assert.ok(lines.some((l) => l.includes("… +2 more")), "clipped meta is announced");
  assert.ok(!lines.some((l) => l.includes("ccc")), "later rows are windowed out");
  assert.ok(lines.some((l) => l.includes("rows 1–")), "header reports the visible range");
  overlay.handleInput(DOWN);
  lines = check();
  assert.ok(lines.find((l) => l.includes("›")).includes("bbb"));
  overlay.handleInput(DOWN);
  lines = check();
  assert.ok(lines.find((l) => l.includes("›")).includes("ccc"), "can reach the last row");
  overlay.handleInput("k");
  overlay.handleInput("k");
  lines = check();
  assert.ok(lines.find((l) => l.includes("›")).includes("aaa"), "scrolls back up");
});

test("dialog without a height limit renders everything; a tiny budget still keeps the selected row", () => {
  const full = new ChecklistOverlay(tall(), PLAIN, { onClose() {}, requestRender() {} }, undefined, true).render(100);
  assert.ok(full.some((l) => l.includes("ccc")) && full.filter((l) => /key\d:/.test(l)).length === 20);
  const tiny = new ChecklistOverlay(tall(), PLAIN, { onClose() {}, requestRender() {}, getMaxRows: () => 3 }, undefined, true).render(100);
  assert.ok(tiny.some((l) => l.includes("›") && l.includes("aaa")));
});

test("dialog re-windows when the terminal height changes", () => {
  let max = 40;
  const overlay = new ChecklistOverlay(tall(), PLAIN, { onClose() {}, requestRender() {}, getMaxRows: () => max }, undefined, true);
  const big = overlay.render(100).length;
  max = 12;
  const small = overlay.render(100).length;
  assert.ok(small <= 12 && small < big, `${small} < ${big}`);
});
