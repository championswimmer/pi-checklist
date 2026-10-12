import { Input, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { colorFor, DEFAULT_RENDER_OPTS, frameDialog, glyphFor, statusKindOf } from "./render.js";
import { suggestTaskId, viewsOf } from "./store.js";
/** Rows the dialog uses besides the picker's task rows are counted at render
 * time; this is only the frame (top + bottom border). */
const FRAME_ROWS = 2;
const LABEL_WIDTH = 10; // "Depends on"
/** marker (2) + label + space, inside the 1-col left pad. */
const PREFIX_WIDTH = 1 + 2 + LABEL_WIDTH + 1;
/** Keep only what a task id may contain: lowercase a–z / 0–9, at most 3 chars. */
export function sanitizeIdInput(raw) {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 3);
}
/** Replace an Input's text and leave the cursor at the end (setValue alone keeps it at 0). */
function fillInput(input, text) {
    input.setValue("");
    if (text !== "")
        input.handleInput(`\x1b[200~${text}\x1b[201~`);
}
/**
 * The add-task dialog: ID field, Task field, and a checkbox picker over the
 * existing tasks for `dependsOn`. Keyboard only (see `hintFor`). Validation is
 * delegated to `onSubmit` (the store), which checks against the live checklist.
 */
export class AddTaskDialog {
    items;
    theme;
    cb;
    opts;
    checklist;
    idInput = new Input({ prompt: "" });
    titleInput;
    picked = new Set();
    focus = "title";
    /** Highlighted picker row. */
    cursor = 0;
    /** First visible picker row when the list is taller than the dialog. */
    scrollTop = 0;
    errors = {};
    hostFocused = false;
    constructor(checklist, initial, theme, cb, opts = DEFAULT_RENDER_OPTS) {
        this.checklist = checklist;
        this.items = checklist ? viewsOf(checklist) : [];
        this.theme = theme;
        this.cb = cb;
        this.opts = opts;
        fillInput(this.idInput, sanitizeIdInput(initial.id));
        this.titleInput = new Input({ prompt: "", placeholder: "what needs doing?", placeholderStyle: (s) => theme.fg("dim", s) });
        fillInput(this.titleInput, (initial.title ?? "").replace(/[\r\n]+/g, " ").trim());
        this.syncFocus();
    }
    // -- Focusable: forward the host's focus to the visible text input (IME cursor) --
    get focused() {
        return this.hostFocused;
    }
    set focused(value) {
        this.hostFocused = value;
        this.syncFocus();
    }
    syncFocus() {
        this.idInput.focused = this.hostFocused && this.focus === "id";
        this.titleInput.focused = this.hostFocused && this.focus === "title";
    }
    // -- state helpers ----------------------------------------------------------
    /** Field order for Tab / arrows; the picker is skipped when there is nothing to pick. */
    fields() {
        return this.items.length > 0 ? ["id", "title", "deps"] : ["id", "title"];
    }
    moveFocus(delta, wrap) {
        const fields = this.fields();
        const at = fields.indexOf(this.focus);
        let next = at + delta;
        if (wrap)
            next = (next + fields.length) % fields.length;
        next = Math.max(0, Math.min(fields.length - 1, next));
        this.setFocus(fields[next]);
    }
    setFocus(field) {
        this.focus = field;
        this.syncFocus();
    }
    draft() {
        return {
            id: this.idInput.getValue(),
            title: this.titleInput.getValue(),
            dependsOn: this.items.filter((v) => this.picked.has(v.id)).map((v) => v.id),
        };
    }
    submit() {
        const result = this.cb.onSubmit(this.draft());
        if (result.ok) {
            this.cb.onClose();
            return;
        }
        this.errors = result.errors;
        // Jump to the first field with a problem.
        if (result.errors.id)
            this.setFocus("id");
        else if (result.errors.title)
            this.setFocus("title");
        else if (result.errors.dependsOn && this.items.length > 0)
            this.setFocus("deps");
        this.cb.requestRender();
    }
    // -- input ------------------------------------------------------------------
    handleInput(data) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
            this.cb.onClose();
            return;
        }
        if (matchesKey(data, "enter")) {
            this.submit();
            return;
        }
        if (matchesKey(data, "tab")) {
            this.moveFocus(1, true);
            this.cb.requestRender();
            return;
        }
        if (matchesKey(data, "shift+tab")) {
            this.moveFocus(-1, true);
            this.cb.requestRender();
            return;
        }
        if (matchesKey(data, "ctrl+r")) {
            fillInput(this.idInput, suggestTaskId(this.checklist));
            this.errors = { ...this.errors, id: undefined };
            this.cb.requestRender();
            return;
        }
        if (this.focus === "deps") {
            if (matchesKey(data, "up") || data === "k") {
                if (this.cursor > 0)
                    this.cursor--;
                else
                    this.setFocus("title");
            }
            else if (matchesKey(data, "down") || data === "j") {
                if (this.cursor < this.items.length - 1)
                    this.cursor++;
            }
            else if (matchesKey(data, "space") || data === " " || data === "x") {
                const id = this.items[this.cursor]?.id;
                if (id !== undefined && !this.picked.delete(id))
                    this.picked.add(id);
                this.errors = { ...this.errors, dependsOn: undefined };
            }
            else {
                return;
            }
            this.cb.requestRender();
            return;
        }
        // Text fields: ↑/↓ move between fields, everything else edits the text.
        if (matchesKey(data, "up")) {
            this.moveFocus(-1, false);
            this.cb.requestRender();
            return;
        }
        if (matchesKey(data, "down")) {
            this.moveFocus(1, false);
            this.cb.requestRender();
            return;
        }
        if (this.focus === "id") {
            this.idInput.handleInput(data);
            const clean = sanitizeIdInput(this.idInput.getValue());
            if (clean !== this.idInput.getValue())
                this.idInput.setValue(clean); // cursor is clamped to the new length
            this.errors = { ...this.errors, id: undefined };
        }
        else {
            this.titleInput.handleInput(data);
            this.errors = { ...this.errors, title: undefined };
        }
        this.cb.requestRender();
    }
    // -- render -----------------------------------------------------------------
    hintFor() {
        if (this.focus === "deps")
            return "↑/↓ move · Space toggle · Tab next · Enter add task · Esc cancel";
        if (this.focus === "id")
            return "Tab/↓ next · Ctrl+R new id · Enter add task · Esc cancel";
        return "Tab/↓ next · Enter add task · Esc cancel";
    }
    label(text, field) {
        const th = this.theme;
        const active = this.focus === field;
        const bad = field === "deps" ? this.errors.dependsOn : this.errors[field];
        const color = bad ? "error" : active ? "accent" : "muted";
        const marker = active ? th.fg("accent", "› ") : "  ";
        return ` ${marker}${th.fg(color, active ? th.bold(text.padEnd(LABEL_WIDTH)) : text.padEnd(LABEL_WIDTH))} `;
    }
    errorLines(message, innerW) {
        if (!message)
            return [];
        const width = Math.max(1, innerW - PREFIX_WIDTH - 1);
        return wrapTextWithAnsi(this.theme.fg("error", `✗ ${message}`), width).map((l) => " ".repeat(PREFIX_WIDTH) + l);
    }
    render(width) {
        const th = this.theme;
        const innerW = Math.max(1, width - 2);
        const fieldW = Math.max(1, innerW - PREFIX_WIDTH - 1);
        const lines = [];
        // ID: a 3-char input (+ cursor cell) followed by a dim hint.
        const idCells = Math.min(4, fieldW);
        const idText = this.focus === "id"
            ? this.idInput.render(idCells)[0]
            : truncateToWidth(this.idInput.getValue() || th.fg("dim", "---"), idCells, "", true);
        const idHint = fieldW > idCells + 2 ? truncateToWidth(th.fg("dim", "  3 chars: a–z, 0–9 · Ctrl+R new"), fieldW - idCells, "") : "";
        lines.push(this.label("ID", "id") + idText + idHint);
        lines.push(...this.errorLines(this.errors.id, innerW));
        // Task text.
        const titleText = this.focus === "title"
            ? this.titleInput.render(fieldW)[0]
            : this.titleInput.getValue() !== ""
                ? truncateToWidth(this.titleInput.getValue(), fieldW)
                : th.fg("dim", truncateToWidth("what needs doing?", fieldW, ""));
        lines.push(this.label("Task", "title") + titleText);
        lines.push(...this.errorLines(this.errors.title, innerW));
        lines.push("");
        // Dependencies header (+ scroll range, filled once the window is known).
        const headerIdx = lines.push("") - 1;
        const tail = [];
        tail.push(...this.errorLines(this.errors.dependsOn, innerW));
        tail.push(...this.errorLines(this.errors.form, innerW));
        tail.push("");
        for (const l of wrapTextWithAnsi(th.fg("dim", this.hintFor()), Math.max(1, innerW - 2)))
            tail.push(`  ${l}`);
        // Picker rows, windowed to whatever height is left.
        const maxRows = this.cb.getMaxRows?.();
        const n = this.items.length;
        const budget = maxRows === undefined ? Number.POSITIVE_INFINITY : Math.max(1, maxRows - FRAME_ROWS - lines.length - tail.length);
        let start = 0;
        let end = n;
        if (n > budget) {
            start = Math.min(this.scrollTop, this.cursor);
            if (this.cursor >= start + budget)
                start = this.cursor - budget + 1;
            start = Math.max(0, Math.min(start, n - budget));
            end = start + budget;
        }
        this.scrollTop = start;
        const picked = this.picked.size;
        const range = n > end - start ? ` · ${start + 1}–${end} of ${n}` : "";
        const summary = n === 0 ? "" : `(optional) · ${picked} selected${range}`;
        lines[headerIdx] = this.label("Depends on", "deps") + th.fg("dim", truncateToWidth(summary, fieldW, ""));
        if (n === 0) {
            lines.push(" ".repeat(PREFIX_WIDTH) + th.fg("dim", truncateToWidth("no tasks yet, nothing to depend on", fieldW, "")));
        }
        for (let i = start; i < end; i++) {
            const v = this.items[i];
            const kind = statusKindOf(v);
            const color = colorFor(kind);
            const here = this.focus === "deps" && i === this.cursor;
            const box = this.picked.has(v.id) ? th.fg("success", "[x]") : th.fg("dim", "[ ]");
            const title = v.status === "done" || v.status === "cancelled" ? th.fg("dim", v.title) : th.fg(color, v.title);
            const row = `${here ? th.fg("accent", "› ") : "  "}${box} ${th.fg(color, glyphFor(kind, this.opts))} ${th.fg("accent", v.id)} ${title}`;
            lines.push(" ".repeat(PREFIX_WIDTH - 2) + truncateToWidth(row, Math.max(1, innerW - PREFIX_WIDTH + 2), "..."));
        }
        lines.push(...tail);
        return frameDialog("Add checklist task", lines, width, th);
    }
    invalidate() {
        // Rendering is recomputed from state on every call; nothing is cached.
    }
}
