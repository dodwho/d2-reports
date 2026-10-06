import React from "react";
import { Tooltip, makeStyles } from "@material-ui/core";
import _ from "lodash";
import i18n from "../../../../locales";
import {
    CellStatus,
    EnrolmentCell,
    trackedEntityCount,
} from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { statusLabel, statusStyles } from "../theme";

/** A compact, colour-coded cell: the colour carries the state, the text the one fact that matters. */
export const StatusChip: React.FC<{ cell: EnrolmentCell | undefined }> = React.memo(({ cell }) => {
    const classes = useStyles();
    if (!cell) return null;

    // An empty cell carries no information worth a pill; a quiet dash keeps six columns readable.
    if (cell.status === "not-enrolled") {
        return (
            <Tooltip title={describeCell(cell)} arrow>
                <span className={classes.empty}>—</span>
            </Tooltip>
        );
    }

    const style = statusStyles[cell.status];
    const duplicates = trackedEntityCount(cell.enrolments);

    return (
        <Tooltip title={describeCell(cell)} arrow>
            <span
                className={classes.chip}
                style={{ color: style.color, background: style.background, borderColor: style.background }}
            >
                {shortText(cell)}
                {duplicates > 1 && <span className={classes.badge}>×{duplicates}</span>}
            </span>
        </Tooltip>
    );
});

export const StatusDot: React.FC<{ status: CellStatus }> = ({ status }) => {
    const classes = useStyles();
    return (
        <span
            className={classes.dot}
            style={{
                background: statusStyles[status].map,
                borderColor: status === "not-enrolled" ? "#b0bec5" : "transparent",
            }}
        />
    );
};

function shortText(cell: EnrolmentCell): string {
    switch (cell.status) {
        case "enrolled":
            return cell.enrolledAt ?? i18n.t("Enrolled");
        case "enrolled-no-contact":
            return i18n.t("No focal point");
        case "inactive":
            return i18n.t("Inactive");
        case "blocked":
            return i18n.t("Not in program");
        case "not-enrolled":
            return "—";
    }
}

export function describeCell(cell: EnrolmentCell): string {
    const parts = [
        `${cell.country.name} — ${cell.module}`,
        statusLabel(cell.status),
        cell.enrolledAt && i18n.t("Enrolled since {{date}}", { date: cell.enrolledAt }),
        cell.status === "enrolled" && i18n.t("{{count}} focal point(s)", { count: cell.contacts.length }),
        trackedEntityCount(cell.enrolments) > 1 &&
            i18n.t("{{count}} duplicate enrolments — see Health", { count: trackedEntityCount(cell.enrolments) }),
    ];
    return _.compact(parts).join(" · ");
}

const useStyles = makeStyles({
    chip: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 12,
        border: "1px solid",
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
        lineHeight: "18px",
    },
    badge: { fontSize: 10, fontWeight: 700, opacity: 0.8 },
    dot: { display: "inline-block", width: 10, height: 10, borderRadius: "50%", flexShrink: 0, border: "1px solid" },
    empty: { color: "#b0bec5", paddingLeft: 10 },
});
