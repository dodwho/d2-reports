import React, { useMemo, useState } from "react";
import _ from "lodash";
import { FormControlLabel, MenuItem, Radio, RadioGroup, TextField, Typography, makeStyles } from "@material-ui/core";
import i18n from "../../../../locales";
import { Id } from "../../../../domain/common/entities/Base";
import {
    PlanLine,
    emptyChangeSet,
    planEnrol,
    planUnenrol,
} from "../../../../domain/reports/glass-enrolment/entities/ChangeSet";
import { useEnrolment } from "../useEnrolmentData";
import { ChangeDialog, NameGroup } from "./ChangeDialog";
import { palette } from "../theme";

export type EnrolDialogProps = {
    countryIds: Id[];
    module?: string;
    mode?: "enrol" | "unenrol";
    onClose(): void;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Enrol or un-enrol one or many countries in a module. The plan is worked out here, country by
 * country, so the person sees exactly who is enrolled, revived, un-enrolled or skipped — and why —
 * before DHIS2 is even asked.
 */
export const EnrolDialog: React.FC<EnrolDialogProps> = props => {
    const { moduleNames, cellIndex, countryNames, newId } = useEnrolment();
    const classes = useStyles();

    const [mode, setMode] = useState(props.mode ?? "enrol");
    const [module, setModule] = useState(
        props.module && moduleNames.includes(props.module) ? props.module : moduleNames[0] ?? ""
    );
    const [enrolledAt, setEnrolledAt] = useState(today);

    const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(enrolledAt) && enrolledAt <= today();

    // Built once per choice, so the ids DHIS2 validates are the ids later applied.
    const plan = useMemo(() => {
        const targets = props.countryIds.map(countryId => ({ countryId, module }));
        return mode === "enrol" ? planEnrol(targets, cellIndex, enrolledAt, newId) : planUnenrol(targets, cellIndex);
    }, [props.countryIds, module, mode, enrolledAt, cellIndex, newId]);

    const names = (predicate: (line: PlanLine) => boolean) =>
        _.sortBy(plan.lines.filter(predicate).map(line => countryNames[line.countryId] ?? line.countryId));

    const changing = plan.lines.filter(line => line.outcome !== "skip").length;
    const single = props.countryIds.length === 1 ? countryNames[props.countryIds[0] ?? ""] : undefined;

    return (
        <ChangeDialog
            title={single ? i18n.t("{{country}}: enrolment", { country: single }) : i18n.t("Change enrolment")}
            action={mode}
            changes={isValidDate ? plan.changes : emptyChangeSet}
            size={changing}
            isRemoval={mode === "unenrol"}
            applyText={
                mode === "enrol"
                    ? i18n.t("Enrol {{count}}", { count: changing })
                    : i18n.t("Un-enrol {{count}}", { count: changing })
            }
            onClose={props.onClose}
        >
            <div className={classes.controls}>
                <RadioGroup row value={mode} onChange={event => setMode(event.target.value as "enrol" | "unenrol")}>
                    <FormControlLabel value="enrol" control={<Radio color="primary" />} label={i18n.t("Enrol")} />
                    <FormControlLabel value="unenrol" control={<Radio color="primary" />} label={i18n.t("Un-enrol")} />
                </RadioGroup>

                <TextField
                    select
                    size="small"
                    variant="outlined"
                    label={i18n.t("Module")}
                    value={module}
                    onChange={event => setModule(event.target.value)}
                    className={classes.field}
                >
                    {moduleNames.map(name => (
                        <MenuItem key={name} value={name}>
                            {name}
                        </MenuItem>
                    ))}
                </TextField>

                {mode === "enrol" && (
                    <TextField
                        type="date"
                        size="small"
                        variant="outlined"
                        label={i18n.t("Enrolment date")}
                        value={enrolledAt}
                        onChange={event => setEnrolledAt(event.target.value)}
                        error={!isValidDate}
                        helperText={!isValidDate ? i18n.t("A date no later than today") : undefined}
                        inputProps={{ max: today() }}
                        InputLabelProps={{ shrink: true }}
                        className={classes.field}
                    />
                )}
            </div>

            <NameGroup label={i18n.t("Will be enrolled")} names={names(line => line.outcome === "create")} />
            <NameGroup
                label={i18n.t("Will be re-enrolled, keeping their previous enrolment and focal points")}
                names={names(line => line.outcome === "revive")}
            />
            <NameGroup label={i18n.t("Will be un-enrolled")} names={names(line => line.outcome === "cancel")} />
            <NameGroup
                label={i18n.t("Skipped — already enrolled")}
                names={names(line => line.reason === "already-enrolled")}
                tone="muted"
            />
            <NameGroup
                label={i18n.t("Skipped — not enrolled")}
                names={names(line => line.reason === "not-enrolled")}
                tone="muted"
            />
            <NameGroup
                label={i18n.t("Skipped — not in the enrolment program yet (fix under Health)")}
                names={names(line => line.reason === "blocked")}
                tone="warning"
            />

            <Typography variant="body2" className={classes.note}>
                {mode === "enrol"
                    ? i18n.t(
                          "The module appears for these countries once users with the module's user groups and the country in their organisation units reload GLASS."
                      )
                    : i18n.t(
                          "Un-enrolling cancels the enrolment; nothing is deleted. The module disappears from GLASS for the country, its focal points are kept, and it can be re-enrolled or reverted from History."
                      )}
            </Typography>
        </ChangeDialog>
    );
};

const useStyles = makeStyles({
    controls: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 16 },
    field: { minWidth: 190 },
    note: { color: palette.muted, marginTop: 8 },
});
