/** TUI surfaces: widget lines, footer text, tool renderers, /checklist overlay. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { countsOf, sortViews, viewsOf } from "./store.js";
import type { Checklist, ChecklistSnapshot, TaskView } from "./types.js";

// ---------------------------------------------------------------------------
// Widget + footer (pure line builders; theme applied by the caller)
// ---------------------------------------------------------------------------

const GLYPHS: Record<TaskView["status"], string> = {
  ongoing: "●",
  planned: "○",
  done: "✓",
  cancelled: "✕",
};

export function footerText(checklist: Checklist | null): string | undefined {
  if (!checklist || checklist.tasks.length === 0) return undefined;
  const c = countsOf(checklist);
  return `☑ ${c.done}/${c.total}`;
}

export interface WidgetLine {
  text: string;
  kind: "header" | "ongoing" | "planned" | "ready" | "blocked" | "done" | "cancelled" | "summary";
}

/** Max task rows before done/cancelled collapse to a count. */
export const WIDGET_MAX_LINES = 16;

export function widgetLines(checklist: Checklist): WidgetLine[] {
  const views = sortViews(viewsOf(checklist));
  const c = countsOf(checklist);
  const lines: WidgetLine[] = [];
  const title = checklist.title ? ` ${checklist.title}` : "";
  lines.push({
    kind: "header",
    text: `checklist${title}  ${c.done}/${c.total} done   ${c.ongoing} ongoing   ${c.ready} ready   ${c.blocked} blocked`,
  });

  const active = views.filter((v) => v.status === "ongoing" || v.status === "planned");
  const finished = views.filter((v) => v.status === "done" || v.status === "cancelled");
  const room = WIDGET_MAX_LINES - 1; // header takes one

  for (const v of active.slice(0, room)) {
    const glyph = v.status === "ongoing" ? GLYPHS.ongoing : GLYPHS.planned;
    const state = v.status === "ongoing" ? "ongoing" : v.blocked ? `blocked ← ${v.blockedBy.join(", ")}` : "ready";
    lines.push({ kind: v.status === "ongoing" ? "ongoing" : v.blocked ? "blocked" : "ready", text: `${glyph} ${v.id}  ${v.title}  ${state}` });
  }
  const shownActive = Math.min(active.length, room);
  const remaining = room - shownActive;
  const shownFinished = finished.slice(0, Math.max(0, remaining));
  for (const v of shownFinished) {
    const glyph = GLYPHS[v.status];
    lines.push({ kind: v.status, text: `${glyph} ${v.id}  ${v.title}  ${v.status}` });
  }
  const hiddenFinished = finished.length - shownFinished.length;
  const hiddenActive = active.length - shownActive;
  if (hiddenFinished > 0 || hiddenActive > 0) {
    const doneHidden = finished.filter((v) => v.status === "done").length - shownFinished.filter((v) => v.status === "done").length;
    const cxHidden = finished.filter((v) => v.status === "cancelled").length - shownFinished.filter((v) => v.status === "cancelled").length;
    const bits: string[] = [];
    if (hiddenActive > 0) bits.push(`+${hiddenActive} active`);
    if (doneHidden > 0) bits.push(`✓ ${doneHidden} done`);
    if (cxHidden > 0) bits.push(`✕ ${cxHidden} cancelled`);
    lines.push({ kind: "summary", text: `… ${bits.join("  ")}` });
  }
  return lines;
}

function paintLine(line: WidgetLine, theme: Theme, width: number): string {
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
  return truncateToWidth(colored, width);
}

export function paintWidget(checklist: Checklist, theme: Theme, width: number): string[] {
  return widgetLines(checklist).map((l) => paintLine(l, theme, width));
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
  const summary = theme.fg("muted", `${c.done}/${c.total} done`) + theme.fg("dim", `  ${c.ongoing} ongoing  ${c.ready} ready  ${c.blocked} blocked`);
  if (!expanded) return new Text(summary, 0, 0);
  const views = sortViews(viewsOf(checklist)).slice(0, 10);
  const rows = views.map((v) => {
    const glyph = GLYPHS[v.status];
    const color = v.status === "done" ? "success" : v.status === "ongoing" ? "warning" : v.status === "cancelled" ? "dim" : "text";
    return theme.fg(color, `${glyph} ${v.id} ${v.title}`);
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
  private selected = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(checklist: Checklist | null, theme: Theme, cb: OverlayCallbacks) {
    this.views = checklist ? sortViews(viewsOf(checklist)) : [];
    this.title = checklist?.title;
    this.theme = theme;
    this.cb = cb;
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
    const lines: string[] = [""];
    const title = th.fg("accent", ` checklist${this.title ? ` — ${this.title}` : ""} `);
    const rule = Math.max(0, width - 14 - (this.title ? this.title.length + 3 : 0));
    lines.push(truncateToWidth(th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(rule)), width));
    lines.push("");
    if (this.views.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks. Ask the agent to create a checklist!")}`, width));
    } else {
      const counts = this.views.length;
      const done = this.views.filter((v) => v.status === "done").length;
      lines.push(truncateToWidth(`  ${th.fg("muted", `${done}/${counts} done`)}`, width));
      lines.push("");
      this.views.forEach((v, i) => {
        const cursor = i === this.selected ? th.fg("accent", "› ") : "  ";
        const glyph = GLYPHS[v.status];
        const glyphColor = v.status === "done" ? "success" : v.status === "ongoing" ? "warning" : "dim";
        const id = th.fg("accent", v.id);
        const text = v.status === "done" || v.status === "cancelled" ? th.fg("dim", v.title) : th.fg("text", v.title);
        const state = v.status === "ongoing" ? th.fg("warning", " ongoing") : v.blocked ? th.fg("dim", ` blocked ← ${v.blockedBy.join(", ")}`) : v.ready ? th.fg("success", " ready") : th.fg("dim", ` ${v.status}`);
        const dep = v.dependsOn.length > 0 && !v.blocked ? th.fg("dim", ` ← ${v.dependsOn.join(", ")}`) : "";
        lines.push(truncateToWidth(`${cursor}${th.fg(glyphColor, glyph)} ${id} ${text}${state}${dep}`, width));
      });
    }
    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "j/k or ↑/↓ to move · Esc/q to close")}`, width));
    lines.push("");
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
