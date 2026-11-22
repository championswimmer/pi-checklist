import type { IconSet, StatusStyle } from "./types.js";
type PreviewSettings = {
    statusStyle: StatusStyle;
    iconSet: IconSet;
    subtasksEnabled: boolean;
};
export declare const checklistPreviewField: import("pi-extension-settings-tui/schema").ExternalFieldDef<PreviewSettings>;
export {};
