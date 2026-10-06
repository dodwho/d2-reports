import React, { useMemo, useState } from "react";
import _ from "lodash";
import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    TextField,
    Typography,
    makeStyles,
} from "@material-ui/core";
import { useSnackbar } from "@eyeseetea/d2-ui-components";
import i18n from "../../../../locales";
import {
    ContactDetails,
    EnrolmentCell,
    fullName,
    isEnrolled,
    isValidEmail,
    keyOf,
} from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import {
    ChangeSet,
    contactProblems,
    detailsOf,
    emptyDetails,
    planAddContact,
    planEditContact,
    planRemoveContact,
    planReplaceContact,
} from "../../../../domain/reports/glass-enrolment/entities/ChangeSet";
import { HistoryAction } from "../../../../domain/reports/glass-enrolment/entities/History";
import { useEnrolment } from "../useEnrolmentData";
import { hasProblems, problemsOf } from "../problems";
import { palette } from "../theme";

export type ContactDialogProps =
    | { mode: "add"; cell?: EnrolmentCell; onClose(): void }
    | { mode: "edit" | "replace"; cell: EnrolmentCell; contactId: string; onClose(): void };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Add, edit or replace a national focal point.
 *
 * Replacing is the normal way a focal point changes: the outgoing person is kept in History as a
 * previous focal point and the successor takes their place, in one recorded — and revertible —
 * change.
 */
export const ContactDialog: React.FC<ContactDialogProps> = props => {
    const { cells, cellIndex, moduleNames, apply, newId, countryNames } = useEnrolment();
    const snackbar = useSnackbar();
    const classes = useStyles();

    const existing = props.mode === "add" ? undefined : props.cell.contacts.find(c => c.id === props.contactId);

    const [module, setModule] = useState(props.cell?.module ?? moduleNames[0] ?? "");
    const [countryId, setCountryId] = useState(props.cell?.country.id ?? "");
    const [form, setForm] = useState<ContactDetails>(() =>
        props.mode === "edit" && existing ? detailsOf(existing) : emptyDetails(today())
    );
    const [isSaving, setIsSaving] = useState(false);

    const enrolledCountries = useMemo(
        () =>
            _.sortBy(
                cells.filter(cell => cell.module === module && isEnrolled(cell)),
                cell => cell.country.name
            ),
        [cells, module]
    );

    const cell = props.mode === "add" ? cellIndex[keyOf({ countryId, module })] : props.cell;
    const problems = contactProblems(form, isValidEmail);
    const startsBeforeOutgoing = props.mode === "replace" && existing && form.startDate < existing.startDate;

    const plan = (): [HistoryAction, ChangeSet] | undefined => {
        if (!cell) return undefined;
        if (props.mode === "add") return ["contact-add", planAddContact(cell, form, newId)];
        if (!existing) return undefined;
        return props.mode === "edit"
            ? ["contact-edit", planEditContact(existing, cell, form)]
            : ["contact-replace", planReplaceContact(existing, cell, form, newId)];
    };

    const save = async () => {
        const planned = plan();
        if (!planned) return;
        const [action, changes] = planned;

        setIsSaving(true);
        const result = await apply(action, changes);
        setIsSaving(false);

        if (!hasProblems(result)) {
            snackbar.success(i18n.t("Focal point saved"));
            props.onClose();
        } else {
            snackbar.error(problemsOf(result, countryNames).join("; "));
        }
    };

    const field = (name: keyof ContactDetails, label: string, extra: object = {}) => (
        <TextField
            label={label}
            value={form[name]}
            onChange={event => setForm({ ...form, [name]: event.target.value })}
            size="small"
            variant="outlined"
            fullWidth
            {...extra}
        />
    );

    const title =
        props.mode === "add"
            ? i18n.t("Add focal point")
            : props.mode === "edit"
            ? i18n.t("Edit focal point")
            : i18n.t("Replace focal point");

    return (
        <Dialog open onClose={isSaving ? undefined : props.onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                {title}
                {cell && (
                    <Typography className={classes.subtitle}>{`${cell.country.name} — ${cell.module}`}</Typography>
                )}
            </DialogTitle>

            <DialogContent dividers>
                {props.mode === "add" && !props.cell && (
                    <div className={classes.grid}>
                        <TextField
                            select
                            size="small"
                            variant="outlined"
                            label={i18n.t("Module")}
                            value={module}
                            onChange={event => {
                                setModule(event.target.value);
                                setCountryId("");
                            }}
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
                            label={i18n.t("Country (enrolled in this module)")}
                            value={countryId}
                            onChange={event => setCountryId(event.target.value)}
                        >
                            {enrolledCountries.map(option => (
                                <MenuItem key={option.country.id} value={option.country.id}>
                                    {option.country.name}
                                </MenuItem>
                            ))}
                        </TextField>
                    </div>
                )}

                {props.mode === "replace" && existing && (
                    <Typography className={classes.replacing}>
                        {i18n.t(
                            "{{name}} will become a previous focal point, kept in History. Enter their successor below.",
                            { name: fullName(existing) || existing.email }
                        )}
                    </Typography>
                )}

                <div className={classes.grid}>
                    {field("firstName", i18n.t("First name"))}
                    {field("familyName", i18n.t("Family name"))}
                    {field("function", i18n.t("Function / title"))}
                    {field("email", i18n.t("Email"), {
                        type: "email",
                        error: problems.includes("invalid-email"),
                        helperText: problems.includes("invalid-email") ? i18n.t("Not a valid email address") : "",
                    })}
                    {field("telephone", i18n.t("Telephone"))}
                    {field("language", i18n.t("Preferred language"))}
                    {field("institution", i18n.t("Institution"))}
                    {field("address", i18n.t("Institution address"), { multiline: true })}
                    {field("city", i18n.t("City"))}
                    {field("zipCode", i18n.t("Postal code"))}
                    {field("startDate", i18n.t("In post since"), {
                        type: "date",
                        InputLabelProps: { shrink: true },
                        error: problems.includes("invalid-date") || Boolean(startsBeforeOutgoing),
                        helperText: startsBeforeOutgoing
                            ? i18n.t("Earlier than the person being replaced ({{date}})", { date: existing?.startDate })
                            : "",
                    })}
                </div>

                {problems.includes("name-or-email-required") && (
                    <Typography variant="body2" className={classes.hint}>
                        {i18n.t("Enter at least a name or an email address.")}
                    </Typography>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={props.onClose} disabled={isSaving}>
                    {i18n.t("Cancel")}
                </Button>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={save}
                    disabled={!cell || !_.isEmpty(problems) || Boolean(startsBeforeOutgoing) || isSaving}
                    startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                    {props.mode === "replace" ? i18n.t("Replace") : i18n.t("Save")}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/** Removing without a successor, for someone who has left and not been replaced yet. */
export const RemoveContactDialog: React.FC<{ cell: EnrolmentCell; contactId: string; onClose(): void }> = ({
    cell,
    contactId,
    onClose,
}) => {
    const { apply, countryNames } = useEnrolment();
    const snackbar = useSnackbar();
    const classes = useStyles();
    const [isSaving, setIsSaving] = useState(false);

    const contact = cell.contacts.find(c => c.id === contactId);
    if (!contact) return null;

    const remove = async () => {
        setIsSaving(true);
        const result = await apply("contact-remove", planRemoveContact(contact, cell));
        setIsSaving(false);

        if (!hasProblems(result)) {
            snackbar.success(i18n.t("Focal point removed — kept in History"));
            onClose();
        } else {
            snackbar.error(problemsOf(result, countryNames).join("; "));
        }
    };

    return (
        <Dialog open onClose={isSaving ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{i18n.t("Remove focal point")}</DialogTitle>
            <DialogContent dividers>
                <Typography>
                    {i18n.t(
                        "{{name}} will no longer be shown for {{country}} — {{module}} in GLASS. Their details are kept in History as a previous focal point, and the removal can be reverted there.",
                        { name: fullName(contact) || contact.email, country: cell.country.name, module: cell.module }
                    )}
                </Typography>
                {cell.contacts.length === 1 && (
                    <Typography variant="body2" className={classes.hint}>
                        {i18n.t(
                            "This is the only focal point: the country will have nobody to contact. Consider Replace instead."
                        )}
                    </Typography>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isSaving}>
                    {i18n.t("Cancel")}
                </Button>
                <Button variant="contained" color="secondary" onClick={remove} disabled={isSaving}>
                    {i18n.t("Remove")}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const useStyles = makeStyles({
    subtitle: { color: palette.muted, fontSize: 14 },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
    replacing: { marginBottom: 16, padding: 12, background: palette.surface, borderRadius: 6 },
    hint: { color: "#7a4100" },
});
