import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerChecklistCommand } from "../dist/commands.js";
import { glyphFor, previewLines } from "../dist/render.js";

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };

for (const style of ["color", "pill", "icon"]) {
  for (const iconSet of ["emoji", "nerd-font"]) {
    test(`preview shows 2 + 1 staged children only when enabled (${style}/${iconSet})`, () => {
      const opts = { style, iconSet };
      const off = previewLines(theme, opts, false);
      assert.deepEqual(previewLines(theme, opts), off);
      assert.equal(off.length, 5);
      assert.ok(off.every((line) => !line.includes("↳")));
      const on = previewLines(theme, opts, true);
      assert.equal(on.length, 8);
      assert.deepEqual(on.filter((line) => !line.includes("↳")), off);
      for (const [index, kind, title] of [
        [1, "done", "Design the layout"],
        [2, "ongoing", "Render task rows"],
        [4, "ready", "Document settings"],
      ]) {
        assert.ok(on[index].startsWith("  ↳ "));
        assert.ok(on[index].includes(`${glyphFor(kind, opts)} abc ${title}`));
      }
      if (style === "pill") {
        assert.match(on[1], /DONE/);
        assert.match(on[2], /PROG/);
        assert.match(on[4], /REDY/);
      }
      assert.deepEqual(previewLines(theme, opts, false), off);
    });
  }
}

test("settings renders initial preference and toggles demo children immediately", async () => {
  // SettingsList's theme factory requires Pi's active theme, like the real TUI.
  initTheme();
  for (const initial of [false, true]) {
    let enabled = initial;
    let screen;
    let requests = 0;
    const persisted = [];
    let command;
    registerChecklistCommand({ registerCommand: (_name, value) => { command = value; } }, {
      getDisplayMode: () => "statusbar",
      getStatusStyle: () => "icon",
      getIconSet: () => "emoji",
      getUsage: () => "moderate",
      getSubtasksEnabled: () => enabled,
      setSubtasksEnabled: (value) => { enabled = value; persisted.push(value); },
      getChecklist: () => { throw new Error("Settings preview must not read session tasks"); },
    });
    await command.handler("settings", {
      hasUI: true,
      mode: "tui",
      ui: {
        notify() {},
        custom: async (factory) => {
          screen = factory({ requestRender: () => { requests++; } }, theme, {}, () => {});
        },
      },
    });
    const children = () => screen.render(100).filter((line) => line.includes("↳"));
    assert.equal(children().length, initial ? 3 : 0);
    for (let i = 0; i < 4; i++) screen.handleInput("\u001b[B");
    screen.handleInput(" ");
    assert.equal(enabled, !initial);
    assert.equal(children().length, initial ? 0 : 3);
    screen.invalidate();
    assert.equal(children().length, initial ? 0 : 3);
    for (const width of [30, 60, 100]) {
      assert.ok(screen.render(width).every((line) => visibleWidth(line) <= width));
    }
    screen.handleInput(" ");
    assert.equal(children().length, initial ? 3 : 0);
    assert.deepEqual(persisted, [!initial, initial]);
    assert.equal(requests, 2);
  }
});
