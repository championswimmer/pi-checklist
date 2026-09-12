/** Shared types for pi-checklist. Pure — no pi imports. */
export const DISPLAY_MODES = ["statusbar", "end-of-turn", "hidden"];
export function isDisplayMode(value) {
    return value === "statusbar" || value === "end-of-turn" || value === "hidden";
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
