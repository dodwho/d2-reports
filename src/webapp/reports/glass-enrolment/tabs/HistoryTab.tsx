import React, { useCallback, useMemo, useState } from "react";
import _ from "lodash";
import { Typography, makeStyles } from "@material-ui/core";
import UndoIcon from "@material-ui/icons/Undo";
import GetAppIcon from "@material-ui/icons/GetApp";
import { ObjectsList, TableConfig, TableGlobalAction } from "@eyeseetea/d2-ui-components";
import i18n from "../../../../locales";
import { ChangeSet, invertChangeSet } from "../../../../domain/reports/glass-enrolment/entities/ChangeSet";
import {
    HistoryRecord,
    canRevert,
    countryIdsOf,
    laterConflicts,
    modulesOf,
    revertingRecord,
} from "../../../../domain/reports/glass-enrolment/entities/History";
import { useEnrolment } from "../useEnrolmentData";
import { UrlState } from "../useUrlState";
import { ChangeDialog, NameGroup } from "../components/ChangeDialog";
import { downloadCsv, includesText, useInMemoryTable } from "../tableUtils";
import { actionLabel, palette } from "../theme";

type HistoryRow = {
    id: string;
    at: string;
    by: string;
    action: string;
    countries: string;
    modules: string;
    detail: string;
    status: string;
};

type Props = { url: UrlState; setUrl(patch: Partial<UrlState>): void };

/**
 * Every change made from this report: who, when, what — and the way back. Reverting applies the
 * inverse change set through the same checked path as any other change, and is itself recorded.
 */
export const HistoryTab: React.FC<Props> = ({ url, setUrl }) => {
    const { history, countryNames, newId } = useEnrolment();
    const classes = useStyles();
    const [reverting, setReverting] = useState<{ record: HistoryRecord; changes: ChangeSet }>();

    const nameOf = useCallback(
        (record: HistoryRecord, id: string) => record.countryNames[id] ?? countryNames[id] ?? id,
        [countryNames]
    );

    const rows = useMemo(
        (): HistoryRow[] =>
            history.map(record => {
                const countries = countryIdsOf(record).map(id => nameOf(record, id));
                const revertedBy = revertingRecord(record, history);

                return {
                    id: record.id,
                    at: record.at.replace("T", " ").slice(0, 16),
                    by: record.by,
                    action: actionLabel(record.action),
                    countries:
                        countries.length > 4
                            ? `${countries.slice(0, 4).join(", ")} +${countries.length - 4}`
                            : countries.join(", "),
                    modules: modulesOf(record).join(", "),
                    detail: describe(record),
                    status:
                        record.status === "applied"
                            ? revertedBy
                                ? i18n.t("Reverted {{date}}", { date: revertedBy.at.slice(0, 10) })
                                : i18n.t("Applied")
                            : record.status === "failed"
                            ? i18n.t("Failed: {{errors}}", { errors: record.errors.join("; ") })
                            : i18n.t("Interrupted"),
                };
            }),
        [history, nameOf]
    );

    const config = useMemo(
        (): TableConfig<HistoryRow> => ({
            columns: [
                { name: "at", text: i18n.t("When (UTC)"), sortable: true },
                { name: "by", text: i18n.t("By"), sortable: true },
                { name: "action", text: i18n.t("Action"), sortable: true },
                { name: "countries", text: i18n.t("Countries"), sortable: true },
                { name: "modules", text: i18n.t("Modules"), sortable: true },
                { name: "detail", text: i18n.t("Detail"), sortable: false },
                { name: "status", text: i18n.t("Status"), sortable: true },
            ],
            actions: [
                {
                    name: "revert",
                    text: i18n.t("Revert"),
                    icon: <UndoIcon />,
                    isActive: selected =>
                        selected.every(row => {
                            const record = history.find(r => r.id === row.id);
                            return Boolean(record && canRevert(record, history));
                        }),
                    onClick: ids => {
                        const record = history.find(r => r.id === ids[0]);
                        if (record) setReverting({ record, changes: invertChangeSet(record.changes, newId) });
                    },
                },
            ],
            initialSorting: { field: "at", order: "desc" },
            paginationOptions: { pageSizeOptions: [25, 50, 100], pageSizeInitialValue: 50 },
            searchBoxLabel: i18n.t("Search country, module or person"),
            initialSearch: url.q,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [history, newId]
    );

    const matches = useCallback(
        (row: HistoryRow, query: string) => includesText(query, row.countries, row.modules, row.by, row.action),
        []
    );
    const tableProps = useInMemoryTable(config, rows, matches);

    const conflicts = reverting ? laterConflicts(reverting.record, history) : [];

    const download: TableGlobalAction = {
        name: "download",
        text: i18n.t("Download CSV"),
        icon: <GetAppIcon />,
        onClick: () =>
            downloadCsv(
                "glass-enrolment-history.csv",
                ["at", "by", "action", "countries", "modules", "detail", "status"],
                rows.map(row => _.omit(row, "id"))
            ),
    };

    return (
        <>
            <Typography variant="body2" className={classes.help}>
                {_.isEmpty(history)
                    ? i18n.t(
                          "Nothing recorded yet. Every change made from this report will appear here, with a way to undo it. DHIS2 itself keeps no usable history of this program, so this log starts with this report."
                      )
                    : i18n.t("Select a change and choose Revert to undo it.")}
            </Typography>

            <ObjectsList<HistoryRow>
                {...tableProps}
                onChangeSearch={value => {
                    tableProps.onChangeSearch?.(value);
                    setUrl({ q: value });
                }}
                globalActions={[download]}
            />

            {reverting && (
                <ChangeDialog
                    title={i18n.t("Revert: {{action}}", { action: actionLabel(reverting.record.action) })}
                    action="revert"
                    changes={reverting.changes}
                    size={reverting.changes.statusChanges.length + reverting.changes.contactChanges.length}
                    applyText={i18n.t("Revert")}
                    options={{ revertOf: reverting.record.id }}
                    onClose={() => setReverting(undefined)}
                >
                    <Typography gutterBottom>
                        {i18n.t("Restores what {{by}} changed on {{date}}:", {
                            by: reverting.record.by,
                            date: reverting.record.at.slice(0, 10),
                        })}
                    </Typography>
                    <Typography variant="body2" className={classes.help}>
                        {describe(reverting.record)}
                    </Typography>

                    {!_.isEmpty(conflicts) && (
                        <div className={classes.warning}>
                            <NameGroup
                                label={i18n.t("Later changes to the same items will also be undone")}
                                names={conflicts.map(c => `${c.at.slice(0, 10)} ${actionLabel(c.action)} (${c.by})`)}
                                tone="warning"
                            />
                        </div>
                    )}
                </ChangeDialog>
            )}
        </>
    );
};

function describe(record: HistoryRecord): string {
    const statuses = _.countBy(record.changes.statusChanges, change =>
        change.from === "NONE"
            ? i18n.t("new enrolment")
            : change.to === "ACTIVE"
            ? i18n.t("enrolment reactivated")
            : i18n.t("enrolment cancelled")
    );
    const contacts = _.countBy(record.changes.contactChanges, change =>
        !change.before
            ? i18n.t("focal point added")
            : !change.after
            ? i18n.t("focal point removed")
            : i18n.t("focal point edited")
    );
    const assigned = record.assignedCountryIds.length
        ? { [i18n.t("added to program")]: record.assignedCountryIds.length }
        : {};

    return _.map({ ...statuses, ...contacts, ...assigned }, (count, label) => `${count} × ${label}`).join(" · ");
}

const useStyles = makeStyles({
    help: { color: palette.muted, margin: "16px 0 8px", maxWidth: 900 },
    warning: { marginTop: 12 },
});
