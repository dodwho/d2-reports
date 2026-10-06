import { CellStatus } from "../../../domain/reports/glass-enrolment/entities/Enrolment";
import { HistoryAction } from "../../../domain/reports/glass-enrolment/entities/History";
import i18n from "../../../locales";

/**
 * One palette for every view, so a colour means the same thing in the table, on the map and in
 * the legend. Text colours are chosen to stay readable on their backgrounds.
 */
export const statusStyles: Record<CellStatus, { color: string; background: string; map: string }> = {
    enrolled: { color: "#1b5e20", background: "#c8e6c9", map: "#43a047" },
    "enrolled-no-contact": { color: "#7a4100", background: "#ffe0b2", map: "#fb8c00" },
    inactive: { color: "#424242", background: "#e0e0e0", map: "#9e9e9e" },
    "not-enrolled": { color: "#757575", background: "#ffffff", map: "#eceff1" },
    blocked: { color: "#b71c1c", background: "#ffebee", map: "#ef9a9a" },
};

export const statusOrder: CellStatus[] = ["enrolled", "enrolled-no-contact", "inactive", "not-enrolled", "blocked"];

/** Labels are looked up when rendered, so they follow the user's language. */
export function statusLabel(status: CellStatus): string {
    switch (status) {
        case "enrolled":
            return i18n.t("Enrolled");
        case "enrolled-no-contact":
            return i18n.t("Enrolled, no focal point");
        case "inactive":
            return i18n.t("Inactive (cancelled or completed)");
        case "not-enrolled":
            return i18n.t("Not enrolled");
        case "blocked":
            return i18n.t("Cannot be enrolled");
    }
}

export function actionLabel(action: HistoryAction): string {
    switch (action) {
        case "enrol":
            return i18n.t("Enrolled");
        case "unenrol":
            return i18n.t("Un-enrolled");
        case "merge":
            return i18n.t("Merged duplicates");
        case "assign-program":
            return i18n.t("Added to program");
        case "contact-add":
            return i18n.t("Focal point added");
        case "contact-edit":
            return i18n.t("Focal point edited");
        case "contact-replace":
            return i18n.t("Focal point replaced");
        case "contact-remove":
            return i18n.t("Focal point removed");
        case "placeholders-delete":
            return i18n.t("Empty entries deleted");
        case "revert":
            return i18n.t("Reverted");
    }
}

export const palette = {
    primary: "#0099de",
    border: "#e0e0e0",
    muted: "#6b7280",
    surface: "#f4f6f8",
    danger: "#b71c1c",
};
