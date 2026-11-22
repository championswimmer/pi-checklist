import { openSettingsDialog } from "pi-extension-settings-tui/adapter";
import { AddTaskDialog } from "./add-task-dialog.js";
import { DIALOG_MAX_HEIGHT_PERCENT, DISPLAY_MODE_LABELS, ICON_SET_DESCRIPTIONS, STATUS_STYLE_DESCRIPTIONS, USAGE_LABELS, ChecklistOverlay, dialogMaxRows, } from "./render.js";
import { checklistSettingsSchema, createChecklistSettingsStore, preferencesForSettings, } from "./settings.js";
import { MAX_CHECKLIST_TASKS, suggestTaskId } from "./store.js";
import { DISPLAY_MODES, ICON_SETS, STATUS_STYLES, USAGE_MODES, } from "./types.js";
/** Normalize a user-typed mode word to a DisplayMode (accepts shorthands). */
export function normalizeDisplayMode(raw) {
    const word = raw.trim().toLowerCase().replace(/_/g, "-");
    if (word === "statusbar" || word === "status")
        return "statusbar";
    if (word === "widget-only")
        return "widget-only";
    if (word === "status-minimal")
        return "status-minimal";
    if (word === "end-of-turn" || word === "endofturn" || word === "end" || word === "turn")
        return "end-of-turn";
    if (word === "hidden" || word === "hide" || word === "off" || word === "none")
        return "hidden";
    return undefined;
}
/** Normalize a user-typed style word to a StatusStyle (accepts shorthands). */
export function normalizeStatusStyle(raw) {
    const word = raw.trim().toLowerCase();
    if (word === "color" || word === "colour" || word === "colors" || word === "colours")
        return "color";
    if (word === "pill" || word === "pills" || word === "badge" || word === "badges")
        return "pill";
    if (word === "icon" || word === "icons")
        return "icon";
    return undefined;
}
/** Normalize a user-typed icon-set word to an IconSet (accepts shorthands). */
export function normalizeIconSet(raw) {
    const word = raw.trim().toLowerCase().replace(/_/g, "-");
    if (word === "nerd-font" || word === "nerd-fonts" || word === "nerdfont" || word === "nerdfonts" || word === "nerd" || word === "nf") {
        return "nerd-font";
    }
    if (word === "emoji" || word === "emojis")
        return "emoji";
    return undefined;
}
/** Normalize a user-typed usage word to a UsageMode (accepts shorthands). */
export function normalizeUsageMode(raw) {
    const word = raw.trim().toLowerCase();
    if (word === "moderate" || word === "mod" || word === "m")
        return "moderate";
    if (word === "aggressive" || word === "aggro" || word === "a")
        return "aggressive";
    return undefined;
}
/** Normalize a user-typed subtasks word to a boolean (preview toggle). */
export function normalizeSubtasksSetting(raw) {
    const word = raw.trim().toLowerCase().replace(/_/g, "-");
    if (word === "subtasks" || word === "subtask" || word === "sub-tasks" || word === "on")
        return true;
    if (word === "no-subtasks" || word === "nosubtasks" || word === "no-subtask" || word === "off")
        return false;
    return undefined;
}
/** Normalize a user-typed meta word to a boolean (preview toggle). Bare
 * on/off stay with subtasks, so meta needs its own words. */
export function normalizeMetaSetting(raw) {
    const word = raw.trim().toLowerCase().replace(/_/g, "-");
    if (word === "meta" || word === "task-meta")
        return true;
    if (word === "no-meta" || word === "nometa" || word === "no-task-meta")
        return false;
    return undefined;
}
export function parseChecklistArgs(raw) {
    const parts = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const head = parts[0] ?? "";
    if (head === "")
        return { name: "open" };
    if (head === "show")
        return { name: "show" };
    if (head === "hide")
        return { name: "hide" };
    if (head === "clear")
        return { name: "clear" };
    if (head === "add") {
        // Anything after `add` prefills the task text (original casing kept).
        const title = raw.trim().replace(/^add\s*/i, "").trim();
        return title === "" ? { name: "add" } : { name: "add", title };
    }
    if (head === "settings" || head === "setting" || head === "mode") {
        const tokens = parts.slice(1);
        if (tokens.length === 0)
            return { name: "settings" };
        let displayMode;
        let statusStyle;
        let iconSet;
        let usage;
        let subtasksEnabled;
        let metaEnabled;
        for (const token of tokens) {
            const m = normalizeDisplayMode(token);
            if (m && displayMode === undefined) {
                displayMode = m;
                continue;
            }
            const s = normalizeStatusStyle(token);
            if (s && statusStyle === undefined) {
                statusStyle = s;
                continue;
            }
            const i = normalizeIconSet(token);
            if (i && iconSet === undefined) {
                iconSet = i;
                continue;
            }
            const u = normalizeUsageMode(token);
            if (u && usage === undefined) {
                usage = u;
                continue;
            }
            const st = normalizeSubtasksSetting(token);
            if (st !== undefined && subtasksEnabled === undefined) {
                subtasksEnabled = st;
                continue;
            }
            const me = normalizeMetaSetting(token);
            if (me !== undefined && metaEnabled === undefined) {
                metaEnabled = me;
                continue;
            }
            return { name: "help" };
        }
        if (displayMode === undefined && statusStyle === undefined && iconSet === undefined && usage === undefined && subtasksEnabled === undefined && metaEnabled === undefined) {
            return { name: "help" };
        }
        return { name: "settings", displayMode, statusStyle, iconSet, usage, subtasksEnabled, metaEnabled };
    }
    return { name: "help" };
}
export const CHECKLIST_USAGE = "Usage: /checklist [show|hide|clear|add [text]|settings [statusbar|widget-only|status-minimal|end-of-turn|hidden] [color|pill|icon] [nerd-font|emoji] [moderate|aggressive] [subtasks|no-subtasks] [meta|no-meta]]";
/** Open the checklist in a centered TUI popup dialog (overlay modal). */
async function openChecklistDialog(ctx, deps) {
    if (ctx.mode !== "tui" || !ctx.hasUI) {
        // No popup surface in print mode — fall back to a text summary.
        const checklist = deps.getChecklist();
        if (!checklist || checklist.tasks.length === 0) {
            ctx.ui.notify("checklist is empty", "info");
            return;
        }
        const { countsOf, sortViews, viewsOf } = await import("./store.js");
        const c = countsOf(checklist);
        const rows = sortViews(viewsOf(checklist))
            .map((v) => `  ${v.status === "done" ? "✓" : v.status === "ongoing" ? "●" : v.status === "cancelled" ? "✕" : "○"} ${v.id} [${v.status}] "${v.title}"`)
            .join("\n");
        ctx.ui.notify(`checklist ${c.done}/${c.total} done\n${rows}`, "info");
        return;
    }
    const checklist = deps.getChecklist();
    const opts = deps.getRenderOpts();
    // `s` jumps to settings: close this dialog first, then open the settings
    // screen once the overlay promise settles (avoids nested overlays).
    let goSettings = false;
    // ctx.ui.custom with overlay:true renders as a floating TUI dialog box
    // on top of the session (see tui.md "Overlays"). The ChecklistOverlay
    // component handles j/k + arrows to scroll, s for settings, Esc/q to close.
    await ctx.ui.custom((tui, theme, _kb, done) => {
        return new ChecklistOverlay(checklist, theme, {
            onClose: () => done(),
            onSettings: () => {
                goSettings = true;
                done();
            },
            requestRender: () => tui.requestRender(),
            // pi-tui slices overlay lines to maxHeight with no scrolling, so the
            // dialog windows its own rows against the live terminal height.
            getMaxRows: () => dialogMaxRows(tui.terminal.rows),
        }, opts, deps.getMetaEnabled());
    }, { overlay: true, overlayOptions: { width: "70%", maxHeight: `${DIALOG_MAX_HEIGHT_PERCENT}%`, anchor: "center" } });
    if (goSettings) {
        await openSettingsScreen(ctx, deps);
    }
}
/** Human-readable summary of a failed add (non-dialog paths). */
function describeAddErrors(errors) {
    return [errors.form, errors.id, errors.title, errors.dependsOn].filter(Boolean).join("; ");
}
/** `/checklist add [text]`: dialog in the TUI, direct add (auto id) when there is no dialog surface. */
async function runAddTask(ctx, deps, title) {
    const checklist = deps.getChecklist();
    const count = checklist?.tasks.length ?? 0;
    if (count >= MAX_CHECKLIST_TASKS) {
        ctx.ui.notify(`checklist is full (${count}/${MAX_CHECKLIST_TASKS} tasks): can't add another`, "warning");
        return;
    }
    const describe = (task) => `checklist: added ${task.id} "${task.title}"${task.dependsOn.length > 0 ? ` (depends on ${task.dependsOn.join(", ")})` : ""}`;
    if (ctx.mode !== "tui" || !ctx.hasUI) {
        if (!title) {
            ctx.ui.notify("/checklist add opens a dialog in the TUI; here pass the task text: /checklist add <text>", "warning");
            return;
        }
        const result = deps.addTask({ id: suggestTaskId(checklist), title, dependsOn: [] }, ctx);
        ctx.ui.notify(result.ok ? describe(result.task) : `checklist: not added: ${describeAddErrors(result.errors)}`, result.ok ? "info" : "warning");
        return;
    }
    const opts = deps.getRenderOpts();
    let added;
    await ctx.ui.custom((tui, theme, _kb, done) => new AddTaskDialog(checklist, { id: suggestTaskId(checklist), title }, theme, {
        onSubmit: (draft) => {
            const result = deps.addTask(draft, ctx);
            if (result.ok)
                added = result.task;
            return result;
        },
        onClose: () => done(),
        requestRender: () => tui.requestRender(),
        getMaxRows: () => dialogMaxRows(tui.terminal.rows),
    }, opts), { overlay: true, overlayOptions: { width: "70%", maxHeight: `${DIALOG_MAX_HEIGHT_PERCENT}%`, anchor: "center" } });
    if (added)
        ctx.ui.notify(describe(added), "info");
}
/** Interactive settings dialog powered by `pi-extension-settings-tui` (TUI + RPC + headless). */
async function openSettingsScreen(ctx, deps) {
    const store = deps.getSettingsStore?.(ctx) ?? createChecklistSettingsStore({ cwd: ctx.cwd });
    let lastUsage = deps.getUsage();
    const applyValues = async (next) => {
        const usageChanged = next.usage !== lastUsage;
        lastUsage = next.usage;
        if (deps.syncSettings) {
            deps.syncSettings(next, ctx);
        }
        else {
            const { displayMode } = preferencesForSettings(next);
            if (displayMode !== deps.getDisplayMode())
                await deps.setDisplayMode(displayMode, ctx);
            if (next.statusStyle !== deps.getStatusStyle())
                await deps.setStatusStyle(next.statusStyle, ctx);
            if (next.iconSet !== deps.getIconSet())
                await deps.setIconSet(next.iconSet, ctx);
            if (next.usage !== deps.getUsage())
                await deps.setUsage(next.usage, ctx);
            if (next.subtasksEnabled !== deps.getSubtasksEnabled())
                await deps.setSubtasksEnabled(next.subtasksEnabled, ctx);
            if (next.metaEnabled !== deps.getMetaEnabled())
                await deps.setMetaEnabled(next.metaEnabled, ctx);
        }
        if (usageChanged) {
            ctx.ui.notify(`checklist usage guidance: ${USAGE_LABELS[next.usage]} (takes effect after /reload or a new session)`, "info");
        }
    };
    try {
        await openSettingsDialog(ctx, {
            schema: checklistSettingsSchema,
            store,
            onApply: async (next) => {
                await applyValues(next);
            },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`checklist settings error: ${message}`, "error");
    }
}
export function registerChecklistCommand(pi, deps) {
    const options = {
        description: "Show the session task checklist in a popup dialog (args: show | hide | clear | add [text] | settings)",
        getArgumentCompletions: (prefix) => {
            const lower = prefix.toLowerCase();
            if (lower.startsWith("settings ") || lower === "settings") {
                const rest = lower.startsWith("settings ") ? lower.slice("settings ".length) : "";
                const last = rest.split(/\s+/).pop() ?? "";
                const candidates = [...DISPLAY_MODES, ...STATUS_STYLES, ...ICON_SETS, ...USAGE_MODES, "subtasks", "no-subtasks", "meta", "no-meta"].filter((m) => m.startsWith(last));
                const base = rest.includes(" ") ? rest.slice(0, rest.lastIndexOf(" ") + 1) : "";
                const values = candidates.map((m) => `settings ${base}${m}`);
                return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
            }
            const opts = ["show", "hide", "clear", "add", "settings"];
            const filtered = opts.filter((o) => o.startsWith(lower));
            return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
        },
        handler: async (args, ctx) => {
            const action = parseChecklistArgs(args);
            if (action.name === "hide") {
                await deps.setDisplayMode("hidden", ctx);
                ctx.ui.notify("checklist hidden (/checklist show to restore)", "info");
                return;
            }
            if (action.name === "show") {
                // "show" pops the checklist dialog; also restore the widget if hidden.
                if (deps.getDisplayMode() === "hidden") {
                    await deps.setDisplayMode("statusbar", ctx);
                }
                await openChecklistDialog(ctx, deps);
                return;
            }
            if (action.name === "clear") {
                const ok = ctx.hasUI
                    ? await ctx.ui.confirm("Clear checklist?", "Remove all tasks from this session's checklist?")
                    : true;
                if (!ok)
                    return;
                deps.clear(ctx);
                ctx.ui.notify("checklist cleared", "info");
                return;
            }
            if (action.name === "add") {
                await runAddTask(ctx, deps, action.title);
                return;
            }
            if (action.name === "settings") {
                const applied = [];
                const patch = {};
                if (action.displayMode) {
                    patch.displayMode = action.displayMode;
                    applied.push(DISPLAY_MODE_LABELS[action.displayMode]);
                }
                if (action.statusStyle) {
                    patch.statusStyle = action.statusStyle;
                    applied.push(STATUS_STYLE_DESCRIPTIONS[action.statusStyle]);
                }
                if (action.iconSet) {
                    patch.iconSet = action.iconSet;
                    applied.push(ICON_SET_DESCRIPTIONS[action.iconSet]);
                }
                if (action.usage) {
                    patch.usage = action.usage;
                    applied.push(USAGE_LABELS[action.usage]);
                }
                if (action.subtasksEnabled !== undefined) {
                    patch.subtasksEnabled = action.subtasksEnabled;
                    applied.push(`Subtasks (preview): ${action.subtasksEnabled ? "on" : "off"}`);
                }
                if (action.metaEnabled !== undefined) {
                    patch.metaEnabled = action.metaEnabled;
                    applied.push(`Task meta (preview): ${action.metaEnabled ? "on" : "off"}`);
                }
                if (applied.length > 0) {
                    if (deps.applySettingsPatch) {
                        await deps.applySettingsPatch(patch, ctx);
                    }
                    else {
                        if (patch.displayMode !== undefined)
                            await deps.setDisplayMode(patch.displayMode, ctx);
                        if (patch.statusStyle !== undefined)
                            await deps.setStatusStyle(patch.statusStyle, ctx);
                        if (patch.iconSet !== undefined)
                            await deps.setIconSet(patch.iconSet, ctx);
                        if (patch.usage !== undefined)
                            await deps.setUsage(patch.usage, ctx);
                        if (patch.subtasksEnabled !== undefined)
                            await deps.setSubtasksEnabled(patch.subtasksEnabled, ctx);
                        if (patch.metaEnabled !== undefined)
                            await deps.setMetaEnabled(patch.metaEnabled, ctx);
                    }
                    if (action.usage) {
                        ctx.ui.notify(`checklist settings: ${applied.join(" · ")} (usage guidance takes effect after /reload or a new session)`, "info");
                    }
                    else {
                        ctx.ui.notify(`checklist settings: ${applied.join(" · ")}`, "info");
                    }
                    return;
                }
                if (!ctx.hasUI) {
                    ctx.ui.notify(`${CHECKLIST_USAGE} (interactive settings need TUI mode)`, "warning");
                    return;
                }
                await openSettingsScreen(ctx, deps);
                return;
            }
            if (action.name === "help") {
                ctx.ui.notify(CHECKLIST_USAGE, "warning");
                return;
            }
            // open popup dialog (bare /checklist and /checklist show)
            await openChecklistDialog(ctx, deps);
        },
    };
    pi.registerCommand("checklist", options);
}
