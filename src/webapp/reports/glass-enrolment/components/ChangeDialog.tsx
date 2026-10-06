import React, { useEffect, useState } from "react";
import _ from "lodash";
import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
    Typography,
    makeStyles,
} from "@material-ui/core";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import ErrorIcon from "@material-ui/icons/Error";
import { useSnackbar } from "@eyeseetea/d2-ui-components";
import i18n from "../../../../locales";
import { ChangeSet, isEmptyChangeSet } from "../../../../domain/reports/glass-enrolment/entities/ChangeSet";
import { HistoryAction } from "../../../../domain/reports/glass-enrolment/entities/History";
import { WriteResult } from "../../../../domain/reports/glass-enrolment/repositories/EnrolmentRepository";
import { ApplyOptions, useEnrolment } from "../useEnrolmentData";
import { hasProblems, isStale, problemsOf } from "../problems";
import { palette } from "../theme";

/** Changes this large must be confirmed by typing their size, so a mis-click cannot apply them. */
const TYPED_CONFIRMATION_FROM = 10;

export type ChangeDialogProps = {
    title: string;
    action: HistoryAction;
    changes: ChangeSet;
    /** How many things the change touches, as a person would count them (pairs, contacts…). */
    size: number;
    applyText: string;
    /** Destructive-looking changes get a red button and typed confirmation when large. */
    isRemoval?: boolean;
    options?: ApplyOptions;
    /**
     * Metadata changes cannot be dry-run through the tracker, so they skip the server check and
     * rely on the confirmation alone.
     */
    skipValidation?: boolean;
    onClose(): void;
};

/**
 * The one dialog every write goes through. It asks DHIS2 to validate the exact change as soon as
 * it opens, and Apply stays disabled until DHIS2 has accepted it: what the preview promises is what
 * the server has already agreed to.
 */
export const ChangeDialog: React.FC<ChangeDialogProps> = ({
    title,
    action,
    changes,
    size,
    applyText,
    isRemoval,
    options,
    skipValidation,
    onClose,
    children,
}) => {
    const { validate, apply, countryNames, reload } = useEnrolment();
    const snackbar = useSnackbar();
    const classes = useStyles();

    const [validation, setValidation] = useState<WriteResult | "pending">("pending");
    const [isApplying, setIsApplying] = useState(false);
    const [typed, setTyped] = useState("");

    const isEmpty = isEmptyChangeSet(changes) && _.isEmpty(options?.assignedCountryIds);
    const needsTyping = isRemoval && size >= TYPED_CONFIRMATION_FROM;

    useEffect(() => {
        if (isEmpty || skipValidation) return;
        let cancelled = false;
        setValidation("pending");

        validate(changes)
            .then(result => !cancelled && setValidation(result))
            .catch((error: Error) => !cancelled && setValidation({ affected: 0, errors: [error.message] }));

        return () => {
            cancelled = true;
        };
    }, [changes, isEmpty, skipValidation, validate]);

    const isValid = skipValidation || (validation !== "pending" && !hasProblems(validation));
    const canApply = !isEmpty && isValid && !isApplying && (!needsTyping || typed.trim() === String(size));

    const submit = async () => {
        setIsApplying(true);
        try {
            const result = await apply(action, changes, options);
            if (!hasProblems(result)) {
                snackbar.success(i18n.t("Done — recorded in History, where it can be reverted."));
                onClose();
            } else {
                // A stale plan was refused before anything was written; show why, in place.
                setValidation(result);
                setIsApplying(false);
            }
        } catch (error) {
            snackbar.error((error as Error).message);
            setIsApplying(false);
        }
    };

    return (
        <Dialog open onClose={isApplying ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{title}</DialogTitle>

            <DialogContent dividers>
                {children}

                {isEmpty ? (
                    <Typography className={classes.muted}>{i18n.t("Nothing to change.")}</Typography>
                ) : skipValidation ? null : validation === "pending" ? (
                    <div className={classes.status}>
                        <CircularProgress size={18} />
                        <span>{i18n.t("Checking with DHIS2…")}</span>
                    </div>
                ) : !hasProblems(validation) ? (
                    <div className={classes.status} style={{ color: "#1b5e20" }}>
                        <CheckCircleIcon fontSize="small" />
                        <span>{i18n.t("DHIS2 has checked this change and will accept it.")}</span>
                    </div>
                ) : (
                    <div className={classes.errors}>
                        <div className={classes.status} style={{ color: palette.danger }}>
                            <ErrorIcon fontSize="small" />
                            <span>
                                {isStale(validation)
                                    ? i18n.t(
                                          "Someone else changed this data since the page was loaded. Nothing was written:"
                                      )
                                    : i18n.t("DHIS2 would reject this change:")}
                            </span>
                        </div>
                        <ul>
                            {problemsOf(validation, countryNames).map(problem => (
                                <li key={problem}>{problem}</li>
                            ))}
                        </ul>
                        {isStale(validation) && (
                            <Button
                                size="small"
                                color="primary"
                                onClick={() => {
                                    reload();
                                    onClose();
                                }}
                            >
                                {i18n.t("Reload the latest data")}
                            </Button>
                        )}
                    </div>
                )}

                {needsTyping && !isEmpty && (
                    <TextField
                        className={classes.confirm}
                        fullWidth
                        variant="outlined"
                        size="small"
                        label={i18n.t("Type {{count}} to confirm", { count: size })}
                        value={typed}
                        onChange={event => setTyped(event.target.value)}
                    />
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} disabled={isApplying}>
                    {i18n.t("Cancel")}
                </Button>
                <Button
                    variant="contained"
                    color={isRemoval ? "secondary" : "primary"}
                    disabled={!canApply}
                    onClick={submit}
                    startIcon={isApplying ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                    {applyText}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/** A labelled group of country names inside a change dialog. */
export const NameGroup: React.FC<{ label: string; names: string[]; tone?: "normal" | "muted" | "warning" }> = ({
    label,
    names,
    tone = "normal",
}) => {
    const classes = useStyles();
    if (_.isEmpty(names)) return null;

    return (
        <div className={classes.group}>
            <Typography
                variant="subtitle2"
                style={{ color: tone === "warning" ? "#7a4100" : tone === "muted" ? palette.muted : undefined }}
            >
                {`${label} (${names.length})`}
            </Typography>
            <Typography variant="body2" className={classes.names}>
                {names.join(", ")}
            </Typography>
        </div>
    );
};

const useStyles = makeStyles({
    muted: { color: palette.muted },
    status: { display: "flex", alignItems: "center", gap: 8, marginTop: 16 },
    errors: { marginTop: 8, "& ul": { margin: "4px 0 0", paddingLeft: 24, fontSize: 13 } },
    confirm: { marginTop: 16 },
    group: { marginBottom: 12 },
    names: { color: palette.muted, maxHeight: 96, overflowY: "auto" },
});
