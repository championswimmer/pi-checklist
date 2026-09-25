/** TUI surfaces: widget lines, footer text, tool renderers, /checklist overlay. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { countsOf, resolveIconSet, resolveStatusStyle, sortViews, viewsOf } from "./store.js";
import type { Checklist, ChecklistSnapshot, DisplayMode, IconSet, StatusStyle, TaskView, UsageMode } from "./types.js";

// ---------------------------------------------------------------------------
// Widget + footer (pure line builders; theme applied by the caller)
// ---------------------------------------------------------------------------

type ThemeBgName = Parameters<Theme["bg"]>[0];
type ThemeFgName = Parameters<Theme["fg"]>[0];

/** Classic geometric glyphs (no special font needed). Ready keeps the hollow
 * circle; blocked gets ⊘ (U+2298, "prohibited") so the two planned splits
 * are distinguishable even without color. Both are single-cell and ship in
 * virtually all monospace fonts. */
const CLASSIC_GLYPHS: Record<TaskView["status"], string> = {
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
} as const;

/** Emoji artwork (double-width; works in any modern terminal). */
const EMOJI_GLYPHS = {
  ongoing: "🔄",
  ready: "▶️",
  blocked: "⛔",
  done: "✅",
  cancelled: "❌",
} as const;

/** Display-ready status incl. the planned → ready/blocked split. */
export type StatusKind = "ongoing" | "ready" | "blocked" | "done" | "cancelled";

export interface RenderOpts {
  style: StatusStyle;
  iconSet: IconSet;
}

export const DEFAULT_RENDER_OPTS: RenderOpts = { style: "pill", iconSet: "nerd-font" };

export function statusKindOf(v: TaskView): StatusKind {
  if (v.status === "ongoing") return "ongoing";
  if (v.status === "done") return "done";
  if (v.status === "cancelled") return "cancelled";
  return v.blocked ? "blocked" : "ready";
}

export function glyphFor(kind: StatusKind, opts: RenderOpts): string {
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

export interface StatusPill {
  label: string;
  bg: ThemeBgName;
  fg: ThemeFgName;
}

export function pillFor(kind: StatusKind): StatusPill {
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
export function paintPill(theme: Theme, pill: StatusPill): string {
  return theme.bg(pill.bg, theme.bold(theme.fg(pill.fg, ` ${pill.label} `)));
}

/** Row color per status kind (glyph + title, every style). */
export function colorFor(kind: StatusKind): ThemeFgName {
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

export function footerText(checklist: Checklist | null): string | undefined {
  if (!checklist || checklist.tasks.length === 0) return undefined;
  const c = countsOf(checklist);
  return `☑ ${c.done}/${c.total}`;
}

export interface WidgetLine {
  /** Base row text (glyph + id + title + blocked deps). Never embeds the pill. */
  text: string;
  kind: "header" | "ongoing" | "planned" | "ready" | "blocked" | "done" | "cancelled" | "summary";
  /** Present on task rows; painted as text-on-background when style is "pill". */
  pill?: StatusPill;
}

/** The live widget shows only the five highest-priority task rows. */
export const WIDGET_MAX_TASKS = 5;

export function widgetLines(checklist: Checklist, opts: RenderOpts = DEFAULT_RENDER_OPTS): WidgetLine[] {
  const views = sortViews(viewsOf(checklist));
  const c = countsOf(checklist);
  const lines: WidgetLine[] = [];
  const title = checklist.title ? ` ${checklist.title}` : "";
  lines.push({
    kind: "header",
    text: `checklist${title}  ${c.done}/${c.total} done   ${c.ongoing} ongoing   ${c.ready} ready   ${c.blocked} blocked`,
  });

  const rowFor = (v: TaskView): WidgetLine => {
    const kind = statusKindOf(v);
    const glyph = glyphFor(kind, opts);
    const deps = v.blocked ? ` ← ${v.blockedBy.join(", ")}` : "";
    return { kind, text: `${glyph} ${v.id}  ${v.title}${deps}`, pill: pillFor(kind) };
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

function paintLine(line: WidgetLine, theme: Theme, width: number, style: StatusStyle = "pill"): string {
  const raw = line.text;
  let colored: string;
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

export function paintWidget(
  checklist: Checklist,
  theme: Theme,
  width: number,
  opts: RenderOpts = DEFAULT_RENDER_OPTS,
): string[] {
  return widgetLines(checklist, opts).map((l) => paintLine(l, theme, width, opts.style));
}

/** Frame pre-rendered lines as a rounded dialog box with the title set into
 * the top border. pi-tui has no bordered-box component (Box is only
 * padding + background), so dialogs draw their own chrome — same pattern as
 * the overlay-qa-tests example in the pi repo. Every returned line is
 * exactly `width` cells wide (borders included). */
export function frameDialog(title: string, inner: string[], width: number, theme: Theme): string[] {
  const innerW = Math.max(1, width - 2);
  const border = (s: string) => theme.fg("border", s);
  const titleStr = truncateToWidth(` ${title} `, innerW);
  const titleW = visibleWidth(titleStr);
  const left = Math.max(0, Math.floor((innerW - titleW) / 2));
  const right = Math.max(0, innerW - titleW - left);
  const out: string[] = [
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

export const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  statusbar: "statusbar — below the input box",
  "end-of-turn": "end of turn — above the input box",
  hidden: "hidden — off, open on demand",
};

export const DISPLAY_MODE_DESCRIPTIONS: Record<DisplayMode, string> = {
  statusbar: "Persistent widget below the input box + footer counter.",
  "end-of-turn": "Widget above the input box, refreshed when each turn settles.",
  hidden: "No widget or footer. Open with /checklist (overlay) or /checklist show.",
};

export const STATUS_STYLE_LABELS: Record<StatusStyle, string> = {
  color: "color — color-coded rows only",
  pill: "pill — status on a colored background",
  icon: "icon — progress icon only",
};

export const STATUS_STYLE_DESCRIPTIONS: Record<StatusStyle, string> = {
  color: "Rows are only color-coded. No status word is shown.",
  pill: "The status word is a pill: text on a colored background.",
  icon: "Status is a leading icon only. Pick the artwork below.",
};

export const ICON_SET_LABELS: Record<IconSet, string> = {
  "nerd-font": "nerd-font — Nerd Font glyphs",
  emoji: "emoji — emoji glyphs",
};

export const ICON_SET_DESCRIPTIONS: Record<IconSet, string> = {
  "nerd-font": "Nerd Font Octicons (sync / play / blocked / check / x). Needs a Nerd Font patched font.",
  emoji: "🔄 ▶️ ⛔ ✅ ❌. Double-width; works in any modern terminal.",
};

export const USAGE_LABELS: Record<UsageMode, string> = {
  moderate: "moderate — long-running tasks only",
  aggressive: "aggressive — almost every task",
};

export const USAGE_DESCRIPTIONS: Record<UsageMode, string> = {
  moderate: "Hint steers you to the checklist for long-running / multi-step work only; quick one-shot questions go untracked.",
  aggressive: "Hint steers you to the checklist for almost every task, even small ones; only trivial single-step questions go untracked.",
};

/** Sample rows for the /checklist settings preview (uses a fake `abc` id). */
export function previewLines(theme: Theme, opts: RenderOpts): string[] {
  const samples: Array<{ kind: StatusKind; title: string }> = [
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

export function renderCreateCall(args: { tasks?: Array<{ title?: string }> }, theme: Theme): Text {
  const n = Array.isArray(args.tasks) ? args.tasks.length : 0;
  return new Text(theme.fg("toolTitle", theme.bold("checklist create ")) + theme.fg("muted", `${n} task(s)`), 0, 0);
}

export function renderReadCall(theme: Theme): Text {
  return new Text(theme.fg("toolTitle", theme.bold("checklist ")), 0, 0);
}

export function renderUpdateCall(args: { updates?: Array<{ id?: string }> }, theme: Theme): Text {
  const ids = Array.isArray(args.updates) ? args.updates.map((u) => u.id).filter(Boolean).join(", ") : "";
  return new Text(
    theme.fg("toolTitle", theme.bold("checklist ")) + theme.fg("accent", ids || "update"),
    0,
    0,
  );
}

export function renderChecklistResult(
  result: { content?: Array<{ type?: string; text?: string }>; details?: unknown },
  expanded: boolean,
  theme: Theme,
): Text {
  const details = result.details as ChecklistSnapshot | undefined;
  const first = result.content?.[0];
  const fallback = first && typeof first === "object" && "text" in first ? String((first as { text: unknown }).text ?? "") : "";
  if (!details || details.v !== 1 || !details.checklist) {
    return new Text(theme.fg("dim", fallback.split("\n")[0] ?? ""), 0, 0);
  }
  const checklist = details.checklist;
  const c = countsOf(checklist);
  const opts: RenderOpts = { style: resolveStatusStyle(details), iconSet: resolveIconSet(details) };
  const summary = theme.fg("muted", `${c.done}/${c.total} done`) + theme.fg("dim", `  ${c.ongoing} ongoing  ${c.ready} ready  ${c.blocked} blocked`);
  if (!expanded) return new Text(summary, 0, 0);
  const views = sortViews(viewsOf(checklist)).slice(0, 10);
  const rows = views.map((v) => {
    const kind = statusKindOf(v);
    const row = theme.fg(colorFor(kind), `${glyphFor(kind, opts)} ${v.id} ${v.title}${v.blocked ? ` ← ${v.blockedBy.join(", ")}` : ""}`);
    return opts.style === "pill" ? `${paintPill(theme, pillFor(kind))}  ${row}` : row;
  });
  return new Text(`${summary}\n${rows.join("\n")}`, 0, 0);
}

// ---------------------------------------------------------------------------
// /checklist overlay component (display-only; agent owns mutations)
// ---------------------------------------------------------------------------

export interface OverlayCallbacks {
  onClose: () => void;
  requestRender: () => void;
}

export class ChecklistOverlay {
  private views: TaskView[];
  private title?: string;
  private theme: Theme;
  private cb: OverlayCallbacks;
  private opts: RenderOpts;
  private selected = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(checklist: Checklist | null, theme: Theme, cb: OverlayCallbacks, opts: RenderOpts = DEFAULT_RENDER_OPTS) {
    this.views = checklist ? sortViews(viewsOf(checklist)) : [];
    this.title = checklist?.title;
    this.theme = theme;
    this.cb = cb;
    this.opts = opts;
  }

  handleInput(data: string): void {
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

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const th = this.theme;
    const inner: string[] = [];
    if (this.views.length === 0) {
      inner.push(`  ${th.fg("dim", "No tasks. Ask the agent to create a checklist!")}`);
    } else {
      const counts = this.views.length;
      const done = this.views.filter((v) => v.status === "done").length;
      inner.push(`  ${th.fg("muted", `${done}/${counts} done`)}`);
      inner.push("");
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
        inner.push(`${cursor}${state}${glyph} ${id} ${title}${dep}`);
      });
    }
    inner.push("");
    inner.push(`  ${th.fg("dim", "j/k or ↑/↓ to move · Esc/q to close")}`);
    // Same rounded-border chrome as the settings dialog: frameDialog draws
    // the ╭─╮/│/╰─╯ border with the title set into the top edge.
    const titleText = `checklist${this.title ? ` — ${this.title}` : ""}`;
    const lines = frameDialog(titleText, inner, width, th);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
