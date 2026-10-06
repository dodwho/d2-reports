import React, { useMemo } from "react";
import _ from "lodash";
import { Button, Drawer, IconButton, Link, Tooltip, Typography, makeStyles } from "@material-ui/core";
import CloseIcon from "@material-ui/icons/Close";
import EditIcon from "@material-ui/icons/Edit";
import SwapHorizIcon from "@material-ui/icons/SwapHoriz";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import PersonAddIcon from "@material-ui/icons/PersonAdd";
import i18n from "../../../../locales";
import { Id } from "../../../../domain/common/entities/Base";
import {
    Contact,
    EnrolmentCell,
    fullName,
    isEnrolled,
    isStale,
    keyOf,
    trackedEntityCount,
} from "../../../../domain/reports/glass-enrolment/entities/Enrolment";
import { countryIdsOf, previousContacts } from "../../../../domain/reports/glass-enrolment/entities/History";
import { useEnrolment } from "../useEnrolmentData";
import { actionLabel, palette, statusLabel } from "../theme";
import { StatusChip } from "./StatusChip";

/**
 * Everything about one country on one screen: each module's state, who can use it, its focal
 * points and what has changed — with the actions for each right beside it.
 */
export const CountryDrawer: React.FC<{ countryId: Id; onClose(): void }> = ({ countryId, onClose }) => {
    const { countries, moduleNames, cellIndex, history, showTab } = useEnrolment();
    const classes = useStyles();

    const country = countries.find(candidate => candidate.id === countryId);

    const recent = useMemo(
        () => history.filter(record => countryIdsOf(record).includes(countryId)).slice(0, 5),
        [history, countryId]
    );

    return (
        <Drawer anchor="right" open onClose={onClose} classes={{ paper: classes.paper }}>
            {country ? (
                <>
                    <div className={classes.header}>
                        <div>
                            <Typography variant="h6">{country.name}</Typography>
                            <Typography className={classes.muted}>
                                {_.compact([country.code, country.region]).join(" · ")}
                            </Typography>
                        </div>
                        <IconButton onClick={onClose} aria-label={i18n.t("Close")}>
                            <CloseIcon />
                        </IconButton>
                    </div>

                    {moduleNames.map(module => {
                        const cell = cellIndex[keyOf({ countryId, module })];
                        return cell ? <ModuleCard key={module} cell={cell} /> : null;
                    })}

                    <section className={classes.section}>
                        <Typography variant="subtitle1" className={classes.sectionTitle}>
                            {i18n.t("Recent changes")}
                        </Typography>
                        {_.isEmpty(recent) ? (
                            <Typography className={classes.muted}>
                                {i18n.t("No changes recorded from this report yet.")}
                            </Typography>
                        ) : (
                            recent.map(record => (
                                <Typography key={record.id} variant="body2" className={classes.historyLine}>
                                    <span>{record.at.slice(0, 10)}</span>
                                    <span>{actionLabel(record.action)}</span>
                                    <span className={classes.muted}>{record.by}</span>
                                </Typography>
                            ))
                        )}
                        <Link component="button" onClick={() => showTab("history", { q: country.name })}>
                            {i18n.t("Full history")}
                        </Link>
                    </section>
                </>
            ) : (
                <Typography className={classes.muted}>{i18n.t("Country not found.")}</Typography>
            )}
        </Drawer>
    );
};

const ModuleCard: React.FC<{ cell: EnrolmentCell }> = ({ cell }) => {
    const { access, history, enrol, addContact, editContact, removeContact, showTab } = useEnrolment();
    const classes = useStyles();

    const coverage = access?.[cell.module]?.[cell.country.id];
    const previous = useMemo(
        () =>
            previousContacts(history).filter(
                contact => contact.countryId === cell.country.id && contact.module === cell.module
            ),
        [history, cell]
    );
    const enrolled = isEnrolled(cell);
    const duplicates = trackedEntityCount(cell.enrolments);

    return (
        <section className={classes.section}>
            <div className={classes.cardHeader}>
                <Typography variant="subtitle1" className={classes.sectionTitle}>
                    {cell.module}
                </Typography>
                <StatusChip cell={cell} />
                <span className={classes.spacer} />
                {cell.status !== "blocked" && (
                    <Button
                        size="small"
                        variant={enrolled ? "text" : "outlined"}
                        color={enrolled ? "default" : "primary"}
                        onClick={() =>
                            enrol([cell.country.id], { module: cell.module, mode: enrolled ? "unenrol" : "enrol" })
                        }
                    >
                        {enrolled
                            ? i18n.t("Un-enrol")
                            : cell.status === "inactive"
                            ? i18n.t("Re-enrol")
                            : i18n.t("Enrol")}
                    </Button>
                )}
            </div>

            <Typography variant="body2" className={classes.muted}>
                {statusLabel(cell.status)}
                {cell.enrolledAt && ` · ${i18n.t("since {{date}}", { date: cell.enrolledAt })}`}
            </Typography>

            {cell.status === "blocked" && (
                <Typography variant="body2" className={classes.warning}>
                    {i18n.t("This country is not in the enrolment program.")}{" "}
                    <Link component="button" onClick={() => showTab("health", { status: "blocked" })}>
                        {i18n.t("Add it under Health")}
                    </Link>
                </Typography>
            )}

            {duplicates > 1 && (
                <Typography variant="body2" className={classes.warning}>
                    {i18n.t("Recorded {{count}} times.", { count: duplicates })}{" "}
                    <Link component="button" onClick={() => showTab("health", { status: "duplicates" })}>
                        {i18n.t("Merge under Health")}
                    </Link>
                </Typography>
            )}

            {enrolled && (
                <Typography variant="body2" className={classes.muted}>
                    {coverage
                        ? i18n.t(
                              "Users who can use it: {{inCountry}} assigned to the country, {{above}} regional or global",
                              coverage
                          )
                        : i18n.t("Counting users…")}
                </Typography>
            )}

            {(enrolled || cell.status === "inactive") && (
                <div className={classes.contacts}>
                    {cell.contacts.map(contact => (
                        <ContactRow
                            key={contact.id}
                            contact={contact}
                            onEdit={() => editContact(cell, contact.id, "edit")}
                            onReplace={() => editContact(cell, contact.id, "replace")}
                            onRemove={() => removeContact(cell, contact.id)}
                        />
                    ))}

                    {_.isEmpty(cell.contacts) && (
                        <Typography variant="body2" className={classes.warning}>
                            {i18n.t("No focal point recorded.")}
                        </Typography>
                    )}

                    <Button size="small" color="primary" startIcon={<PersonAddIcon />} onClick={() => addContact(cell)}>
                        {i18n.t("Add focal point")}
                    </Button>

                    {!_.isEmpty(previous) && (
                        <details className={classes.previous}>
                            <summary>{i18n.t("Previous focal points ({{count}})", { count: previous.length })}</summary>
                            {previous.map(contact => (
                                <Typography
                                    key={`${contact.removedAt}-${contact.email}`}
                                    variant="body2"
                                    className={classes.muted}
                                >
                                    {`${fullName(contact) || contact.email} — ${i18n.t("until {{date}}", {
                                        date: contact.removedAt.slice(0, 10),
                                    })}`}
                                </Typography>
                            ))}
                        </details>
                    )}
                </div>
            )}
        </section>
    );
};

const ContactRow: React.FC<{ contact: Contact; onEdit(): void; onReplace(): void; onRemove(): void }> = ({
    contact,
    onEdit,
    onReplace,
    onRemove,
}) => {
    const classes = useStyles();
    const stale = isStale(contact, new Date());

    return (
        <div className={classes.contact}>
            <div className={classes.contactText}>
                <Typography variant="body2" className={classes.name}>
                    {fullName(contact) || i18n.t("(no name)")}
                    {contact.function && <span className={classes.muted}>{` · ${contact.function}`}</span>}
                </Typography>
                <Typography variant="body2" className={classes.muted}>
                    {_.compact([contact.email, contact.telephone, contact.institution]).join(" · ") ||
                        i18n.t("No contact details")}
                </Typography>
                <Typography variant="caption" className={stale ? classes.warning : classes.muted}>
                    {_.compact([
                        contact.startDate && i18n.t("since {{date}}", { date: contact.startDate }),
                        stale && i18n.t("not updated since {{date}}", { date: contact.updatedAt.slice(0, 10) }),
                    ]).join(" · ")}
                </Typography>
            </div>
            <Tooltip title={i18n.t("Edit")}>
                <IconButton size="small" onClick={onEdit}>
                    <EditIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Tooltip title={i18n.t("Replace with a successor")}>
                <IconButton size="small" onClick={onReplace}>
                    <SwapHorizIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Tooltip title={i18n.t("Remove")}>
                <IconButton size="small" onClick={onRemove}>
                    <DeleteOutlineIcon fontSize="small" />
                </IconButton>
            </Tooltip>
        </div>
    );
};

const useStyles = makeStyles({
    paper: { width: 480, maxWidth: "100vw", padding: "16px 20px", background: palette.surface },
    header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
    section: {
        background: "#fff",
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 12,
    },
    cardHeader: { display: "flex", alignItems: "center", gap: 10 },
    sectionTitle: { fontWeight: 600 },
    spacer: { flex: 1 },
    muted: { color: palette.muted },
    warning: { color: "#7a4100", marginTop: 4 },
    contacts: { marginTop: 8, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 },
    contact: {
        display: "flex",
        alignItems: "flex-start",
        width: "100%",
        padding: "6px 0",
        borderTop: `1px solid ${palette.border}`,
    },
    contactText: { flex: 1, minWidth: 0, "& p, & span": { overflowWrap: "anywhere" } },
    name: { fontWeight: 500 },
    previous: { marginTop: 4, fontSize: 13, "& summary": { cursor: "pointer", color: palette.muted } },
    historyLine: { display: "grid", gridTemplateColumns: "90px 1fr auto", gap: 8, padding: "2px 0" },
});
