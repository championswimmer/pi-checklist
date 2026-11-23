import { matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { countsOf, resolveIconSet, resolveStatusStyle, sortViews, viewsOf } from "./store.js";
const CLASSIC_GLYPHS = {
    ongoing: "●",
    planned: "○",
    done: "✓",
    cancelled: "✕",
};
const CLASSIC_READY = "○";
const CLASSIC_BLOCKED = "⊘";
const NF_GLYPHS = {
    ongoing: "\uF46A",
    ready: "\uF500",
    blocked: "\uF479",
    done: "\uF4A4",
    cancelled: "\uF530",
};
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
function pillFor(kind) {
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
function paintPill(theme, pill) {
    return theme.bg(pill.bg, theme.bold(theme.fg(pill.fg, ` ${pill.label} `)));
}
export function colorFor(kind) {
    switch (kind) {
        case "ongoing":
            return "warning";
        case "ready":
            return "text";
        case "blocked":
            return "error";
        case "done":
            return "success";
        case "cancelled":
            return "dim";
    }
}
function compactSummary(checklist, opts, title = "", theme) {
    const c = countsOf(checklist);
    const icons = opts.iconSet === "emoji" ? EMOJI_GLYPHS : NF_GLYPHS;
    const checklistIcon = opts.iconSet === "emoji" ? "☑️" : "\uED7A";
    const cancelled = checklist.tasks.length - c.total;
    const states = [
        ["done", c.done], ["ongoing", c.ongoing], ["ready", c.ready],
        ["blocked", c.blocked], ["cancelled", cancelled],
    ];
    const counts = states.filter(([, count]) => count > 0).map(([kind, count]) => {
        const text = `${icons[kind]} ${count}`;
        return theme ? theme.fg(colorFor(kind), text) : text;
    });
    const progress = `${checklistIcon}${title} ${c.done}/${c.total}`;
    return [theme ? theme.fg("accent", progress) : progress, ...counts].join(" ");
}
export function footerText(checklist, opts = DEFAULT_RENDER_OPTS, theme) {
    if (!checklist || checklist.tasks.length === 0)
        return undefined;
    return compactSummary(checklist, opts, "", theme);
}
export const WIDGET_MAX_TASKS = 5;
export function widgetLines(checklist, opts = DEFAULT_RENDER_OPTS) {
    const views = sortViews(viewsOf(checklist));
    const lines = [];
    const title = checklist.title ? ` ${checklist.title}` : "";
    lines.push({
        kind: "header",
        text: compactSummary(checklist, opts, title),
    });
    const rowFor = (v) => {
        const kind = statusKindOf(v);
        const glyph = glyphFor(kind, opts);
        const deps = v.blocked ? ` ← ${v.blockedBy.join(", ")}` : "";
        const hasSubs = (v.subtaskViews ?? []).length > 0;
        const marker = hasSubs ? "↳ " : "  ";
        return { kind, text: `${marker}${glyph} ${v.id}  ${v.title}${deps}`, pill: pillFor(kind) };
    };
    for (const v of views.slice(0, WIDGET_MAX_TASKS)) {
        lines.push(rowFor(v));
    }
    const hidden = views.length - WIDGET_MAX_TASKS;
    if (hidden > 0) {
        lines.push({ kind: "summary", text: `… +${hidden} more — /checklist show for all tasks` });
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
            colored = theme.fg("error", raw);
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
export const DISPLAY_MODE_LABELS = {
    statusbar: "statusbar — below the input box",
    "widget-only": "widget-only — widget without footer",
    "status-minimal": "status-minimal — summary in footer only",
    "end-of-turn": "end of turn — above the input box",
    hidden: "hidden — off, open on demand",
};
export const STATUS_STYLE_DESCRIPTIONS = {
    color: "Rows are only color-coded. No status word is shown.",
    pill: "The status word is a pill: text on a colored background.",
    icon: "Status is a leading icon only. Pick the artwork below.",
};
export const ICON_SET_DESCRIPTIONS = {
    "nerd-font": "Nerd Font Octicons (sync / play / blocked / check / x). Needs a Nerd Font patched font.",
    emoji: "🔄 ▶️ ⛔ ✅ ❌. Double-width; works in any modern terminal.",
};
export const USAGE_LABELS = {
    moderate: "moderate — long-running tasks only",
    aggressive: "aggressive — almost every task",
};
export function previewLines(theme, opts, subtasksEnabled = false) {
    const samples = [
        { kind: "ongoing", title: "Write the widget", subtasks: [
                { kind: "done", title: "Design the layout" },
                { kind: "ongoing", title: "Render task rows" },
            ] },
        { kind: "ready", title: "Update the docs", subtasks: [
                { kind: "ready", title: "Document settings" },
            ] },
        { kind: "blocked", title: "Publish release" },
        { kind: "done", title: "Scaffold repo" },
        { kind: "cancelled", title: "Drop the prototype" },
    ];
    const renderSample = ({ kind, title }, indent = "") => {
        const row = theme.fg(colorFor(kind), `${glyphFor(kind, opts)} abc ${title}`);
        return indent + (opts.style === "pill" ? `${paintPill(theme, pillFor(kind))}  ${row}` : row);
    };
    return samples.flatMap((sample) => [
        renderSample(sample),
        ...(subtasksEnabled ? (sample.subtasks ?? []).map((subtask) => renderSample(subtask, "  ↳ ")) : []),
    ]);
}
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
    const rows = [];
    for (const v of views) {
        const kind = statusKindOf(v);
        const row = theme.fg(colorFor(kind), `${glyphFor(kind, opts)} ${v.id} ${v.title}${v.blocked ? ` ← ${v.blockedBy.join(", ")}` : ""}`);
        rows.push(opts.style === "pill" ? `${paintPill(theme, pillFor(kind))}  ${row}` : row);
        for (const s of v.subtaskViews ?? []) {
            const skind = statusKindOf(s);
            const srow = theme.fg(colorFor(skind), `↳ ${glyphFor(skind, opts)} ${s.id} ${s.title}${s.blocked ? ` ← ${s.blockedBy.join(", ")}` : ""}`);
            rows.push(opts.style === "pill" ? `${paintPill(theme, pillFor(skind))}  ${srow}` : srow);
        }
    }
    return new Text(`${summary}\n${rows.join("\n")}`, 0, 0);
}
function oneLine(text) {
    return text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}
export function metaRows(meta, indent, theme) {
    if (typeof meta !== "object" || meta === null || Array.isArray(meta))
        return [];
    const entries = [];
    for (const [key, value] of Object.entries(meta)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            entries.push([`${oneLine(key)}:`, oneLine(String(value))]);
        }
    }
    const keyWidth = entries.reduce((w, [k]) => Math.max(w, visibleWidth(k)), 0);
    return entries.map(([k, v]) => `${indent}${theme.fg("dim", k)}${" ".repeat(keyWidth - visibleWidth(k))} ${theme.fg("muted", v)}`);
}
export const DIALOG_MAX_HEIGHT_PERCENT = 70;
export function dialogMaxRows(termRows) {
    return Math.max(1, Math.floor((termRows * DIALOG_MAX_HEIGHT_PERCENT) / 100));
}
const DIALOG_CHROME_ROWS = 6;
export class ChecklistOverlay {
    views;
    title;
    theme;
    cb;
    opts;
    showMeta;
    selected = 0;
    cachedWidth;
    cachedMaxRows;
    cachedLines;
    scrollTop = 0;
    expanded = new Set();
    constructor(checklist, theme, cb, opts = DEFAULT_RENDER_OPTS, showMeta = false) {
        this.views = checklist ? sortViews(viewsOf(checklist)) : [];
        this.title = checklist?.title;
        this.theme = theme;
        this.cb = cb;
        this.opts = opts;
        this.showMeta = showMeta;
    }
    flatRows() {
        const rows = [];
        for (const v of this.views) {
            rows.push({ kind: "task", view: v });
            if (this.expanded.has(v.id)) {
                for (const s of v.subtaskViews ?? [])
                    rows.push({ kind: "sub", view: s, parentId: v.id });
            }
        }
        return rows;
    }
    handleInput(data) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
            this.cb.onClose();
            return;
        }
        if (data === "s" || data === "S") {
            this.cb.onSettings?.();
            return;
        }
        const rows = this.flatRows();
        if (matchesKey(data, "down") || data === "j") {
            if (this.selected < rows.length - 1) {
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
        if (matchesKey(data, "right") || data === "l") {
            const row = rows[this.selected];
            if (row?.kind === "task" && row.view.subtaskViews?.length) {
                this.expanded.add(row.view.id);
                this.invalidate();
                this.cb.requestRender();
            }
            return;
        }
        if (matchesKey(data, "left") || data === "h") {
            const row = rows[this.selected];
            const parentId = row?.kind === "sub" ? row.parentId : row?.view.id;
            if (parentId && this.expanded.delete(parentId)) {
                this.invalidate();
                this.cb.requestRender();
            }
            return;
        }
    }
    render(width) {
        const maxRows = this.cb.getMaxRows?.();
        if (this.cachedLines && this.cachedWidth === width && this.cachedMaxRows === maxRows)
            return this.cachedLines;
        const th = this.theme;
        const inner = [];
        if (this.views.length === 0) {
            inner.push(`  ${th.fg("dim", "No tasks. Ask the agent to create a checklist!")}`);
        }
        else {
            const counts = this.views.length;
            const done = this.views.filter((v) => v.status === "done").length;
            const headerIdx = inner.push("") - 1;
            inner.push("");
            const rows = this.flatRows();
            this.selected = Math.min(this.selected, Math.max(0, rows.length - 1));
            const blocks = rows.map((row, i) => {
                const block = [];
                const v = row.view;
                const isTask = row.kind === "task";
                const kind = statusKindOf(v);
                const cursor = i === this.selected ? th.fg("accent", "› ") : "  ";
                const rowColor = colorFor(kind);
                const glyph = th.fg(rowColor, glyphFor(kind, this.opts));
                const id = th.fg(v.blocked ? rowColor : "accent", v.id);
                const title = v.status === "done" || v.status === "cancelled" ? th.fg("dim", v.title) : th.fg(rowColor, v.title);
                const state = this.opts.style === "pill" ? `${paintPill(th, pillFor(kind))}  ` : "";
                const dep = v.blocked
                    ? th.fg(rowColor, ` ← ${v.blockedBy.join(", ")}`)
                    : v.dependsOn.length > 0
                        ? th.fg("dim", ` ← ${v.dependsOn.join(", ")}`)
                        : "";
                if (isTask) {
                    const subs = v.subtaskViews ?? [];
                    const marker = subs.length === 0 ? "  " : this.expanded.has(v.id) ? "▾ " : "▸ ";
                    block.push(`${cursor}${marker}${state}${glyph} ${id} ${title}${dep}`);
                }
                else {
                    block.push(`${cursor}  ${state}${glyph} ${id} ${title}${dep}`);
                }
                if (this.showMeta && v.meta) {
                    const indent = " ".repeat(4 + visibleWidth(state) + visibleWidth(glyph) + 1);
                    block.push(...metaRows(v.meta, indent, th));
                }
                return block;
            });
            const budget = maxRows === undefined ? Number.POSITIVE_INFINITY : Math.max(1, maxRows - DIALOG_CHROME_ROWS);
            const { start, end } = this.visibleWindow(blocks, budget);
            for (let i = start; i < end; i++) {
                const block = blocks[i];
                if (block.length <= budget) {
                    inner.push(...block);
                }
                else if (budget === 1) {
                    inner.push(block[0]);
                }
                else {
                    inner.push(...block.slice(0, budget - 1), `    ${th.fg("dim", `… +${block.length - (budget - 1)} more`)}`);
                }
            }
            const range = start > 0 || end < blocks.length ? ` · rows ${start + 1}–${end} of ${blocks.length}` : "";
            inner[headerIdx] = `  ${th.fg("muted", `${done}/${counts} done`)}${range ? th.fg("dim", range) : ""}`;
        }
        inner.push("");
        inner.push(`  ${th.fg("dim", "j/k or ↑/↓ to move · →/l expand · ←/h collapse · s for settings · Esc/q to close")}`);
        const titleText = `checklist${this.title ? ` — ${this.title}` : ""}`;
        const lines = frameDialog(titleText, inner, width, th);
        this.cachedWidth = width;
        this.cachedMaxRows = maxRows;
        this.cachedLines = lines;
        return lines;
    }
    visibleWindow(blocks, budget) {
        const heightOf = (from, to) => {
            let h = 0;
            for (let i = from; i < to; i++)
                h += blocks[i].length;
            return h;
        };
        let start = Math.min(this.scrollTop, this.selected);
        while (start < this.selected && heightOf(start, this.selected + 1) > budget)
            start++;
        let end = start;
        let used = 0;
        while (end < blocks.length && (end === start || used + blocks[end].length <= budget)) {
            used += Math.min(blocks[end].length, budget);
            end++;
        }
        if (end === blocks.length) {
            while (start > 0 && used + blocks[start - 1].length <= budget) {
                start--;
                used += blocks[start].length;
            }
        }
        this.scrollTop = start;
        return { start, end };
    }
    invalidate() {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
}
