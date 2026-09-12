/** TUI surfaces: widget lines, footer text, tool renderers, /checklist overlay. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Checklist, DisplayMode } from "./types.js";
export declare function footerText(checklist: Checklist | null): string | undefined;
export interface WidgetLine {
    text: string;
    kind: "header" | "ongoing" | "planned" | "ready" | "blocked" | "done" | "cancelled" | "summary";
}
/** Max task rows before done/cancelled collapse to a count. */
export declare const WIDGET_MAX_LINES = 16;
export declare function widgetLines(checklist: Checklist): WidgetLine[];
export declare function paintWidget(checklist: Checklist, theme: Theme, width: number): string[];
export declare const DISPLAY_MODE_LABELS: Record<DisplayMode, string>;
export declare const DISPLAY_MODE_DESCRIPTIONS: Record<DisplayMode, string>;
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
    private selected;
    private cachedWidth?;
    private cachedLines?;
    constructor(checklist: Checklist | null, theme: Theme, cb: OverlayCallbacks);
    handleInput(data: string): void;
    render(width: number): string[];
    invalidate(): void;
}
