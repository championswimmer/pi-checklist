/** TUI surfaces: widget lines, footer text, tool renderers, /checklist overlay. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Checklist, DisplayMode, IconSet, StatusStyle, TaskView } from "./types.js";
type ThemeBgName = Parameters<Theme["bg"]>[0];
type ThemeFgName = Parameters<Theme["fg"]>[0];
/** Display-ready status incl. the planned → ready/blocked split. */
export type StatusKind = "ongoing" | "ready" | "blocked" | "done" | "cancelled";
export interface RenderOpts {
    style: StatusStyle;
    iconSet: IconSet;
}
export declare const DEFAULT_RENDER_OPTS: RenderOpts;
export declare function statusKindOf(v: TaskView): StatusKind;
export declare function glyphFor(kind: StatusKind, opts: RenderOpts): string;
export interface StatusPill {
    label: string;
    bg: ThemeBgName;
    fg: ThemeFgName;
}
export declare function pillFor(kind: StatusKind): StatusPill;
/** A status pill: the label as text on a colored background. */
export declare function paintPill(theme: Theme, pill: StatusPill): string;
/** Row color per status kind (glyph + title, every style). */
export declare function colorFor(kind: StatusKind): ThemeFgName;
export declare function footerText(checklist: Checklist | null): string | undefined;
export interface WidgetLine {
    /** Base row text (glyph + id + title + blocked deps). Never embeds the pill. */
    text: string;
    kind: "header" | "ongoing" | "planned" | "ready" | "blocked" | "done" | "cancelled" | "summary";
    /** Present on task rows; painted as text-on-background when style is "pill". */
    pill?: StatusPill;
}
/** Max task rows before done/cancelled collapse to a count. */
export declare const WIDGET_MAX_LINES = 16;
export declare function widgetLines(checklist: Checklist, opts?: RenderOpts): WidgetLine[];
export declare function paintWidget(checklist: Checklist, theme: Theme, width: number, opts?: RenderOpts): string[];
/** Frame pre-rendered lines as a rounded dialog box with the title set into
 * the top border. pi-tui has no bordered-box component (Box is only
 * padding + background), so dialogs draw their own chrome — same pattern as
 * the overlay-qa-tests example in the pi repo. Every returned line is
 * exactly `width` cells wide (borders included). */
export declare function frameDialog(title: string, inner: string[], width: number, theme: Theme): string[];
export declare const DISPLAY_MODE_LABELS: Record<DisplayMode, string>;
export declare const DISPLAY_MODE_DESCRIPTIONS: Record<DisplayMode, string>;
export declare const STATUS_STYLE_LABELS: Record<StatusStyle, string>;
export declare const STATUS_STYLE_DESCRIPTIONS: Record<StatusStyle, string>;
export declare const ICON_SET_LABELS: Record<IconSet, string>;
export declare const ICON_SET_DESCRIPTIONS: Record<IconSet, string>;
/** Sample rows for the /checklist settings preview (uses a fake `abc` id). */
export declare function previewLines(theme: Theme, opts: RenderOpts): string[];
export declare function renderCreateCall(args: {
    tasks?: Array<{
        title?: string;
    }>;
}, theme: Theme): Text;
export declare function renderReadCall(theme: Theme): Text;
export declare function renderUpdateCall(args: {
    updates?: Array<{
        id?: string;
    }>;
}, theme: Theme): Text;
export declare function renderChecklistResult(result: {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
    details?: unknown;
}, expanded: boolean, theme: Theme): Text;
export interface OverlayCallbacks {
    onClose: () => void;
    requestRender: () => void;
}
export declare class ChecklistOverlay {
    private views;
    private title?;
    private theme;
    private cb;
    private opts;
    private selected;
    private cachedWidth?;
    private cachedLines?;
    constructor(checklist: Checklist | null, theme: Theme, cb: OverlayCallbacks, opts?: RenderOpts);
    handleInput(data: string): void;
    render(width: number): string[];
    invalidate(): void;
}
export {};
