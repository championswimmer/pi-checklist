import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type KeybindingsManager,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { computeListWindow, renderScrollIndicator, type DialogRouteComponent } from "pi-extension-settings-tui/dialog";
import { field, type ExternalSubrouteParams } from "pi-extension-settings-tui/schema";
import { previewLines } from "./render.js";
import type { IconSet, StatusStyle } from "./types.js";

type PreviewSettings = {
  statusStyle: StatusStyle;
  iconSet: IconSet;
  subtasksEnabled: boolean;
};

class ChecklistPreview implements DialogRouteComponent {
  focused = false;
  private scrollOffset = 0;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;

  constructor(private readonly params: ExternalSubrouteParams<PreviewSettings>) {
    this.theme = params.theme as Theme;
    this.keybindings = params.keybindings as KeybindingsManager;
  }

  invalidate(): void {}

  render(width: number): string[] {
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

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || this.keybindings.matches(data, "tui.select.cancel")) {
      this.params.close();
    } else if (matchesKey(data, Key.up) || this.keybindings.matches(data, "tui.select.up")) {
      this.scrollOffset--;
      this.params.requestRender();
    } else if (matchesKey(data, Key.down) || this.keybindings.matches(data, "tui.select.down")) {
      this.scrollOffset++;
      this.params.requestRender();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      this.scrollOffset += Math.trunc(event.wheelDelta ?? 0);
      return { handled: true, render: true };
    }
  }
}

export const checklistPreviewField = field.external<PreviewSettings>({
  label: "Preview",
  description: "See sample tasks with the current progress style, icons, and subtasks setting.",
  openSubroute: (params) => new ChecklistPreview(params),
});
