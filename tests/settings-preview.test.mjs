import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerChecklistCommand } from "../dist/commands.js";
import { glyphFor, previewLines } from "../dist/render.js";
import { createChecklistSettingsStore } from "../dist/settings.js";

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

test("settings dialog renders initial preference and toggles subtasks immediately", async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
  const keybindings = { matches: () => false };

  for (const initial of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), "checklist-settings-dialog-"));
    try {
      const store = createChecklistSettingsStore({ agentDir: dir, cwd: dir });
      await store.patch(
        { statusStyle: "icon", iconSet: "emoji", subtasksEnabled: initial },
        { scope: "global", trustedProject: false },
      );
      let enabled = initial;
      let requests = 0;
      const persisted = [];
      let command;
      registerChecklistCommand({ registerCommand: (_name, value) => { command = value; } }, {
        getDisplayMode: () => "statusbar",
        setDisplayMode() {},
        getStatusStyle: () => "icon",
        setStatusStyle() {},
        getIconSet: () => "emoji",
        setIconSet() {},
        getUsage: () => "moderate",
        setUsage() {},
        getSubtasksEnabled: () => enabled,
        setSubtasksEnabled: (value) => { enabled = value; persisted.push(value); },
        getMetaEnabled: () => false,
        setMetaEnabled() {},
        getSettingsStore: () => store,
        getChecklist: () => { throw new Error("Settings dialog must not read session tasks"); },
      });

      await command.handler("settings", {
        hasUI: true,
        mode: "tui",
        cwd: dir,
        ui: {
          notify() {},
          custom: async (factory) =>
            new Promise((resolve) => {
              const screen = factory(
                { requestRender: () => { requests++; }, terminal: { rows: 40 }, mode: "regular" },
                theme,
                keybindings,
                (res) => resolve(res),
              );
              void (async () => {
                const subtasksRow = () =>
                  screen.render(100).find((line) => line.includes("Subtasks")) ?? "";
                assert.match(subtasksRow(), initial ? /\bOn\b/ : /\bOff\b/);
                const preview = () => screen.render(100).join("\n");
                assert.match(preview(), /Write the widget/);
                assert.equal(preview().includes("↳"), initial);

                screen.navigateTo({ field: "subtasksEnabled" });
                screen.handleInput(" ");
                assert.equal(preview().includes("↳"), !initial);
                await flush();
                assert.equal(enabled, !initial);
                assert.match(subtasksRow(), initial ? /\bOff\b/ : /\bOn\b/);
                screen.invalidate();
                assert.match(subtasksRow(), initial ? /\bOff\b/ : /\bOn\b/);
                for (const width of [30, 60, 100]) {
                  assert.ok(screen.render(width).every((line) => visibleWidth(line) <= width));
                }
                screen.handleInput(" ");
                assert.equal(preview().includes("↳"), initial);
                await flush();
                assert.match(subtasksRow(), initial ? /\bOn\b/ : /\bOff\b/);
                assert.deepEqual(persisted, [!initial, initial]);
                assert.ok(requests >= 2);
                screen.handleInput("\u001b");
              })();
            }),
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
