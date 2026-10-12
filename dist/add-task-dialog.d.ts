/** /checklist add: TUI dialog for entering one task by hand (id, text, dependencies). */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable } from "@earendil-works/pi-tui";
import { type RenderOpts } from "./render.js";
import { type AddTaskDraft, type AddTaskResult } from "./store.js";
import type { Checklist } from "./types.js";
export interface AddTaskDialogCallbacks {
    /** Validate + commit the task. The dialog stays open on `ok: false`. */
    onSubmit: (draft: AddTaskDraft) => AddTaskResult;
    /** Close the dialog (after a successful submit or on cancel). */
    onClose: () => void;
    requestRender: () => void;
    /** Max rows the whole dialog may occupy (see dialogMaxRows). Undefined = unlimited. */
    getMaxRows?: () => number | undefined;
}
/** Keep only what a task id may contain: lowercase a–z / 0–9, at most 3 chars. */
export declare function sanitizeIdInput(raw: string): string;
/**
 * The add-task dialog: ID field, Task field, and a checkbox picker over the
 * existing tasks for `dependsOn`. Keyboard only (see `hintFor`). Validation is
 * delegated to `onSubmit` (the store), which checks against the live checklist.
 */
export declare class AddTaskDialog implements Focusable {
    private readonly items;
    private readonly theme;
    private readonly cb;
    private readonly opts;
    private readonly checklist;
    private readonly idInput;
    private readonly titleInput;
    private readonly picked;
    private focus;
    /** Highlighted picker row. */
    private cursor;
    /** First visible picker row when the list is taller than the dialog. */
    private scrollTop;
    private errors;
    private hostFocused;
    constructor(checklist: Checklist | null, initial: {
        id: string;
        title?: string;
    }, theme: Theme, cb: AddTaskDialogCallbacks, opts?: RenderOpts);
    get focused(): boolean;
    set focused(value: boolean);
    private syncFocus;
    /** Field order for Tab / arrows; the picker is skipped when there is nothing to pick. */
    private fields;
    private moveFocus;
    private setFocus;
    private draft;
    private submit;
    handleInput(data: string): void;
    private hintFor;
    private label;
    private errorLines;
    render(width: number): string[];
    invalidate(): void;
}
