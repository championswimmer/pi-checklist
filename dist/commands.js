import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text } from "@earendil-works/pi-tui";
import { DISPLAY_MODE_LABELS, ICON_SET_DESCRIPTIONS, STATUS_STYLE_DESCRIPTIONS, USAGE_LABELS, ChecklistOverlay, frameDialog, previewLines, } from "./render.js";
import { DISPLAY_MODES, ICON_SETS, STATUS_STYLES, USAGE_MODES, isDisplayMode, isIconSet, isStatusStyle, isUsageMode, } from "./types.js";
/** Normalize a user-typed mode word to a DisplayMode (accepts shorthands). */
export function normalizeDisplayMode(raw) {
    const word = raw.trim().toLowerCase().replace(/_/g, "-");
    if (word === "statusbar" || word === "status")
        return "statusbar";
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
    if (head === "settings" || head === "setting" || head === "mode") {
        const tokens = parts.slice(1);
        if (tokens.length === 0)
            return { name: "settings" };
        let displayMode;
        let statusStyle;
        let iconSet;
        let usage;
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
            return { name: "help" };
        }
        if (displayMode === undefined && statusStyle === undefined && iconSet === undefined && usage === undefined) {
            return { name: "help" };
        }
        return { name: "settings", displayMode, statusStyle, iconSet, usage };
    }
    return { name: "help" };
}
export const CHECKLIST_USAGE = "Usage: /checklist [show|hide|clear|settings [statusbar|end-of-turn|hidden] [color|pill|icon] [nerd-font|emoji] [moderate|aggressive]]";
/** Open the checklist in a centered TUI popup dialog (overlay modal). */
async function openChecklistDialog(ctx, getChecklist, getRenderOpts) {
    if (ctx.mode !== "tui" || !ctx.hasUI) {
        // No popup surface in print mode — fall back to a text summary.
        const checklist = getChecklist();
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
    const checklist = getChecklist();
    const opts = getRenderOpts();
    // ctx.ui.custom with overlay:true renders as a floating TUI dialog box
    // on top of the session (see tui.md "Overlays"). The ChecklistOverlay
    // component handles j/k + arrows to scroll and Esc/q to close.
    await ctx.ui.custom((tui, theme, _kb, done) => {
        return new ChecklistOverlay(checklist, theme, {
            onClose: () => done(),
            requestRender: () => tui.requestRender(),
        }, opts);
    }, { overlay: true, overlayOptions: { width: "70%", maxHeight: "70%", anchor: "center" } });
}
/** One interactive screen for every checklist display preference, with a live preview. */
async function openSettingsScreen(ctx, deps) {
    await ctx.ui.custom((tui, theme, _kb, done) => {
        let display = deps.getDisplayMode();
        let style = deps.getStatusStyle();
        let icons = deps.getIconSet();
        let usage = deps.getUsage();
        const previewTitle = new Text(theme.fg("accent", theme.bold("Preview")), 1, 0);
        const previewBody = new Text("", 1, 0);
        const repaintPreview = (th) => {
            previewBody.setText(previewLines(th, { style, iconSet: icons }).join("\n"));
        };
        // Small hint under the icons row: Nerd Font glyphs need a patched font.
        // Shown only while the nerd-font set is selected.
        const nfHint = new Text("", 1, 0);
        const repaintHint = (th) => {
            nfHint.setText(icons === "nerd-font"
                ? th.fg("dim", "Tip: install a Nerd Font patched font (nerdfonts.com) to see these symbols.")
                : "");
        };
        const items = [
            {
                id: "display",
                label: "Checklist display",
                currentValue: display,
                values: [...DISPLAY_MODES],
                description: "statusbar: below the input box · end-of-turn: above it · hidden: off",
            },
            {
                id: "status",
                label: "Progress style",
                currentValue: style,
                values: [...STATUS_STYLES],
                description: "color: rows only · pill: status on a colored background · icon: icon only",
            },
            {
                id: "icons",
                label: "Progress icons",
                currentValue: icons,
                values: [...ICON_SETS],
                description: "nerd-font needs a Nerd Font patched font; emoji works anywhere (icon style only)",
            },
            {
                id: "usage",
                label: "Usage guidance",
                currentValue: usage,
                values: [...USAGE_MODES],
                description: "moderate: long-running / multi-step work only · aggressive: almost every task · changes the system prompt — takes effect after reload (/reload or a new session)",
            },
        ];
        // Dialog chrome is drawn by frameDialog (rounded box + title in the top
        // border) in render() below — pi-tui has no bordered-box component, so
        // dialogs draw their own border.
        const container = new Container();
        const list = new SettingsList(items, 6, getSettingsListTheme(), (id, newValue) => {
            if (id === "display" && isDisplayMode(newValue)) {
                display = newValue;
                deps.setDisplayMode(newValue, ctx);
                ctx.ui.notify(`checklist display: ${DISPLAY_MODE_LABELS[newValue]}`, "info");
            }
            else if (id === "status" && isStatusStyle(newValue)) {
                style = newValue;
                deps.setStatusStyle(newValue, ctx);
                ctx.ui.notify(`checklist progress style: ${STATUS_STYLE_DESCRIPTIONS[newValue]}`, "info");
            }
            else if (id === "icons" && isIconSet(newValue)) {
                icons = newValue;
                deps.setIconSet(newValue, ctx);
                ctx.ui.notify(`checklist icons: ${ICON_SET_DESCRIPTIONS[newValue]}`, "info");
            }
            else if (id === "usage" && isUsageMode(newValue)) {
                usage = newValue;
                deps.setUsage(newValue, ctx);
                // This setting is baked into the system prompt at load time —
                // make the delayed-apply contract explicit in the notification.
                ctx.ui.notify(`checklist usage guidance: ${USAGE_LABELS[newValue]} (takes effect after /reload or a new session)`, "info");
            }
            repaintPreview(theme);
            repaintHint(theme);
            tui.requestRender();
        }, () => done(undefined));
        container.addChild(list);
        container.addChild(nfHint);
        container.addChild(previewTitle);
        container.addChild(previewBody);
        container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter/space change · esc done"), 1, 0));
        repaintPreview(theme);
        repaintHint(theme);
        return {
            render: (width) => {
                const innerW = Math.max(1, width - 2);
                return frameDialog("Checklist settings", container.render(innerW), width, theme);
            },
            invalidate: () => {
                container.invalidate();
                repaintPreview(theme);
                repaintHint(theme);
            },
            handleInput: (data) => {
                list.handleInput(data);
            },
        };
    }, {
        // Centered overlay modal (like the checklist dialog): the transcript
        // stays visible and keeps streaming behind the dialog while it is open.
        overlay: true,
        overlayOptions: { width: "70%", maxHeight: "70%", anchor: "center" },
    });
}
export function registerChecklistCommand(pi, deps) {
    const options = {
        description: "Show the session task checklist in a popup dialog (args: show | hide | clear | settings)",
        getArgumentCompletions: (prefix) => {
            const lower = prefix.toLowerCase();
            if (lower.startsWith("settings ") || lower === "settings") {
                const rest = lower.startsWith("settings ") ? lower.slice("settings ".length) : "";
                const last = rest.split(/\s+/).pop() ?? "";
                const candidates = [...DISPLAY_MODES, ...STATUS_STYLES, ...ICON_SETS, ...USAGE_MODES].filter((m) => m.startsWith(last));
                const base = rest.includes(" ") ? rest.slice(0, rest.lastIndexOf(" ") + 1) : "";
                const values = candidates.map((m) => `settings ${base}${m}`);
                return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
            }
            const opts = ["show", "hide", "clear", "settings"];
            const filtered = opts.filter((o) => o.startsWith(lower));
            return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
        },
        handler: async (args, ctx) => {
            const action = parseChecklistArgs(args);
            if (action.name === "hide") {
                deps.setDisplayMode("hidden", ctx);
                ctx.ui.notify("checklist hidden (/checklist show to restore)", "info");
                return;
            }
            if (action.name === "show") {
                // "show" pops the checklist dialog; also restore the widget if hidden.
                if (deps.getDisplayMode() === "hidden") {
                    deps.setDisplayMode("statusbar", ctx);
                }
                await openChecklistDialog(ctx, deps.getChecklist, deps.getRenderOpts);
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
            if (action.name === "settings") {
                const applied = [];
                if (action.displayMode) {
                    deps.setDisplayMode(action.displayMode, ctx);
                    applied.push(DISPLAY_MODE_LABELS[action.displayMode]);
                }
                if (action.statusStyle) {
                    deps.setStatusStyle(action.statusStyle, ctx);
                    applied.push(STATUS_STYLE_DESCRIPTIONS[action.statusStyle]);
                }
                if (action.iconSet) {
                    deps.setIconSet(action.iconSet, ctx);
                    applied.push(ICON_SET_DESCRIPTIONS[action.iconSet]);
                }
                if (action.usage) {
                    deps.setUsage(action.usage, ctx);
                    applied.push(USAGE_LABELS[action.usage]);
                }
                if (applied.length > 0) {
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
            await openChecklistDialog(ctx, deps.getChecklist, deps.getRenderOpts);
        },
    };
    pi.registerCommand("checklist", options);
}
