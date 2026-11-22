import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import extension from "../dist/index.js";
import { loadGlobalPrefs, prefsFilePath, saveGlobalPrefs } from "../dist/prefs.js";
import {
  CHECKLIST_SETTINGS_FILE,
  checklistSettingsSchema,
  createChecklistSettingsStore,
  loadChecklistSettings,
  loadEffectiveSettingsSync,
  preferencesForSettings,
} from "../dist/settings.js";

const PLAIN_THEME = { fg: (_c, s) => s, bg: (_c, s) => s, bold: (s) => s };
const KEYBINDINGS = { matches: () => false };
const flush = () => new Promise((resolve) => setTimeout(resolve, 15));

function withTempDirs(fn) {
  const root = mkdtempSync(join(tmpdir(), "pi-checklist-migration-"));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return Promise.resolve()
    .then(() => fn({ root, agentDir, projectDir }))
    .finally(() => {
      if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      rmSync(root, { recursive: true, force: true });
    });
}

test("legacy v1 pi-checklist.json loads with zero warnings and accurate provenance", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    const legacyPath = join(agentDir, CHECKLIST_SETTINGS_FILE);
    assert.equal(prefsFilePath(agentDir), legacyPath);

    // Exact format written by pi-checklist <= 3.3.0
    writeFileSync(
      legacyPath,
      JSON.stringify(
        {
          v: 1,
          displayMode: "status-minimal",
          statusStyle: "pill", // default
          iconSet: "emoji",
          usage: "aggressive",
          subtasksEnabled: true,
          metaEnabled: false, // default
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const store = createChecklistSettingsStore({ agentDir, cwd: projectDir });
    const loaded = await store.load({ trustedProject: false });

    assert.deepEqual(loaded.warnings, []);
    assert.deepEqual(preferencesForSettings(loaded.effective), {
      displayMode: "status-minimal",
      statusStyle: "pill",
      iconSet: "emoji",
      usage: "aggressive",
      subtasksEnabled: true,
      metaEnabled: false,
    });
    // Only non-default legacy keys should show as global overrides
    assert.equal(loaded.provenance.widgetDisplay, "global");
    assert.equal(loaded.provenance.footerEnabled, "default");
    assert.equal(loaded.provenance.iconSet, "global");
    assert.equal(loaded.provenance.usage, "global");
    assert.equal(loaded.provenance.subtasksEnabled, "global");
    assert.equal(loaded.provenance.statusStyle, "default");
    assert.equal(loaded.provenance.metaEnabled, "default");

    // Sync loader matches async store
    assert.deepEqual(loadEffectiveSettingsSync(agentDir), loaded.effective);
  });
});

test("legacy widgetVisible: false migrates to displayMode: hidden", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    writeFileSync(
      join(agentDir, CHECKLIST_SETTINGS_FILE),
      JSON.stringify({ v: 1, widgetVisible: false, iconSet: "emoji" }) + "\n",
      "utf8",
    );

    const store = createChecklistSettingsStore({ agentDir, cwd: projectDir });
    const loaded = await store.load({ trustedProject: false });
    assert.deepEqual(loaded.warnings, []);
    assert.equal(preferencesForSettings(loaded.effective).displayMode, "hidden");
    assert.equal(loaded.effective.iconSet, "emoji");
  });
});

for (const [mode, displayOverrides] of [
  ["statusbar", {}],
  ["widget-only", { footerEnabled: false }],
  ["status-minimal", { widgetDisplay: "off" }],
  ["end-of-turn", { widgetDisplay: "end-of-turn" }],
  ["hidden", { widgetDisplay: "off", footerEnabled: false }],
]) {
  test(`session startup rewrites legacy ${mode} settings once`, async () => {
    await withTempDirs(async ({ agentDir, projectDir }) => {
      const file = prefsFilePath(agentDir);
      writeFileSync(file, JSON.stringify({
        v: 1,
        displayMode: mode,
        iconSet: "emoji",
        statusStyle: "icon",
        usage: "aggressive",
        subtasksEnabled: true,
        metaEnabled: true,
      }));
      const events = new Map();
      extension({
        on: (name, handler) => events.set(name, handler),
        registerTool() {},
        registerCommand() {},
      });
      const ctx = {
        hasUI: false,
        mode: "print",
        cwd: projectDir,
        sessionManager: { getBranch: () => [] },
      };
      await events.get("session_start")({}, ctx);
      assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
        ...displayOverrides,
        iconSet: "emoji",
        statusStyle: "icon",
        usage: "aggressive",
        subtasksEnabled: true,
        metaEnabled: true,
      });
      assert.equal(preferencesForSettings(loadEffectiveSettingsSync(agentDir)).displayMode, mode);
      const initialInode = statSync(file).ino;
      await events.get("session_start")({}, ctx);
      assert.equal(statSync(file).ino, initialInode);
    });
  });
}

test("SettingsStore writes only non-default overrides and keeps an empty global file after reset", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    const filePath = join(agentDir, CHECKLIST_SETTINGS_FILE);
    const store = createChecklistSettingsStore({ agentDir, cwd: projectDir });
    await store.patch(
      { widgetDisplay: "end-of-turn", statusStyle: "icon", iconSet: "emoji", metaEnabled: true },
      { scope: "global", trustedProject: false },
    );

    assert.ok(existsSync(filePath));
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    assert.deepEqual(onDisk, {
      widgetDisplay: "end-of-turn",
      statusStyle: "icon",
      iconSet: "emoji",
      metaEnabled: true,
    });
    assert.deepEqual(loadGlobalPrefs(agentDir), {
      displayMode: "end-of-turn",
      statusStyle: "icon",
      iconSet: "emoji",
      metaEnabled: true,
    });

    await store.restoreDefaults({ scope: "global", trustedProject: false });
    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), {});
    assert.deepEqual(loadEffectiveSettingsSync(agentDir), checklistSettingsSchema.getDefaults());
  });
});

test("corrupt or invalid pi-checklist.json degrades safely without breaking extension startup", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    const filePath = join(agentDir, CHECKLIST_SETTINGS_FILE);
    // Unparseable JSON
    writeFileSync(filePath, "{ not valid json", "utf8");
    assert.deepEqual(loadGlobalPrefs(agentDir), {});
    assert.deepEqual(loadEffectiveSettingsSync(agentDir), checklistSettingsSchema.getDefaults());

    // Valid JSON with invalid enum value + secret key
    writeFileSync(
      filePath,
      JSON.stringify({ v: 1, displayMode: "bogus", iconSet: "emoji", apiKey: "secret-123" }) + "\n",
      "utf8",
    );
    const store = createChecklistSettingsStore({ agentDir, cwd: projectDir });
    const loaded = await loadChecklistSettings(store, false, true);
    assert.equal(preferencesForSettings(loaded.effective).displayMode, "statusbar");
    assert.equal(loaded.effective.iconSet, "emoji");
    assert.ok(loaded.warnings.some((w) => w.includes("apiKey")));
    assert.ok(loaded.warnings.some((w) => w.includes("displayMode")));
    assert.equal(JSON.parse(readFileSync(filePath, "utf8")).v, 1);
  });
});

test("a failed legacy rewrite still loads global and trusted project preferences", async () => {
  const store = createChecklistSettingsStore({
    adapter: {
      async readLayer(scope) {
        const data = scope === "global"
          ? { v: 1, displayMode: "status-minimal", iconSet: "emoji" }
          : { usage: "aggressive" };
        return { data, exists: true, hash: scope };
      },
      async writeLayer() {
        throw new Error("Read-only file");
      },
    },
  });
  const loaded = await loadChecklistSettings(store, true, true);
  assert.equal(preferencesForSettings(loaded.effective).displayMode, "status-minimal");
  assert.equal(loaded.effective.iconSet, "emoji");
  assert.equal(loaded.effective.usage, "aggressive");
  assert.deepEqual(loaded.warnings, ["Could not rewrite legacy settings: Read-only file"]);
});

test("trusted project overrides apply over global while untrusted project overrides are ignored", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    saveGlobalPrefs({ displayMode: "statusbar", iconSet: "emoji", usage: "moderate" }, agentDir);
    const projectPiDir = join(projectDir, ".pi");
    mkdirSync(projectPiDir, { recursive: true });
    const projectPath = join(projectPiDir, CHECKLIST_SETTINGS_FILE);
    const projectLegacy = JSON.stringify({ displayMode: "widget-only", usage: "aggressive", subtasksEnabled: true }) + "\n";
    writeFileSync(projectPath, projectLegacy, "utf8");

    const runSession = async (trusted) => {
      const events = new Map();
      const tools = new Map();
      let command;
      let widget;
      let status;
      const notices = [];
      extension({
        on: (name, handler) => events.set(name, handler),
        registerTool: (tool) => tools.set(tool.name, tool),
        registerCommand: (_name, def) => { command = def; },
        appendEntry() {},
      });
      const ctx = {
        hasUI: true,
        mode: "tui",
        cwd: projectDir,
        isProjectTrusted: () => trusted,
        sessionManager: { getBranch: () => [] },
        ui: {
          theme: PLAIN_THEME,
          setWidget: (_k, v) => { widget = v; },
          setStatus: (_k, v) => { status = v; },
          notify: (msg, level) => notices.push({ msg, level }),
          confirm: async () => true,
        },
      };
      await events.get("session_start")({}, ctx);
      await tools.get("checklist_create").execute("c", { tasks: [{ title: "T1" }] }, undefined, undefined, ctx);
      const prompt = await events.get("before_agent_start")({ systemPrompt: "base" }, ctx);
      return { events, tools, command, ctx, getWidget: () => widget, getStatus: () => status, prompt, notices };
    };

    // Untrusted project: ignores .pi/pi-checklist.json
    const untrusted = await runSession(false);
    assert.equal(typeof untrusted.getWidget(), "function");
    assert.ok(untrusted.getStatus(), "footer shown in global statusbar mode");
    assert.match(untrusted.prompt.systemPrompt, /Checklist available:/);
    assert.match(untrusted.prompt.systemPrompt, /Tasks have no subtasks\./);
    assert.equal(readFileSync(projectPath, "utf8"), projectLegacy);

    // Trusted project: applies .pi/pi-checklist.json (widget-only, aggressive, subtasks)
    const trusted = await runSession(true);
    assert.equal(typeof trusted.getWidget(), "function");
    assert.equal(trusted.getStatus(), undefined, "footer hidden in project widget-only mode");
    assert.match(trusted.prompt.systemPrompt, /Checklist expected:/);
    assert.match(trusted.prompt.systemPrompt, /up to 3 subtasks/);
    assert.deepEqual(JSON.parse(readFileSync(projectPath, "utf8")), {
      footerEnabled: false,
      usage: "aggressive",
      subtasksEnabled: true,
    });

    // Mid-session usage change via quick-set persists but does not rewrite current session's system prompt
    await trusted.command.handler("settings moderate", trusted.ctx);
    const promptAfterChange = await trusted.events.get("before_agent_start")({ systemPrompt: "base" }, trusted.ctx);
    assert.match(promptAfterChange.systemPrompt, /Checklist expected:/);
    assert.ok(trusted.notices.some((n) => n.msg.includes("/reload")));

    // Quick-set updated the project override because `usage` was overridden in project scope
    const projectAfter = JSON.parse(readFileSync(join(projectPiDir, CHECKLIST_SETTINGS_FILE), "utf8"));
    assert.equal(projectAfter.usage, undefined, "moderate matches global so project override was removed");
    await trusted.events.get("session_start")({}, trusted.ctx);
    const promptNextSession = await trusted.events.get("before_agent_start")({ systemPrompt: "base" }, trusted.ctx);
    assert.match(promptNextSession.systemPrompt, /Checklist available:/);
  });
});

test("RPC mode runs pi-extension-settings-tui menu fallback and applies changes live", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    const events = new Map();
    const tools = new Map();
    const entries = [];
    let command;
    const notices = [];
    extension({
      on: (name, handler) => events.set(name, handler),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (_name, def) => { command = def; },
      appendEntry: (_type, data) => entries.push(data),
    });

    const selectCalls = [];
    const responses = [
      (items) => items.find((item) => item.startsWith("Task meta:")),
      (items) => items.find((item) => item === "Enabled"),
      (items) => items.find((item) => item === "Done"),
    ];
    const ctx = {
      hasUI: true,
      mode: "rpc",
      cwd: projectDir,
      isProjectTrusted: () => false,
      sessionManager: { getBranch: () => [] },
      ui: {
        theme: PLAIN_THEME,
        setWidget() {},
        setStatus() {},
        notify: (msg, level) => notices.push({ msg, level }),
        confirm: async () => true,
        select: async (title, items) => {
          selectCalls.push({ title, items });
          const pick = responses.shift();
          return pick ? pick(items) : undefined;
        },
      },
    };

    await events.get("session_start")({}, ctx);
    await command.handler("settings", ctx);

    assert.equal(selectCalls.length, 3);
    assert.equal(loadGlobalPrefs(agentDir).metaEnabled, true);
    assert.equal(entries.at(-1).metaEnabled, true);

    const prompt = await events.get("before_agent_start")({ systemPrompt: "base" }, ctx);
    assert.match(prompt.systemPrompt, /meta object/);
  });
});

test("pressing s in /checklist overlay opens pi-extension-settings-tui dialog and notifies on usage change", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    const events = new Map();
    let command;
    const notices = [];
    extension({
      on: (name, handler) => events.set(name, handler),
      registerTool() {},
      registerCommand: (_name, def) => { command = def; },
      appendEntry() {},
    });

    let customCalls = 0;
    const ctx = {
      hasUI: true,
      mode: "tui",
      cwd: projectDir,
      isProjectTrusted: () => false,
      sessionManager: { getBranch: () => [] },
      ui: {
        theme: PLAIN_THEME,
        setWidget() {},
        setStatus() {},
        notify: (msg, level) => notices.push({ msg, level }),
        confirm: async () => true,
        custom: async (factory) =>
          new Promise((resolve) => {
            customCalls++;
            const comp = factory(
              { requestRender() {}, terminal: { rows: 40 }, mode: "regular" },
              PLAIN_THEME,
              KEYBINDINGS,
              (res) => resolve(res),
            );
            if (customCalls === 1) {
              // ChecklistOverlay: press `s` to jump to settings
              comp.handleInput("s");
            } else {
              // Move down to Usage guidance, toggle, and close.
              void (async () => {
                for (let i = 0; i < 4; i++) comp.handleInput("\u001b[B");
                comp.handleInput("\u001b[C");
                await flush();
                comp.handleInput("\u001b");
              })();
            }
          }),
      },
    };

    await events.get("session_start")({}, ctx);
    await command.handler("", ctx);

    assert.equal(customCalls, 2);
    assert.equal(loadGlobalPrefs(agentDir).usage, "aggressive");
    assert.ok(notices.some((n) => n.msg.includes("usage guidance") && n.msg.includes("/reload")));
  });
});

test("restoring defaults sticks across session_tree and does not resurrect stale branch settings", async () => {
  await withTempDirs(async ({ agentDir, projectDir }) => {
    const events = new Map();
    let widget;
    let status;
    extension({
      on: (name, handler) => events.set(name, handler),
      registerTool() {},
      registerCommand() {},
    });

    const staleBranch = [
      {
        type: "custom",
        customType: "pi-checklist",
        data: {
          v: 1,
          checklist: { tasks: [{ id: "aaa", title: "Task", status: "planned", dependsOn: [], createdAt: 1, updatedAt: 1 }], updatedAt: 1 },
          widgetVisible: false,
          iconSet: "emoji",
        },
      },
    ];
    const ctx = {
      hasUI: true,
      mode: "tui",
      cwd: projectDir,
      isProjectTrusted: () => false,
      sessionManager: { getBranch: () => staleBranch },
      ui: {
        theme: PLAIN_THEME,
        setWidget: (_k, v) => { widget = v; },
        setStatus: (_k, v) => { status = v; },
        notify() {},
        confirm: async () => true,
      },
    };

    await events.get("session_start")({}, ctx);
    assert.equal(widget, undefined);
    assert.equal(status, undefined);
    assert.equal(existsSync(prefsFilePath(agentDir)), false);

    // An explicit reset overrides the old session even when its branch is reloaded.
    const store = createChecklistSettingsStore({ agentDir, cwd: projectDir });
    await store.restoreDefaults({ scope: "global" });

    await events.get("session_tree")({}, ctx);
    assert.equal(typeof widget, "function");
    assert.ok(status);
  });
});
