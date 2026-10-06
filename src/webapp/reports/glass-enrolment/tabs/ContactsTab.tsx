import React, { useCallback, useMemo, useState } from "react";
import _ from "lodash";
import { FormControlLabel, MenuItem, Switch, TextField, makeStyles } from "@material-ui/core";
import EditIcon from "@material-ui/icons/Edit";
import SwapHorizIcon from "@material-ui/icons/SwapHoriz";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import PersonAddIcon from "@material-ui/icons/PersonAdd";
import MailOutlineIcon from "@material-ui/icons/MailOutline";
import GetAppIcon from "@material-ui/icons/GetApp";
import OpenInNewIcon from "@material-ui/icons/OpenInNew";
import { ObjectsList, TableConfig, TableGlobalAction, useSnackbar } from "@eyeseetea/d2-ui-components";
import i18n from "../../../../locales";
import { fullName, isEnrolled, keyOf } from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { previousContacts } from "../../../../domain/reports/glass-enrolment/entities/History";
import { useEnrolment } from "../useEnrolmentData";
import { UrlState } from "../useUrlState";
import { copyEmails, downloadCsv, includesText, useInMemoryTable } from "../tableUtils";

type ContactRow = {
    id: string;
    countryId: string;
    code: string;
    country: string;
    region: string;
    module: string;
    name: string;
    function: string;
    email: string;
    telephone: string;
    institution: string;
    since: string;
    updated: string;
    state: string;
    isCurrent: boolean;
};

type Props = { url: UrlState; setUrl(patch: Partial<UrlState>): void };

/** Every national focal point, current and — on request — previous. */
export const ContactsTab: React.FC<Props> = ({ url, setUrl }) => {
    const {
        cells,
        cellIndex,
        moduleNames,
        regions,
        history,
        countryNames,
        countries,
        openCountry,
        addContact,
        editContact,
        removeContact,
    } = useEnrolment();
    const snackbar = useSnackbar();
    const classes = useStyles();
    const [showPrevious, setShowPrevious] = useState(false);

    const regionOf = useMemo(() => _.fromPairs(countries.map(c => [c.id, c])), [countries]);

    const rows = useMemo((): ContactRow[] => {
        const current = _.flatMap(
            cells.filter(cell => isEnrolled(cell) || cell.status === "inactive"),
            cell =>
                cell.contacts.map(contact => ({
                    id: contact.id,
                    countryId: cell.country.id,
                    code: cell.country.code,
                    country: cell.country.name,
                    region: cell.country.region,
                    module: cell.module,
                    name: fullName(contact),
                    function: contact.function,
                    email: contact.email,
                    telephone: contact.telephone,
                    institution: contact.institution,
                    since: contact.startDate,
                    updated: contact.updatedAt.slice(0, 10),
                    state: isEnrolled(cell) ? i18n.t("Current") : i18n.t("Enrolment inactive"),
                    isCurrent: true,
                }))
        );

        const previous = showPrevious
            ? previousContacts(history).map((contact, index) => ({
                  id: `previous-${index}-${contact.removedAt}`,
                  countryId: contact.countryId,
                  code: regionOf[contact.countryId]?.code ?? "",
                  country: countryNames[contact.countryId] ?? contact.countryId,
                  region: regionOf[contact.countryId]?.region ?? "",
                  module: contact.module,
                  name: fullName(contact),
                  function: contact.function,
                  email: contact.email,
                  telephone: contact.telephone,
                  institution: contact.institution,
                  since: contact.startDate,
                  updated: contact.removedAt.slice(0, 10),
                  state: i18n.t("Previous (until {{date}})", { date: contact.removedAt.slice(0, 10) }),
                  isCurrent: false,
              }))
            : [];

        return [...current, ...previous].filter(
            row => (!url.module || row.module === url.module) && (!url.region || row.region === url.region)
        );
    }, [cells, history, showPrevious, url.module, url.region, countryNames, regionOf]);

    const cellOf = useCallback(
        (row: ContactRow) => cellIndex[keyOf({ countryId: row.countryId, module: row.module })],
        [cellIndex]
    );

    const config = useMemo(
        (): TableConfig<ContactRow> => ({
            columns: [
                { name: "country", text: i18n.t("Country"), sortable: true },
                { name: "code", text: i18n.t("Code"), sortable: true },
                { name: "module", text: i18n.t("Module"), sortable: true },
                { name: "name", text: i18n.t("Name"), sortable: true },
                { name: "function", text: i18n.t("Function"), sortable: true },
                { name: "email", text: i18n.t("Email"), sortable: true },
                { name: "telephone", text: i18n.t("Telephone"), sortable: true, hidden: true },
                { name: "institution", text: i18n.t("Institution"), sortable: true, hidden: true },
                { name: "since", text: i18n.t("In post since"), sortable: true },
                { name: "updated", text: i18n.t("Last updated"), sortable: true },
                { name: "state", text: i18n.t("State"), sortable: true },
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
                {
                    name: "edit",
                    text: i18n.t("Edit"),
                    icon: <EditIcon />,
                    isActive: selected => selected.every(row => row.isCurrent),
                    onClick: ids => withCell(ids[0], (cell, id) => editContact(cell, id, "edit")),
                },
                {
                    name: "replace",
                    text: i18n.t("Replace with a successor"),
                    icon: <SwapHorizIcon />,
                    isActive: selected => selected.every(row => row.isCurrent),
                    onClick: ids => withCell(ids[0], (cell, id) => editContact(cell, id, "replace")),
                },
                {
                    name: "remove",
                    text: i18n.t("Remove"),
                    icon: <DeleteOutlineIcon />,
                    isActive: selected => selected.every(row => row.isCurrent),
                    onClick: ids => withCell(ids[0], (cell, id) => removeContact(cell, id)),
                },
            ],
            initialSorting: { field: "country", order: "asc" },
            paginationOptions: { pageSizeOptions: [25, 50, 100, 500], pageSizeInitialValue: 50 },
            searchBoxLabel: i18n.t("Search name, email, country or institution"),
            initialSearch: url.q,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rows]
    );

    function withCell(
        id: string | undefined,
        action: (cell: NonNullable<ReturnType<typeof cellOf>>, contactId: string) => void
    ) {
        const row = rows.find(r => r.id === id);
        const cell = row && cellOf(row);
        if (row && cell) action(cell, row.id);
    }

    const matches = useCallback(
        (row: ContactRow, query: string) =>
            includesText(query, row.name, row.email, row.country, row.code, row.institution),
        []
    );
    const tableProps = useInMemoryTable(config, rows, matches);

    const globalActions: TableGlobalAction[] = [
        { name: "add", text: i18n.t("Add focal point"), icon: <PersonAddIcon />, onClick: () => addContact() },
        {
            name: "copy",
            text: i18n.t("Copy emails of the listed current focal points"),
            icon: <MailOutlineIcon />,
            onClick: async () => {
                const count = await copyEmails(rows.filter(row => row.isCurrent).map(row => row.email));
                snackbar.info(i18n.t("{{count}} email addresses copied — paste into the To field", { count }));
            },
        },
        {
            name: "download",
            text: i18n.t("Download CSV"),
            icon: <GetAppIcon />,
            onClick: () =>
                downloadCsv(
                    "glass-focal-points.csv",
                    [
                        "code",
                        "country",
                        "region",
                        "module",
                        "name",
                        "function",
                        "email",
                        "telephone",
                        "institution",
                        "since",
                        "updated",
                        "state",
                    ],
                    rows.map(row => _.omit(row, ["id", "countryId", "isCurrent"]) as Record<string, string>)
                ),
        },
    ];

    return (
        <>
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
                            {module}
                        </MenuItem>
                    ))}
                </TextField>

                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("Region")}
                    value={url.region}
                    onChange={event => setUrl({ region: event.target.value })}
                    className={classes.field}
                >
                    <MenuItem value="">{i18n.t("All regions")}</MenuItem>
                    {regions.map(region => (
                        <MenuItem key={region} value={region}>
                            {region}
                        </MenuItem>
                    ))}
                </TextField>

                <FormControlLabel
                    control={
                        <Switch
                            color="primary"
                            checked={showPrevious}
                            onChange={e => setShowPrevious(e.target.checked)}
                        />
                    }
                    label={i18n.t("Include previous focal points")}
                />
            </div>

            <ObjectsList<ContactRow>
                {...tableProps}
                onChangeSearch={value => {
                    tableProps.onChangeSearch?.(value);
                    setUrl({ q: value });
                }}
                globalActions={globalActions}
                mouseActionsMapping={{ left: { type: "action", action: "details" }, right: { type: "contextual" } }}
            />
        </>
    );
};

const useStyles = makeStyles({
    toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, margin: "16px 0 8px" },
    field: { minWidth: 180 },
});
