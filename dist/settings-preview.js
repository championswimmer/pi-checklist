import { Key, matchesKey, truncateToWidth, } from "@earendil-works/pi-tui";
import { computeListWindow, renderScrollIndicator } from "pi-extension-settings-tui/dialog";
import { field } from "pi-extension-settings-tui/schema";
import { previewLines } from "./render.js";
class ChecklistPreview {
    params;
    focused = false;
    scrollOffset = 0;
    theme;
    keybindings;
    constructor(params) {
        this.params = params;
        this.theme = params.theme;
        this.keybindings = params.keybindings;
    }
    invalidate() { }
    render(width) {
        const { statusStyle, iconSet, subtasksEnabled } = this.params.draft;
        const rows = previewLines(this.theme, { style: statusStyle, iconSet }, subtasksEnabled);
        const height = this.params.getMaxHeight();
        const window = computeListWindow(rows.length, this.scrollOffset, height);
        this.scrollOffset = window.scrollOffset;
        const visible = rows.slice(window.start, window.end);
        if (height > 2 && window.aboveCount > 0) {
            visible.unshift(renderScrollIndicator("up", window.aboveCount, width, this.theme));
        }
        if (height > 2 && window.belowCount > 0) {
            visible.push(renderScrollIndicator("down", window.belowCount, width, this.theme));
        }
        return visible.map((line) => truncateToWidth(line, width));
    }
    handleInput(data) {
        if (matchesKey(data, Key.escape) || this.keybindings.matches(data, "tui.select.cancel")) {
            this.params.close();
        }
        else if (matchesKey(data, Key.up) || this.keybindings.matches(data, "tui.select.up")) {
            this.scrollOffset--;
            this.params.requestRender();
        }
        else if (matchesKey(data, Key.down) || this.keybindings.matches(data, "tui.select.down")) {
            this.scrollOffset++;
            this.params.requestRender();
        }
    }
    handleMouse(event) {
        if (event.type === "wheel") {
            this.scrollOffset += Math.trunc(event.wheelDelta ?? 0);
            return { handled: true, render: true };
        }
    }
}
export const checklistPreviewField = field.external({
    label: "Preview",
    description: "See sample tasks with the current progress style, icons, and subtasks setting.",
    openSubroute: (params) => new ChecklistPreview(params),
});
