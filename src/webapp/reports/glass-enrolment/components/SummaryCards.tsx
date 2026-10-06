import React, { useMemo } from "react";
import _ from "lodash";
import { ButtonBase, makeStyles } from "@material-ui/core";
import i18n from "../../../../locales";
import { isEnrolled, trackedEntityCount } from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { useEnrolment } from "../useEnrolmentData";
import { palette, statusStyles } from "../theme";

/** The headline numbers; each card opens the view that explains it. */
export const SummaryCards: React.FC = React.memo(() => {
    const { cells, showTab } = useEnrolment();
    const classes = useStyles();

    const stats = useMemo(() => {
        const enrolled = cells.filter(isEnrolled);
        return {
            enrolments: enrolled.length,
            countries: _.uniq(enrolled.map(cell => cell.country.id)).length,
            noContact: cells.filter(cell => cell.status === "enrolled-no-contact").length,
            inactive: cells.filter(cell => cell.status === "inactive").length,
            duplicates: cells.filter(cell => trackedEntityCount(cell.enrolments) > 1).length,
        };
    }, [cells]);

    const cards = [
        {
            value: stats.enrolments,
            label: i18n.t("Active enrolments"),
            detail: i18n.t("across {{count}} countries", { count: stats.countries }),
            accent: statusStyles.enrolled.map,
            onClick: () => showTab("countries"),
        },
        {
            value: stats.noContact,
            label: i18n.t("Without a focal point"),
            detail: i18n.t("nobody to contact"),
            accent: statusStyles["enrolled-no-contact"].map,
            onClick: () => showTab("gaps"),
        },
        {
            value: stats.inactive,
            label: i18n.t("Inactive enrolments"),
            detail: i18n.t("cancelled or completed"),
            accent: statusStyles.inactive.map,
            onClick: () => showTab("health", { status: "inactive" }),
        },
        {
            value: stats.duplicates,
            label: i18n.t("Duplicated"),
            detail: i18n.t("country and module pairs"),
            accent: palette.danger,
            onClick: () => showTab("health", { status: "duplicates" }),
        },
    ];

    return (
        <div className={classes.row}>
            {cards.map(card => (
                <ButtonBase key={card.label} className={classes.card} onClick={card.onClick} focusRipple>
                    <span className={classes.accent} style={{ background: card.accent }} />
                    <span className={classes.value}>{card.value}</span>
                    <span className={classes.label}>{card.label}</span>
                    <span className={classes.detail}>{card.detail}</span>
                </ButtonBase>
            ))}
        </div>
    );
});

const useStyles = makeStyles({
    row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, margin: "8px 0 4px" },
    card: {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        padding: "14px 16px 12px 20px",
        background: "#fff",
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        textAlign: "left",
        overflow: "hidden",
        "&:hover": { boxShadow: "0 2px 8px rgba(0,0,0,0.08)" },
    },
    accent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
    value: { fontSize: 28, fontWeight: 600, lineHeight: 1.1 },
    label: { fontSize: 14, fontWeight: 500, marginTop: 4 },
    detail: { fontSize: 12, color: palette.muted },
});
