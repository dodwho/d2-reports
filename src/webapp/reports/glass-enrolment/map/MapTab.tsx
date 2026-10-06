import React, { useEffect, useMemo, useRef, useState } from "react";
import _ from "lodash";
import { CircularProgress, MenuItem, TextField, Typography, makeStyles } from "@material-ui/core";
import { geoEqualEarth } from "d3-geo";
import i18n from "../../../../locales";
import {
    CellStatus,
    CountryGeometry,
    isEnrolled,
    keyOf,
} from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { useEnrolment } from "../useEnrolmentData";
import { UrlState } from "../useUrlState";
import { Legend } from "../components/Legend";
import { describeCell } from "../components/StatusChip";
import { palette, statusStyles } from "../theme";
import { Geometry, roundedPath, toD3Geometry } from "./geometry";

const WIDTH = 960;
const HEIGHT = 480;

/** Country shapes rarely change and weigh a couple of megabytes: fetched once per page load. */
let geometriesRequest: Promise<CountryGeometry[]> | undefined;

type Props = { url: UrlState; setUrl(patch: Partial<UrlState>): void };

/**
 * Enrolment on a world map, one module at a time.
 *
 * Shapes come from the country organisation units in DHIS2 itself, so the map needs no external
 * service and shows exactly the countries the rest of the report does. Choosing a region zooms to
 * it while keeping the rest of the world faintly in view for context.
 */
export const MapTab: React.FC<Props> = ({ url, setUrl }) => {
    const { countries, moduleNames, regions, cellIndex, openCountry, getGeometries } = useEnrolment();
    const classes = useStyles();
    const containerRef = useRef<HTMLDivElement>(null);

    const [geometries, setGeometries] = useState<CountryGeometry[]>();
    const [error, setError] = useState<string>();
    const [hover, setHover] = useState<{ countryId: string; x: number; y: number }>();

    const module = moduleNames.includes(url.module) ? url.module : moduleNames[0] ?? "";

    useEffect(() => {
        geometriesRequest ??= getGeometries();
        geometriesRequest.then(setGeometries).catch((loadError: Error) => {
            geometriesRequest = undefined;
            setError(loadError.message);
        });
    }, [getGeometries]);

    const regionOf = useMemo(() => _.fromPairs(countries.map(country => [country.id, country.region])), [countries]);

    const features = useMemo(
        () =>
            (geometries ?? [])
                .filter(({ id }) => regionOf[id] !== undefined)
                .map(({ id, geometry }) => ({
                    id,
                    feature: { type: "Feature" as const, properties: {}, geometry: toD3Geometry(geometry as Geometry) },
                })),
        [geometries, regionOf]
    );

    // Paths depend only on the zoom, not on the module, so switching module just recolours.
    const paths = useMemo(() => {
        if (_.isEmpty(features)) return [];

        const inFocus = url.region ? features.filter(({ id }) => regionOf[id] === url.region) : features;
        const projection = geoEqualEarth().fitExtent(
            [
                [8, 8],
                [WIDTH - 8, HEIGHT - 8],
            ],
            {
                type: "FeatureCollection",
                features: (_.isEmpty(inFocus) ? features : inFocus).map(f => f.feature),
            } as never
        );

        return features.map(({ id, feature }) => ({
            id,
            d: roundedPath(projection, feature as never),
            inFocus: !url.region || regionOf[id] === url.region,
        }));
    }, [features, url.region, regionOf]);

    const statusOf = (countryId: string): CellStatus | undefined => cellIndex[keyOf({ countryId, module })]?.status;

    const counts = useMemo(
        () =>
            _.countBy(
                countries.filter(country => !url.region || country.region === url.region),
                country => cellIndex[keyOf({ countryId: country.id, module })]?.status
            ) as Partial<Record<CellStatus, number>>,
        [countries, cellIndex, module, url.region]
    );

    // Enrolled countries DHIS2 holds no shape for would otherwise be silently missing from the map.
    const notDrawn = useMemo(() => {
        const drawn = new Set(features.map(feature => feature.id));
        return countries.filter(country => {
            const cell = cellIndex[keyOf({ countryId: country.id, module })];
            return cell && isEnrolled(cell) && !drawn.has(country.id);
        });
    }, [features, countries, cellIndex, module]);

    const hovered = hover && cellIndex[keyOf({ countryId: hover.countryId, module })];

    const trackPointer = (countryId: string) => (event: React.MouseEvent) => {
        const box = containerRef.current?.getBoundingClientRect();
        if (box) setHover({ countryId, x: event.clientX - box.left, y: event.clientY - box.top });
    };

    return (
        <>
            <div className={classes.toolbar}>
                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("Module")}
                    value={module}
                    onChange={event => setUrl({ module: event.target.value })}
                    className={classes.field}
                >
                    {moduleNames.map(name => (
                        <MenuItem key={name} value={name}>
                            {name}
                        </MenuItem>
                    ))}
                </TextField>

                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("Zoom to region")}
                    value={url.region}
                    onChange={event => setUrl({ region: event.target.value })}
                    className={classes.field}
                >
                    <MenuItem value="">{i18n.t("Whole world")}</MenuItem>
                    {regions.map(region => (
                        <MenuItem key={region} value={region}>
                            {region}
                        </MenuItem>
                    ))}
                </TextField>
            </div>

            <div className={classes.legend}>
                <Legend counts={counts} />
            </div>

            <div ref={containerRef} className={classes.frame} onMouseLeave={() => setHover(undefined)}>
                {error ? (
                    <Typography color="error">{error}</Typography>
                ) : !geometries ? (
                    <div className={classes.loading}>
                        <CircularProgress size={24} />
                        <span>{i18n.t("Loading country shapes…")}</span>
                    </div>
                ) : (
                    <svg
                        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                        className={classes.svg}
                        role="img"
                        aria-label={i18n.t("Map of enrolment in {{module}}", { module })}
                    >
                        {paths.map(({ id, d, inFocus }) => {
                            const status = statusOf(id);
                            const isHovered = hover?.countryId === id;

                            return (
                                <path
                                    key={id}
                                    d={d}
                                    fill={status ? statusStyles[status].map : "#ffffff"}
                                    fillOpacity={inFocus ? 1 : 0.25}
                                    stroke={isHovered ? "#111" : "#fff"}
                                    strokeWidth={isHovered ? 1.5 : 0.5}
                                    className={inFocus ? classes.country : undefined}
                                    onMouseMove={inFocus ? trackPointer(id) : undefined}
                                    onClick={inFocus ? () => openCountry(id) : undefined}
                                />
                            );
                        })}
                    </svg>
                )}

                {hover && hovered && (
                    <div
                        className={classes.tooltip}
                        style={{
                            left: Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 0) - 260),
                            top: hover.y + 14,
                        }}
                    >
                        {describeCell(hovered)}
                    </div>
                )}
            </div>

            {!_.isEmpty(notDrawn) && (
                <Typography variant="body2" className={classes.note}>
                    {i18n.t("Enrolled but without a shape in DHIS2, so not drawn: {{names}}", {
                        names: notDrawn.map(country => country.name).join(", "),
                    })}
                </Typography>
            )}

            <Typography variant="caption" className={classes.disclaimer}>
                {i18n.t(
                    "For internal administration only. Boundaries are those stored in DHIS2 and have not been cleared for publication. The designations employed and the presentation of material on this map do not imply the expression of any opinion whatsoever on the part of WHO concerning the legal status of any country, territory, city or area or of its authorities, or concerning the delimitation of its frontiers or boundaries."
                )}
            </Typography>
        </>
    );
};

const useStyles = makeStyles({
    toolbar: { display: "flex", flexWrap: "wrap", gap: 12, margin: "16px 0 8px" },
    field: { minWidth: 200 },
    legend: { margin: "4px 0 8px" },
    frame: {
        position: "relative",
        background: "#f7fbff",
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        overflow: "hidden",
    },
    svg: { display: "block", width: "100%", height: "auto" },
    country: { cursor: "pointer" },
    loading: { display: "flex", gap: 12, alignItems: "center", padding: 48, justifyContent: "center" },
    tooltip: {
        position: "absolute",
        maxWidth: 260,
        pointerEvents: "none",
        background: "rgba(33,33,33,0.92)",
        color: "#fff",
        fontSize: 12,
        padding: "6px 8px",
        borderRadius: 4,
        lineHeight: 1.4,
    },
    note: { marginTop: 8, color: palette.muted },
    disclaimer: { display: "block", marginTop: 12, color: palette.muted, lineHeight: 1.4 },
});
