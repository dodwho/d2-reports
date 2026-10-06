import React, { useCallback, useMemo, useState } from "react";
import _ from "lodash";
import { MenuItem, TextField, Typography, makeStyles } from "@material-ui/core";
import BuildIcon from "@material-ui/icons/Build";
import ReplayIcon from "@material-ui/icons/Replay";
import LinkIcon from "@material-ui/icons/Link";
import DeleteSweepIcon from "@material-ui/icons/DeleteSweep";
import OpenInNewIcon from "@material-ui/icons/OpenInNew";
import GetAppIcon from "@material-ui/icons/GetApp";
import { ObjectsList, TableAction, TableConfig, TableGlobalAction } from "@eyeseetea/d2-ui-components";
import i18n from "../../../../locales";
import {
    ChangeSet,
    emptyChangeSet,
    planDeletePlaceholders,
    planEnrol,
    planMerge,
} from "../../../../domain/reports/glass-enrolment/entities/ChangeSet";
import { EnrolmentCell, trackedEntityCount } from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { HistoryAction } from "../../../../domain/reports/glass-enrolment/entities/History";
import { useEnrolment } from "../useEnrolmentData";
import { UrlState } from "../useUrlState";
import { ChangeDialog, NameGroup } from "../components/ChangeDialog";
import { downloadCsv, includesText, useInMemoryTable } from "../tableUtils";
import { palette } from "../theme";

export const checks = ["inactive", "duplicates", "blocked", "placeholders"] as const;
type Check = typeof checks[number];

type HealthRow = {
    id: string;
    countryId: string;
    code: string;
    country: string;
    region: string;
    module: string;
    detail: string;
};

type Fix = {
    title: string;
    action: HistoryAction;
    changes: ChangeSet;
    size: number;
    applyText: string;
    explanation: string;
    names: string[];
    assignedCountryIds?: string[];
};

type Props = { url: UrlState; setUrl(patch: Partial<UrlState>): void };

function checkLabel(check: Check): string {
    switch (check) {
        case "inactive":
            return i18n.t("Inactive enrolments (cancelled or completed)");
        case "duplicates":
            return i18n.t("Duplicated enrolments");
        case "blocked":
            return i18n.t("Countries not in the enrolment program");
        case "placeholders":
            return i18n.t("Empty focal point entries");
    }
}

function checkHelp(check: Check): string {
    switch (check) {
        case "inactive":
            return i18n.t(
                "These countries no longer see the module in GLASS. Usually deliberate; but an enrolment marked 'complete' in the Tracker app by mistake also lands here. Re-enrol any that should be active."
            );
        case "duplicates":
            return i18n.t(
                "The same country recorded more than once for a module, usually from repeated manual enrolment. Merging keeps the oldest active enrolment and copies across any focal points only the duplicates held."
            );
        case "blocked":
            return i18n.t(
                "These organisation units are not assigned to the enrolment program, so DHIS2 refuses to enrol them. Most are former states or territories that should stay out."
            );
        case "placeholders":
            return i18n.t(
                "Blank focal point entries, created automatically when a country is enrolled through the Capture app. They hold nothing and clutter GLASS's country information page."
            );
    }
}

/** Data problems, each with the fix beside it. */
export const HealthTab: React.FC<Props> = ({ url, setUrl }) => {
    const { cells, countryNames, cellIndex, openCountry, newId, canEditProgram } = useEnrolment();
    const classes = useStyles();
    const [fix, setFix] = useState<Fix>();

    const check: Check = (checks as readonly string[]).includes(url.status) ? (url.status as Check) : "inactive";

    const rowsByCheck = useMemo((): Record<Check, HealthRow[]> => {
        const row = (cell: EnrolmentCell, detail: string, module = cell.module): HealthRow => ({
            id: module ? `${cell.country.id}|${module}` : cell.country.id,
            countryId: cell.country.id,
            code: cell.country.code,
            country: cell.country.name,
            region: cell.country.region,
            module,
            detail,
        });

        return {
            inactive: cells
                .filter(cell => cell.status === "inactive")
                .map(cell =>
                    row(
                        cell,
                        _.uniq(cell.enrolments.map(e => e.status.toLowerCase())).join(", ") +
                            ` · ${i18n.t("enrolled {{date}}", { date: _.max(cell.enrolments.map(e => e.enrolledAt)) })}`
                    )
                ),
            duplicates: cells
                .filter(cell => trackedEntityCount(cell.enrolments) > 1)
                .map(cell =>
                    row(cell, i18n.t("recorded {{count}} times", { count: trackedEntityCount(cell.enrolments) }))
                ),
            blocked: _.uniqBy(
                cells.filter(cell => cell.isBlocked),
                cell => cell.country.id
            ).map(cell => row(cell, i18n.t("not assigned to the program"), "")),
            placeholders: cells
                .map(cell => ({ cell, count: _.sumBy(cell.enrolments, e => e.placeholderIds.length) }))
                .filter(({ count }) => count > 0)
                .map(({ cell, count }) => row(cell, i18n.t("{{count}} empty entries", { count }))),
        };
    }, [cells]);

    const rows = rowsByCheck[check];

    const cellsFor = useCallback((ids: string[]) => _.compact(ids.map(id => cellIndex[id])), [cellIndex]);

    const namesOf = useCallback(
        (cellList: EnrolmentCell[]) =>
            _.sortBy(_.uniq(cellList.map(cell => `${cell.country.name}${cell.module ? ` — ${cell.module}` : ""}`))),
        []
    );

    const fixFor = useCallback(
        (ids: string[]): Fix | undefined => {
            switch (check) {
                case "inactive": {
                    const selected = cellsFor(ids);
                    const plan = planEnrol(
                        selected.map(cell => ({ countryId: cell.country.id, module: cell.module })),
                        cellIndex,
                        new Date().toISOString().slice(0, 10),
                        newId
                    );
                    return {
                        title: i18n.t("Re-enrol"),
                        action: "enrol",
                        changes: plan.changes,
                        size: selected.length,
                        applyText: i18n.t("Re-enrol {{count}}", { count: selected.length }),
                        explanation: i18n.t("Each enrolment is set back to active, keeping its date and focal points."),
                        names: namesOf(selected),
                    };
                }
                case "duplicates": {
                    const selected = cellsFor(ids);
                    const merges = selected.map(cell => planMerge(cell.enrolments, newId));
                    return {
                        title: i18n.t("Merge duplicates"),
                        action: "merge",
                        changes: {
                            statusChanges: _.flatMap(merges, m => m.statusChanges),
                            contactChanges: _.flatMap(merges, m => m.contactChanges),
                        },
                        size: selected.length,
                        applyText: i18n.t("Merge {{count}}", { count: selected.length }),
                        explanation: i18n.t(
                            "The redundant enrolments are cancelled, not deleted, and any focal points only they held are copied onto the one kept. Revertible from History."
                        ),
                        names: namesOf(selected),
                    };
                }
                case "blocked": {
                    const countryIds = _.uniq(ids);
                    return {
                        title: i18n.t("Add to the enrolment program"),
                        action: "assign-program",
                        changes: emptyChangeSet,
                        size: countryIds.length,
                        applyText: i18n.t("Add {{count}}", { count: countryIds.length }),
                        explanation: i18n.t(
                            "This changes DHIS2 metadata: the organisation units are added to the enrolment program so they can be enrolled. It does not enrol them. It cannot be previewed or reverted from here."
                        ),
                        names: _.sortBy(countryIds.map(id => countryNames[id] ?? id)),
                        assignedCountryIds: countryIds,
                    };
                }
                case "placeholders": {
                    const selected = cellsFor(ids);
                    const changes = planDeletePlaceholders(selected);
                    return {
                        title: i18n.t("Delete empty entries"),
                        action: "placeholders-delete",
                        changes,
                        size: changes.contactChanges.length,
                        applyText: i18n.t("Delete {{count}}", { count: changes.contactChanges.length }),
                        explanation: i18n.t(
                            "Only entries with no details at all are deleted. Real focal points are not touched."
                        ),
                        names: namesOf(selected),
                    };
                }
            }
        },
        [check, cellsFor, cellIndex, countryNames, namesOf, newId]
    );

    const fixAction = useMemo((): TableAction<HealthRow> => {
        const icon = {
            inactive: <ReplayIcon />,
            duplicates: <BuildIcon />,
            blocked: <LinkIcon />,
            placeholders: <DeleteSweepIcon />,
        }[check];
        const text = {
            inactive: i18n.t("Re-enrol"),
            duplicates: i18n.t("Merge duplicates"),
            blocked: i18n.t("Add to the enrolment program"),
            placeholders: i18n.t("Delete empty entries"),
        }[check];

        return { name: "fix", text, icon, multiple: true, onClick: ids => setFix(fixFor(ids)) };
    }, [check, fixFor]);

    const config = useMemo(
        (): TableConfig<HealthRow> => ({
            columns: [
                { name: "country", text: i18n.t("Country"), sortable: true },
                { name: "code", text: i18n.t("Code"), sortable: true },
                { name: "region", text: i18n.t("Region"), sortable: true },
                { name: "module", text: i18n.t("Module"), sortable: true },
                { name: "detail", text: i18n.t("Detail"), sortable: true },
            ],
            actions: [
                {
                    name: "details",
                    text: i18n.t("Open country"),
                    icon: <OpenInNewIcon />,
                    primary: true,
                    onClick: ids => {
                        const row = rows.find(r => r.id === ids[0]);
                        if (row) openCountry(row.countryId);
                    },
                },
                // Adding to the program is a metadata change; offered only to those DHIS2 lets make it.
                ...(check === "blocked" && !canEditProgram ? [] : [fixAction]),
            ],
            initialSorting: { field: "country", order: "asc" },
            paginationOptions: { pageSizeOptions: [25, 50, 100, 500], pageSizeInitialValue: 50 },
            searchBoxLabel: i18n.t("Search country"),
        }),
        [rows, fixAction, openCountry, check, canEditProgram]
    );

    const matches = useCallback((row: HealthRow, query: string) => includesText(query, row.country, row.code), []);
    const tableProps = useInMemoryTable(config, rows, matches);

    const download: TableGlobalAction = {
        name: "download",
        text: i18n.t("Download CSV"),
        icon: <GetAppIcon />,
        onClick: () =>
            downloadCsv(
                `glass-enrolment-${check}.csv`,
                ["code", "country", "region", "module", "detail"],
                rows.map(row => _.omit(row, ["id", "countryId"]) as Record<string, string>)
            ),
    };

    return (
        <>
            <div className={classes.toolbar}>
                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("Check")}
                    value={check}
                    onChange={event => setUrl({ status: event.target.value })}
                    className={classes.field}
                >
                    {checks.map(key => (
                        <MenuItem key={key} value={key}>
                            {`${checkLabel(key)} (${rowsByCheck[key].length})`}
                        </MenuItem>
                    ))}
                </TextField>
            </div>

            <Typography variant="body2" className={classes.help}>
                {checkHelp(check)}{" "}
                {check === "blocked" && !canEditProgram
                    ? i18n.t(
                          "Your account may not change the enrolment program, so a DHIS2 metadata administrator has to add any that should be enrollable."
                      )
                    : i18n.t("Select rows, then use the action above the table.")}
            </Typography>

            <ObjectsList<HealthRow>
                {...tableProps}
                globalActions={[download]}
                mouseActionsMapping={{ left: { type: "action", action: "details" }, right: { type: "contextual" } }}
            />

            {fix && (
                <ChangeDialog
                    title={fix.title}
                    action={fix.action}
                    changes={fix.changes}
                    size={fix.size}
                    applyText={fix.applyText}
                    isRemoval={fix.action === "placeholders-delete"}
                    options={fix.assignedCountryIds ? { assignedCountryIds: fix.assignedCountryIds } : undefined}
                    skipValidation={Boolean(fix.assignedCountryIds)}
                    onClose={() => setFix(undefined)}
                >
                    <NameGroup label={i18n.t("Selected")} names={fix.names} />
                    <Typography variant="body2" className={classes.help}>
                        {fix.explanation}
                    </Typography>
                </ChangeDialog>
            )}
        </>
    );
};

const useStyles = makeStyles({
    toolbar: { display: "flex", gap: 12, margin: "16px 0 8px" },
    field: { minWidth: 380 },
    help: { color: palette.muted, marginBottom: 8, maxWidth: 900 },
});
