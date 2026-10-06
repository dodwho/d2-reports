import React, { useCallback, useMemo } from "react";
import _ from "lodash";
import { MenuItem, TextField, makeStyles } from "@material-ui/core";
import AddCircleOutlineIcon from "@material-ui/icons/AddCircleOutline";
import RemoveCircleOutlineIcon from "@material-ui/icons/RemoveCircleOutline";
import OpenInNewIcon from "@material-ui/icons/OpenInNew";
import GetAppIcon from "@material-ui/icons/GetApp";
import { ObjectsList, TableColumn, TableConfig, TableGlobalAction } from "@eyeseetea/d2-ui-components";
import i18n from "../../../../locales";
import { CellStatus, EnrolmentCell, keyOf } from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { useEnrolment } from "../useEnrolmentData";
import { UrlState } from "../useUrlState";
import { StatusChip } from "../components/StatusChip";
import { Legend } from "../components/Legend";
import { downloadCsv, includesText, useInMemoryTable } from "../tableUtils";
import { statusLabel, statusOrder } from "../theme";

type CountryRow = {
    id: string;
    code: string;
    name: string;
    region: string;
    /** Per module, a sortable rank of its state, so a module column orders enrolled first. */
    [module: string]: string;
};

type Props = { url: UrlState; setUrl(patch: Partial<UrlState>): void };

/** Every country against every module: the overview, and where bulk enrolment starts. */
export const CountriesTab: React.FC<Props> = ({ url, setUrl }) => {
    const { countries, moduleNames, cellIndex, regions, openCountry, enrol } = useEnrolment();
    const classes = useStyles();

    const cellOf = useCallback(
        (countryId: string, module: string): EnrolmentCell | undefined => cellIndex[keyOf({ countryId, module })],
        [cellIndex]
    );

    const rows = useMemo(
        (): CountryRow[] =>
            countries
                .filter(country => !url.region || country.region === url.region)
                .filter(country => !url.module || !url.status || cellOf(country.id, url.module)?.status === url.status)
                .map(country => ({
                    id: country.id,
                    code: country.code,
                    name: country.name,
                    region: country.region,
                    ..._.fromPairs(
                        moduleNames.map(module => {
                            const status = cellOf(country.id, module)?.status;
                            return [module, `${status ? statusOrder.indexOf(status) : 9}-${country.name}`];
                        })
                    ),
                })),
        [countries, moduleNames, cellOf, url.region, url.module, url.status]
    );

    const config = useMemo(
        (): TableConfig<CountryRow> => ({
            columns: [
                { name: "name", text: i18n.t("Country"), sortable: true },
                { name: "code", text: i18n.t("Code"), sortable: true },
                { name: "region", text: i18n.t("Region"), sortable: true },
                ...moduleNames.map(
                    (module): TableColumn<CountryRow> => ({
                        name: module,
                        text: module,
                        sortable: true,
                        getValue: row => <StatusChip cell={cellOf(row.id, module)} />,
                    })
                ),
            ],
            actions: [
                {
                    name: "details",
                    text: i18n.t("Open country"),
                    icon: <OpenInNewIcon />,
                    primary: true,
                    onClick: ids => ids[0] && openCountry(ids[0]),
                },
                {
                    name: "enrol",
                    text: i18n.t("Enrol in a module…"),
                    icon: <AddCircleOutlineIcon />,
                    multiple: true,
                    onClick: ids => enrol(ids, { module: url.module, mode: "enrol" }),
                },
                {
                    name: "unenrol",
                    text: i18n.t("Un-enrol from a module…"),
                    icon: <RemoveCircleOutlineIcon />,
                    multiple: true,
                    onClick: ids => enrol(ids, { module: url.module, mode: "unenrol" }),
                },
            ],
            initialSorting: { field: "name", order: "asc" },
            paginationOptions: { pageSizeOptions: [25, 50, 100, 300], pageSizeInitialValue: 50 },
            searchBoxLabel: i18n.t("Search country or ISO code"),
            initialSearch: url.q,
        }),
        // The search box owns its text after the first render; only its initial value comes from the URL.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [moduleNames, cellOf, openCountry, enrol, url.module]
    );

    const matches = useCallback((row: CountryRow, query: string) => includesText(query, row.name, row.code), []);
    const tableProps = useInMemoryTable(config, rows, matches);

    const statusCounts = useMemo(() => {
        if (!url.module) return undefined;
        return _.countBy(
            countries.filter(country => !url.region || country.region === url.region),
            country => cellOf(country.id, url.module)?.status
        ) as Partial<Record<CellStatus, number>>;
    }, [countries, cellOf, url.module, url.region]);

    const download: TableGlobalAction = {
        name: "download",
        text: i18n.t("Download CSV"),
        icon: <GetAppIcon />,
        onClick: () =>
            downloadCsv(
                "glass-enrolment.csv",
                ["code", "country", "region", ...moduleNames],
                rows.map(row => ({
                    code: row.code,
                    country: row.name,
                    region: row.region,
                    ..._.fromPairs(
                        moduleNames.map(module => {
                            const cell = cellOf(row.id, module);
                            return [
                                module,
                                cell
                                    ? `${statusLabel(cell.status)}${cell.enrolledAt ? ` ${cell.enrolledAt}` : ""}`
                                    : "",
                            ];
                        })
                    ),
                }))
            ),
    };

    return (
        <>
            <div className={classes.toolbar}>
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

                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("Module")}
                    value={url.module}
                    onChange={event =>
                        setUrl({ module: event.target.value, status: event.target.value ? url.status : "" })
                    }
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
                    label={i18n.t("Status in module")}
                    value={url.status}
                    disabled={!url.module}
                    onChange={event => setUrl({ status: event.target.value })}
                    className={classes.field}
                >
                    <MenuItem value="">{i18n.t("Any status")}</MenuItem>
                    {statusOrder.map(status => (
                        <MenuItem key={status} value={status}>
                            {statusLabel(status)}
                        </MenuItem>
                    ))}
                </TextField>
            </div>

            <div className={classes.legend}>
                <Legend counts={statusCounts} />
            </div>

            <ObjectsList<CountryRow>
                {...tableProps}
                onChangeSearch={value => {
                    tableProps.onChangeSearch?.(value);
                    setUrl({ q: value });
                }}
                globalActions={[download]}
                mouseActionsMapping={{ left: { type: "action", action: "details" }, right: { type: "contextual" } }}
            />
        </>
    );
};

const useStyles = makeStyles({
    toolbar: { display: "flex", flexWrap: "wrap", gap: 12, margin: "16px 0 8px" },
    field: { minWidth: 180 },
    legend: { margin: "4px 0 8px" },
});
