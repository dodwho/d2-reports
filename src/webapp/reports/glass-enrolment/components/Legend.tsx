import React from "react";
import { makeStyles } from "@material-ui/core";
import { CellStatus } from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { palette, statusLabel, statusOrder } from "../theme";
import { StatusDot } from "./StatusChip";

/** The colour key, with counts when there is a single module to count for. */
export const Legend: React.FC<{ counts?: Partial<Record<CellStatus, number>> }> = React.memo(({ counts }) => {
    const classes = useStyles();

    return (
        <div className={classes.legend}>
            {statusOrder.map(status => (
                <span key={status} className={classes.item}>
                    <StatusDot status={status} />
                    {statusLabel(status)}
                    {counts && <strong>{counts[status] ?? 0}</strong>}
                </span>
            ))}
        </div>
    );
});

const useStyles = makeStyles({
    legend: { display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: palette.muted },
    item: { display: "inline-flex", alignItems: "center", gap: 6 },
});
