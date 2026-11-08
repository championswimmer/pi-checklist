import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";

import extension from "../dist/index.js";
import { normalizeDisplayMode, parseChecklistArgs } from "../dist/commands.js";
import { footerText, widgetLines } from "../dist/render.js";
import { loadGlobalPrefs, saveGlobalPrefs } from "../dist/prefs.js";
import { createOrAppend, resolveDisplayMode } from "../dist/store.js";
import { DISPLAY_MODES, isDisplayMode } from "../dist/types.js";

const checklist = createOrAppend(null, { title: "Release", tasks: [
  { id: "aaa", title: "Finished" },
  { id: "bbb", title: "In progress" },
  { id: "ccc", title: "Ready" },
  { id: "ddd", title: "Blocked", dependsOn: "ccc" },
] }, 1).checklist;
checklist.tasks[0].status = "done";
checklist.tasks[1].status = "ongoing";

test("status-minimal is validated, parsed, and restored from snapshots", () => {
  assert.ok(DISPLAY_MODES.includes("status-minimal"));
  assert.ok(isDisplayMode("status-minimal"));
  assert.equal(normalizeDisplayMode("STATUS_MINIMAL"), "status-minimal");
  assert.equal(parseChecklistArgs("settings status-minimal").displayMode, "status-minimal");
  assert.equal(resolveDisplayMode({ v: 1, checklist, displayMode: "status-minimal" }), "status-minimal");
});

const opts = { style: "pill", iconSet: "emoji" };

test("minimal footer shares the compact widget summary, without title or task rows", () => {
  const summary = footerText(checklist, opts);
  assert.equal(summary, widgetLines({ ...checklist, title: undefined }, opts)[0].text);
  assert.equal(summary, "☑️ 1/4 ✅ 1 🔄 1 ▶️ 1 ⛔ 1");
  assert.equal(footerText(null, opts), undefined);
  assert.equal(footerText({ tasks: [] }, opts), undefined);
});

test("minimal mode persists globally and remains footer-only across turns and switches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "checklist-display-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    saveGlobalPrefs({ displayMode: "status-minimal", iconSet: "emoji" });
    assert.equal(loadGlobalPrefs().displayMode, "status-minimal");
    const events = new Map();
    const tools = new Map();
    const entries = [];
    let command;
    let widget;
    let status;
    let statusKey;
    extension({
      on: (name, handler) => events.set(name, handler),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (_name, definition) => { command = definition; },
      appendEntry: (_type, snapshot) => entries.push(snapshot),
    });
    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager: { getBranch: () => [{ type: "custom", customType: "pi-checklist", data: { v: 1, checklist, displayMode: "statusbar" } }] },
      ui: {
        setWidget: (_key, value) => { widget = value; },
        theme: { fg: (name, text) => `<${name}>${text}</${name}>` },
        setStatus: (key, value) => { statusKey = key; status = value; },
        notify() {},
        confirm: async () => true,
      },
    };
    const assertMinimal = () => {
      assert.equal(widget, undefined);
      assert.equal(statusKey, "checklist");
      assert.equal(status, footerText(checklist, opts, ctx.ui.theme));
    };
    for (const event of ["session_start", "turn_start", "turn_end", "agent_settled", "session_tree"]) {
      await events.get(event)({}, ctx);
      assertMinimal();
    }
    initTheme();
    let screen;
    ctx.ui.custom = async (factory) => { screen = factory({ requestRender() {} }, { fg: (_c, s) => s, bg: (_c, s) => s, bold: (s) => s }, {}, () => {}); };
    await command.handler("settings", ctx);
    screen.handleInput(" "); // widget on, footer remains on
    assert.equal(typeof widget, "function");
    assert.ok(status);
    screen.handleInput("\u001b[B");
    screen.handleInput(" "); // footer off, widget remains on
    assert.equal(typeof widget, "function");
    assert.equal(status, undefined);
    assert.equal(loadGlobalPrefs().displayMode, "widget-only");
    await events.get("session_tree")({}, ctx);
    assert.equal(typeof widget, "function");
    assert.equal(status, undefined);
    screen.handleInput("\u001b[A");
    screen.handleInput(" "); // both off
    assert.equal(widget, undefined);
    assert.equal(status, undefined);
    screen.handleInput("\u001b[B");
    screen.handleInput(" "); // footer only
    assertMinimal();
    await command.handler("settings statusbar", ctx);
    assert.equal(typeof widget, "function");
    assert.equal(status, footerText(checklist, opts, ctx.ui.theme));
    await command.handler("settings status-minimal", ctx);
    assertMinimal();
    assert.equal(entries.at(-1).displayMode, "status-minimal");
    assert.equal(loadGlobalPrefs().displayMode, "status-minimal");
    await tools.get("checklist_update").execute("update", { updates: [{ id: "bbb", status: "done" }] }, undefined, undefined, ctx);
    assert.equal(widget, undefined);
    assert.equal(status, "<accent>☑️ 2/4</accent> <success>✅ 2</success> <text>▶️ 1</text> <error>⛔ 1</error>");
    await command.handler("hide", ctx);
    assert.equal(widget, undefined);
    assert.equal(status, undefined);
    await command.handler("settings end-of-turn", ctx);
    assert.equal(typeof widget, "function");
    await events.get("turn_start")({}, ctx);
    assert.equal(widget, undefined);
    await command.handler("settings status-minimal", ctx);
    assert.equal(status, "<accent>☑️ 2/4</accent> <success>✅ 2</success> <text>▶️ 1</text> <error>⛔ 1</error>");
    assert.equal(widget, undefined);
    await command.handler("clear", ctx);
    assert.equal(status, undefined);
    assert.equal(widget, undefined);
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
