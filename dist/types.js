/** Shared types for pi-checklist. Pure — no pi imports. */
export const DISPLAY_MODES = ["statusbar", "end-of-turn", "hidden"];
export function isDisplayMode(value) {
    return value === "statusbar" || value === "end-of-turn" || value === "hidden";
}
export const STATUS_STYLES = ["color", "pill", "icon"];
export function isStatusStyle(value) {
    return value === "color" || value === "pill" || value === "icon";
}
export const ICON_SETS = ["nerd-font", "emoji"];
export function isIconSet(value) {
    return value === "nerd-font" || value === "emoji";
}
export const USAGE_MODES = ["moderate", "aggressive"];
export function isUsageMode(value) {
    return value === "moderate" || value === "aggressive";
}
/** Tool names that can carry a ChecklistSnapshot in result details. */
export const CHECKLIST_TOOLS = new Set([
    "checklist_create",
    "checklist_read",
    "checklist_update",
]);
export function isChecklistSnapshot(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const v = value;
    return v.v === 1 && ("checklist" in v);
}
