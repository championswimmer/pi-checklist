import { type TSchema } from "typebox";
import type { Checklist, ChecklistSnapshot, DisplayMode, IconSet, StatusStyle } from "./types.js";
export declare const ChecklistCreateParams: TSchema;
export declare const ChecklistReadParams: TSchema;
export declare const ChecklistUpdateParams: TSchema;
export declare const CREATE_SNIPPET = "Create or replace the session task checklist.";
export declare const CREATE_GUIDELINES: string[];
export declare const READ_SNIPPET = "Read the session task checklist.";
export declare const READ_GUIDELINES: string[];
export declare const UPDATE_SNIPPET = "Advance tasks through the session checklist.";
export declare const UPDATE_GUIDELINES: string[];
export interface Mutation {
    text: string;
    snapshot: ChecklistSnapshot;
    /** True when the checklist changed and the caller should appendEntry + refresh UI. */
    changed: boolean;
}
export declare function executeCreate(current: Checklist | null, widgetVisible: boolean | undefined, raw: unknown, displayMode?: DisplayMode, statusStyle?: StatusStyle, iconSet?: IconSet): Mutation;
export declare function executeRead(current: Checklist | null, raw: unknown, statusStyle?: StatusStyle, iconSet?: IconSet): Mutation;
export declare function executeUpdate(current: Checklist | null, widgetVisible: boolean | undefined, raw: unknown, displayMode?: DisplayMode, statusStyle?: StatusStyle, iconSet?: IconSet): Mutation;
