import React, { useCallback, useMemo } from "react";
import _ from "lodash";
import { MenuItem, TextField, Typography, makeStyles } from "@material-ui/core";
import GetAppIcon from "@material-ui/icons/GetApp";
import MailOutlineIcon from "@material-ui/icons/MailOutline";
import OpenInNewIcon from "@material-ui/icons/OpenInNew";
import PersonAddIcon from "@material-ui/icons/PersonAdd";
import { ObjectsList, TableConfig, TableGlobalAction, useSnackbar } from "@eyeseetea/d2-ui-components";
import i18n from "../../../../locales";
import {
    STALE_AFTER_YEARS,
    isEnrolled,
    isStale,
    keyOf,
} from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { useEnrolment } from "../useEnrolmentData";
import { UrlState } from "../useUrlState";
import { copyEmails, downloadCsv, includesText, useInMemoryTable } from "../tableUtils";
import { palette } from "../theme";

type Issue = "no-contact" | "no-email" | "stale";

type GapRow = {
    id: string;
    countryId: string;
    code: string;
    country: string;
    region: string;
    module: string;
    enrolledAt: string;
    issue: string;
    issueKind: Issue;
    emails: string;
};

type Props = { url: UrlState; setUrl(patch: Partial<UrlState>): void };

function issueLabel(issue: Issue): string {
    switch (issue) {
        case "no-contact":
            return i18n.t("No focal point");
        case "no-email":
            return i18n.t("No email address");
        case "stale":
            return i18n.t("Not updated for {{years}}+ years", { years: STALE_AFTER_YEARS });
    }
}

/**
 * Active enrolments nobody can be reached about, or whose details are likely out of date. The
 * point is a list to act on: export it per module, or copy the addresses that do exist.
 */
export const GapsTab: React.FC<Props> = ({ url, setUrl }) => {
    const { cells, moduleNames, cellIndex, openCountry, addContact } = useEnrolment();
    const snackbar = useSnackbar();
    const classes = useStyles();
    const issueFilter = (["no-contact", "no-email", "stale"] as Issue[]).includes(url.status as Issue)
        ? (url.status as Issue)
        : "";

    const allRows = useMemo((): GapRow[] => {
        const now = new Date();

        return _.compact(
            cells.filter(isEnrolled).map(cell => {
                const issue: Issue | undefined = _.isEmpty(cell.contacts)
                    ? "no-contact"
                    : cell.contacts.every(contact => !contact.email)
                    ? "no-email"
                    : cell.contacts.every(contact => isStale(contact, now))
                    ? "stale"
                    : undefined;

                if (!issue) return undefined;

                return {
                    id: keyOf({ countryId: cell.country.id, module: cell.module }),
                    countryId: cell.country.id,
                    code: cell.country.code,
                    country: cell.country.name,
                    region: cell.country.region,
                    module: cell.module,
                    enrolledAt: cell.enrolledAt ?? "",
                    issue: issueLabel(issue),
                    issueKind: issue,
                    emails: cell.contacts
                        .map(contact => contact.email)
                        .filter(email => email)
                        .join("; "),
                };
            })
        );
    }, [cells]);

    const rows = useMemo(
        () =>
            allRows.filter(
                row => (!url.module || row.module === url.module) && (!issueFilter || row.issueKind === issueFilter)
            ),
        [allRows, url.module, issueFilter]
    );

    const byModule = useMemo(() => _.countBy(allRows, row => row.module), [allRows]);

    const config = useMemo(
        (): TableConfig<GapRow> => ({
            columns: [
                { name: "country", text: i18n.t("Country"), sortable: true },
                { name: "code", text: i18n.t("Code"), sortable: true },
                { name: "region", text: i18n.t("Region"), sortable: true },
                { name: "module", text: i18n.t("Module"), sortable: true },
                { name: "enrolledAt", text: i18n.t("Enrolled since"), sortable: true },
                { name: "issue", text: i18n.t("What is missing"), sortable: true },
                { name: "emails", text: i18n.t("Known emails"), sortable: false },
            ],
            actions: [
                {
                    name: "details",
                    text: i18n.t("Open country"),
                    icon: <OpenInNewIcon />,
                    primary: true,
                    onClick: ids => {
                        const row = allRows.find(r => r.id === ids[0]);
                        if (row) openCountry(row.countryId);
                    },
                },
                {
                    name: "add",
                    text: i18n.t("Add focal point"),
                    icon: <PersonAddIcon />,
                    onClick: ids => {
                        const cell = ids[0] ? cellIndex[ids[0]] : undefined;
                        if (cell) addContact(cell);
                    },
                },
            ],
            initialSorting: { field: "country", order: "asc" },
            paginationOptions: { pageSizeOptions: [25, 50, 100, 500], pageSizeInitialValue: 50 },
            searchBoxLabel: i18n.t("Search country"),
        }),
        [allRows, cellIndex, openCountry, addContact]
    );

    const matches = useCallback((row: GapRow, query: string) => includesText(query, row.country, row.code), []);
    const tableProps = useInMemoryTable(config, rows, matches);

    const globalActions: TableGlobalAction[] = [
        {
            name: "download",
            text: i18n.t("Download chase list"),
            icon: <GetAppIcon />,
            onClick: () =>
                downloadCsv(
                    url.module ? `glass-focal-point-gaps-${url.module}.csv` : "glass-focal-point-gaps.csv",
                    ["code", "country", "region", "module", "enrolledAt", "issue", "emails"],
                    rows.map(row => _.omit(row, ["id", "countryId", "issueKind"]) as Record<string, string>)
                ),
        },
        {
            name: "copy",
            text: i18n.t("Copy the listed emails, to ask for an update"),
            icon: <MailOutlineIcon />,
            onClick: async () => {
                const count = await copyEmails(_.flatMap(rows, row => row.emails.split(";")));
                snackbar.info(i18n.t("{{count}} email addresses copied — paste into the To field", { count }));
            },
        },
    ];

    return (
        <>
            <Typography className={classes.summary}>
                {i18n.t("{{count}} active enrolments need attention.", { count: allRows.length })}{" "}
                <span className={classes.muted}>
                    {_.map(byModule, (count, module) => `${module}: ${count}`).join(" · ")}
                </span>
            </Typography>

            <div className={classes.toolbar}>
                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("Module")}
                    value={url.module}
                    onChange={event => setUrl({ module: event.target.value })}
                    className={classes.field}
                >
                    <MenuItem value="">{i18n.t("All modules")}</MenuItem>
                    {moduleNames.map(module => (
                        <MenuItem key={module} value={module}>
                            {`${module} (${byModule[module] ?? 0})`}
                        </MenuItem>
                    ))}
                </TextField>

                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("What is missing")}
                    value={issueFilter}
                    onChange={event => setUrl({ status: event.target.value })}
                    className={classes.field}
                >
                    <MenuItem value="">{i18n.t("Anything")}</MenuItem>
                    {(["no-contact", "no-email", "stale"] as Issue[]).map(issue => (
                        <MenuItem key={issue} value={issue}>
                            {issueLabel(issue)}
                        </MenuItem>
                    ))}
                </TextField>
            </div>

            <ObjectsList<GapRow>
                {...tableProps}
                globalActions={globalActions}
                mouseActionsMapping={{ left: { type: "action", action: "details" }, right: { type: "contextual" } }}
            />
        </>
    );
};

const useStyles = makeStyles({
    summary: { marginTop: 16 },
    muted: { color: palette.muted },
    toolbar: { display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0 8px" },
    field: { minWidth: 200 },
});
