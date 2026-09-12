import { matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { countsOf, resolveIconSet, resolveStatusStyle, sortViews, viewsOf } from "./store.js";
/** Classic geometric glyphs (no special font needed). Ready keeps the hollow
 * circle; blocked gets ⊘ (U+2298, "prohibited") so the two planned splits
 * are distinguishable even without color. Both are single-cell and ship in
 * virtually all monospace fonts. */
const CLASSIC_GLYPHS = {
    ongoing: "●",
    planned: "○",
    done: "✓",
    cancelled: "✕",
};
const CLASSIC_READY = "○";
const CLASSIC_BLOCKED = "⊘";
/** Nerd Font Octicons (single-cell; needs a Nerd Font in the terminal).
 * Codepoints are the Nerd Fonts target column of
 * nerd-fonts `src/glyphs/octicons/mapping` (e.g. sync F087 -> F46A). */
const NF_GLYPHS = {
    ongoing: "\uF46A", // oct-sync — in progress
    // oct-play (F2D3 -> F500) — ready to start. Note: F4FF looks close but is
    // oct-person-fill (a human icon), not play.
    ready: "\uF500",
    blocked: "\uF479", // oct-blocked — waiting on deps
    done: "\uF4A4", // oct-check-circle-fill — finished
    cancelled: "\uF530", // oct-x-circle-fill — dropped
};
/** Emoji artwork (double-width; works in any modern terminal). */
const EMOJI_GLYPHS = {
    ongoing: "🔄",
    ready: "▶️",
    blocked: "⛔",
    done: "✅",
    cancelled: "❌",
};
export const DEFAULT_RENDER_OPTS = { style: "pill", iconSet: "nerd-font" };
export function statusKindOf(v) {
    if (v.status === "ongoing")
        return "ongoing";
    if (v.status === "done")
        return "done";
    if (v.status === "cancelled")
        return "cancelled";
    return v.blocked ? "blocked" : "ready";
}
export function glyphFor(kind, opts) {
    if (opts.style === "icon") {
        const set = opts.iconSet === "emoji" ? EMOJI_GLYPHS : NF_GLYPHS;
        return set[kind];
    }
    switch (kind) {
        case "ongoing":
            return CLASSIC_GLYPHS.ongoing;
        case "done":
            return CLASSIC_GLYPHS.done;
        case "cancelled":
            return CLASSIC_GLYPHS.cancelled;
        case "ready":
            return CLASSIC_READY;
        case "blocked":
            return CLASSIC_BLOCKED;
    }
}
export function pillFor(kind) {
    switch (kind) {
        case "ongoing":
            return { label: "PROG", bg: "toolPendingBg", fg: "warning" };
        case "ready":
            return { label: "REDY", bg: "selectedBg", fg: "accent" };
        case "blocked":
            return { label: "BLCK", bg: "toolErrorBg", fg: "error" };
        case "done":
            return { label: "DONE", bg: "toolSuccessBg", fg: "success" };
        case "cancelled":
            return { label: "DROP", bg: "customMessageBg", fg: "dim" };
    }
}
/** A status pill: the label as text on a colored background. */
export function paintPill(theme, pill) {
    return theme.bg(pill.bg, theme.bold(theme.fg(pill.fg, ` ${pill.label} `)));
}
/** Row color per status kind (glyph + title, every style). */
export function colorFor(kind) {
    switch (kind) {
        case "ongoing":
            return "warning";
        case "ready":
            return "text";
        case "blocked":
            return "dim";
        case "done":
            return "success";
        case "cancelled":
            return "dim";
    }
}
export function footerText(checklist) {
    if (!checklist || checklist.tasks.length === 0)
        return undefined;
    const c = countsOf(checklist);
    return `☑ ${c.done}/${c.total}`;
}
/** Max task rows before done/cancelled collapse to a count. */
export const WIDGET_MAX_LINES = 16;
export function widgetLines(checklist, opts = DEFAULT_RENDER_OPTS) {
    const views = sortViews(viewsOf(checklist));
    const c = countsOf(checklist);
    const lines = [];
    const title = checklist.title ? ` ${checklist.title}` : "";
    lines.push({
        kind: "header",
        text: `checklist${title}  ${c.done}/${c.total} done   ${c.ongoing} ongoing   ${c.ready} ready   ${c.blocked} blocked`,
    });
    const rowFor = (v) => {
        const kind = statusKindOf(v);
        const glyph = glyphFor(kind, opts);
        const deps = v.blocked ? ` ← ${v.blockedBy.join(", ")}` : "";
        return { kind, text: `${glyph} ${v.id}  ${v.title}${deps}`, pill: pillFor(kind) };
    };
    const active = views.filter((v) => v.status === "ongoing" || v.status === "planned");
    const finished = views.filter((v) => v.status === "done" || v.status === "cancelled");
    const room = WIDGET_MAX_LINES - 1; // header takes one
    for (const v of active.slice(0, room)) {
        lines.push(rowFor(v));
    }
    const shownActive = Math.min(active.length, room);
    const remaining = room - shownActive;
    const shownFinished = finished.slice(0, Math.max(0, remaining));
    for (const v of shownFinished) {
        lines.push(rowFor(v));
    }
    const hiddenFinished = finished.length - shownFinished.length;
    const hiddenActive = active.length - shownActive;
    if (hiddenFinished > 0 || hiddenActive > 0) {
        const doneHidden = finished.filter((v) => v.status === "done").length - shownFinished.filter((v) => v.status === "done").length;
        const cxHidden = finished.filter((v) => v.status === "cancelled").length - shownFinished.filter((v) => v.status === "cancelled").length;
        const bits = [];
        if (hiddenActive > 0)
            bits.push(`+${hiddenActive} active`);
        if (doneHidden > 0)
            bits.push(`✓ ${doneHidden} done`);
        if (cxHidden > 0)
            bits.push(`✕ ${cxHidden} cancelled`);
        lines.push({ kind: "summary", text: `… ${bits.join("  ")}` });
    }
    return lines;
}
function paintLine(line, theme, width, style = "pill") {
    const raw = line.text;
    let colored;
    switch (line.kind) {
        case "header":
            colored = theme.fg("accent", theme.bold(raw));
            break;
        case "ongoing":
            colored = theme.fg("warning", raw);
            break;
        case "planned":
        case "ready":
            colored = theme.fg("text", raw);
            break;
        case "blocked":
            colored = theme.fg("dim", raw);
            break;
        case "done":
            colored = theme.fg("success", raw);
            break;
        case "cancelled":
            colored = theme.fg("dim", raw);
            break;
        case "summary":
            colored = theme.fg("dim", raw);
            break;
    }
    if (style === "pill" && line.pill) {
        colored = `${paintPill(theme, line.pill)}  ${colored}`;
    }
    return truncateToWidth(colored, width);
}
export function paintWidget(checklist, theme, width, opts = DEFAULT_RENDER_OPTS) {
    return widgetLines(checklist, opts).map((l) => paintLine(l, theme, width, opts.style));
}
/** Frame pre-rendered lines as a rounded dialog box with the title set into
 * the top border. pi-tui has no bordered-box component (Box is only
 * padding + background), so dialogs draw their own chrome — same pattern as
 * the overlay-qa-tests example in the pi repo. Every returned line is
 * exactly `width` cells wide (borders included). */
export function frameDialog(title, inner, width, theme) {
    const innerW = Math.max(1, width - 2);
    const border = (s) => theme.fg("border", s);
    const titleStr = truncateToWidth(` ${title} `, innerW);
    const titleW = visibleWidth(titleStr);
    const left = Math.max(0, Math.floor((innerW - titleW) / 2));
    const right = Math.max(0, innerW - titleW - left);
    const out = [
        border(`╭${"─".repeat(left)}`) + theme.fg("accent", titleStr) + border(`${"─".repeat(right)}╮`),
    ];
    for (const line of inner) {
        out.push(border("│") + truncateToWidth(line, innerW, "...", true) + border("│"));
    }
    out.push(border(`╰${"─".repeat(innerW)}╯`));
    return out;
}
// ---------------------------------------------------------------------------
// Display-mode metadata for /checklist settings
// ---------------------------------------------------------------------------
export const DISPLAY_MODE_LABELS = {
    statusbar: "statusbar — below the input box",
    "end-of-turn": "end of turn — above the input box",
    hidden: "hidden — off, open on demand",
};
export const DISPLAY_MODE_DESCRIPTIONS = {
    statusbar: "Persistent widget below the input box + footer counter.",
    "end-of-turn": "Widget above the input box, refreshed when each turn settles.",
    hidden: "No widget or footer. Open with /checklist (overlay) or /checklist show.",
};
export const STATUS_STYLE_LABELS = {
    color: "color — color-coded rows only",
    pill: "pill — status on a colored background",
    icon: "icon — progress icon only",
};
export const STATUS_STYLE_DESCRIPTIONS = {
    color: "Rows are only color-coded. No status word is shown.",
    pill: "The status word is a pill: text on a colored background.",
    icon: "Status is a leading icon only. Pick the artwork below.",
};
export const ICON_SET_LABELS = {
    "nerd-font": "nerd-font — Nerd Font glyphs",
    emoji: "emoji — emoji glyphs",
};
export const ICON_SET_DESCRIPTIONS = {
    "nerd-font": "Nerd Font Octicons (sync / play / blocked / check / x). Needs a Nerd Font patched font.",
    emoji: "🔄 ▶️ ⛔ ✅ ❌. Double-width; works in any modern terminal.",
};
export const USAGE_LABELS = {
    moderate: "moderate — long-running tasks only",
    aggressive: "aggressive — almost every task",
};
export const USAGE_DESCRIPTIONS = {
    moderate: "Hint steers you to the checklist for long-running / multi-step work only; quick one-shot questions go untracked.",
    aggressive: "Hint steers you to the checklist for almost every task, even small ones; only trivial single-step questions go untracked.",
};
/** Sample rows for the /checklist settings preview (uses a fake `abc` id). */
export function previewLines(theme, opts) {
    const samples = [
        { kind: "ongoing", title: "Write the widget" },
        { kind: "ready", title: "Update the docs" },
        { kind: "blocked", title: "Publish release" },
        { kind: "done", title: "Scaffold repo" },
        { kind: "cancelled", title: "Drop the prototype" },
    ];
    return samples.map(({ kind, title }) => {
        const row = theme.fg(colorFor(kind), `${glyphFor(kind, opts)} abc ${title}`);
        return opts.style === "pill" ? `${paintPill(theme, pillFor(kind))}  ${row}` : row;
    });
}
// ---------------------------------------------------------------------------
// Tool transcript renderers (compact themed rows)
// ---------------------------------------------------------------------------
export function renderCreateCall(args, theme) {
    const n = Array.isArray(args.tasks) ? args.tasks.length : 0;
    return new Text(theme.fg("toolTitle", theme.bold("checklist create ")) + theme.fg("muted", `${n} task(s)`), 0, 0);
}
export function renderReadCall(theme) {
    return new Text(theme.fg("toolTitle", theme.bold("checklist ")), 0, 0);
}
export function renderUpdateCall(args, theme) {
    const ids = Array.isArray(args.updates) ? args.updates.map((u) => u.id).filter(Boolean).join(", ") : "";
    return new Text(theme.fg("toolTitle", theme.bold("checklist ")) + theme.fg("accent", ids || "update"), 0, 0);
}
export function renderChecklistResult(result, expanded, theme) {
    const details = result.details;
    const first = result.content?.[0];
    const fallback = first && typeof first === "object" && "text" in first ? String(first.text ?? "") : "";
    if (!details || details.v !== 1 || !details.checklist) {
        return new Text(theme.fg("dim", fallback.split("\n")[0] ?? ""), 0, 0);
    }
    const checklist = details.checklist;
    const c = countsOf(checklist);
    const opts = { style: resolveStatusStyle(details), iconSet: resolveIconSet(details) };
    const summary = theme.fg("muted", `${c.done}/${c.total} done`) + theme.fg("dim", `  ${c.ongoing} ongoing  ${c.ready} ready  ${c.blocked} blocked`);
    if (!expanded)
        return new Text(summary, 0, 0);
    const views = sortViews(viewsOf(checklist)).slice(0, 10);
    const rows = views.map((v) => {
        const kind = statusKindOf(v);
        const row = theme.fg(colorFor(kind), `${glyphFor(kind, opts)} ${v.id} ${v.title}${v.blocked ? ` ← ${v.blockedBy.join(", ")}` : ""}`);
        return opts.style === "pill" ? `${paintPill(theme, pillFor(kind))}  ${row}` : row;
    });
    return new Text(`${summary}\n${rows.join("\n")}`, 0, 0);
}
export class ChecklistOverlay {
    views;
    title;
    theme;
    cb;
    opts;
    selected = 0;
    cachedWidth;
    cachedLines;
    constructor(checklist, theme, cb, opts = DEFAULT_RENDER_OPTS) {
        this.views = checklist ? sortViews(viewsOf(checklist)) : [];
        this.title = checklist?.title;
        this.theme = theme;
        this.cb = cb;
        this.opts = opts;
    }
    handleInput(data) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
            this.cb.onClose();
            return;
        }
        if (matchesKey(data, "down") || data === "j") {
            if (this.selected < this.views.length - 1) {
                this.selected++;
                this.invalidate();
                this.cb.requestRender();
            }
            return;
        }
        if (matchesKey(data, "up") || data === "k") {
            if (this.selected > 0) {
                this.selected--;
                this.invalidate();
                this.cb.requestRender();
            }
            return;
        }
    }
    render(width) {
        if (this.cachedLines && this.cachedWidth === width)
            return this.cachedLines;
        const th = this.theme;
        const lines = [""];
        const title = th.fg("accent", ` checklist${this.title ? ` — ${this.title}` : ""} `);
        const rule = Math.max(0, width - 14 - (this.title ? this.title.length + 3 : 0));
        lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(rule)), width));
        lines.push("");
        if (this.views.length === 0) {
            lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks. Ask the agent to create a checklist!")}`, width));
        }
        else {
            const counts = this.views.length;
            const done = this.views.filter((v) => v.status === "done").length;
            lines.push(truncateToWidth(`  ${th.fg("muted", `${done}/${counts} done`)}`, width));
            lines.push("");
            this.views.forEach((v, i) => {
                const kind = statusKindOf(v);
                const cursor = i === this.selected ? th.fg("accent", "› ") : "  ";
                const glyph = th.fg(colorFor(kind), glyphFor(kind, this.opts));
                const id = th.fg("accent", v.id);
                const title = v.status === "done" || v.status === "cancelled" ? th.fg("dim", v.title) : th.fg("text", v.title);
                const state = this.opts.style === "pill" ? `${paintPill(th, pillFor(kind))}  ` : "";
                const dep = v.blocked
                    ? th.fg("dim", ` ← ${v.blockedBy.join(", ")}`)
                    : v.dependsOn.length > 0
                        ? th.fg("dim", ` ← ${v.dependsOn.join(", ")}`)
                        : "";
                lines.push(truncateToWidth(`${cursor}${state}${glyph} ${id} ${title}${dep}`, width));
            });
        }
        lines.push("");
        lines.push(truncateToWidth(`  ${th.fg("dim", "j/k or ↑/↓ to move · Esc/q to close")}`, width));
        lines.push("");
        this.cachedWidth = width;
        this.cachedLines = lines;
        return lines;
    }
    invalidate() {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}
