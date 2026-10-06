import React, { useCallback, useMemo, useState } from "react";
import _ from "lodash";
import { CircularProgress, LinearProgress, Tab as MuiTab, Tabs, Typography, makeStyles } from "@material-ui/core";
import i18n from "../../../locales";
import GLASSHeader from "../../components/headers/glass-data-submission/index";
import { Id } from "../../../domain/common/entities/Base";
import { EnrolmentCell } from "../../../domain/reports/glass-enrolment/entities/Enrolment";
import { EnrolmentActions, EnrolmentContext, useEnrolment, useEnrolmentDataLoader } from "./useEnrolmentData";
import { Tab, UrlState, useUrlState } from "./useUrlState";
import { SummaryCards } from "./components/SummaryCards";
import { CountryDrawer } from "./components/CountryDrawer";
import { EnrolDialog, EnrolDialogProps } from "./components/EnrolDialog";
import { ContactDialog, ContactDialogProps, RemoveContactDialog } from "./components/ContactDialog";
import { CountriesTab } from "./tabs/CountriesTab";
import { ContactsTab } from "./tabs/ContactsTab";
import { GapsTab } from "./tabs/GapsTab";
import { HealthTab } from "./tabs/HealthTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { MapTab } from "./map/MapTab";
import { palette } from "./theme";

type OpenDialog =
    | { kind: "enrol"; props: Omit<EnrolDialogProps, "onClose"> }
    | { kind: "contact"; props: ContactDialogProps }
    | { kind: "remove-contact"; cell: EnrolmentCell; contactId: Id };

const tabLabels: Record<Tab, () => string> = {
    countries: () => i18n.t("Countries"),
    map: () => i18n.t("Map"),
    contacts: () => i18n.t("Focal points"),
    gaps: () => i18n.t("Gaps"),
    health: () => i18n.t("Health"),
    history: () => i18n.t("History"),
};

const tabOrder: Tab[] = ["countries", "map", "contacts", "gaps", "health", "history"];

const GLASSEnrolmentReport: React.FC = () => {
    const classes = useStyles();
    const data = useEnrolmentDataLoader();
    const [url, setUrl] = useUrlState();
    const [dialog, setDialog] = useState<OpenDialog>();

    const closeDialog = useCallback(() => setDialog(undefined), []);

    const actions = useMemo(
        (): EnrolmentActions => ({
            openCountry: countryId => setUrl({ country: countryId }),
            enrol: (countryIds, options = {}) => setDialog({ kind: "enrol", props: { countryIds, ...options } }),
            addContact: cell => setDialog({ kind: "contact", props: { mode: "add", cell, onClose: closeDialog } }),
            editContact: (cell, contactId, mode) =>
                setDialog({ kind: "contact", props: { mode, cell, contactId, onClose: closeDialog } }),
            removeContact: (cell, contactId) => setDialog({ kind: "remove-contact", cell, contactId }),
            // Switching view resets the per-view filters, except those the caller hands over.
            showTab: (tab, filters = {}) => setUrl({ tab, status: "", q: "", country: "", ...filters }),
        }),
        [setUrl, closeDialog]
    );

    const context = useMemo(() => ({ ...data, ...actions }), [data, actions]);

    return (
        <EnrolmentContext.Provider value={context}>
            <GLASSHeader />
            <div className={classes.page}>
                <div className={classes.titleRow}>
                    <Typography variant="h5">{i18n.t("GLASS Country Enrolment")}</Typography>
                    <Typography variant="body2" className={classes.subtitle}>
                        {i18n.t(
                            "Which countries use which GLASS modules, who their focal points are, and what has changed."
                        )}
                    </Typography>
                </div>

                <Body url={url} setUrl={setUrl} />
            </div>

            {url.country && <CountryDrawer countryId={url.country} onClose={() => setUrl({ country: "" })} />}

            {dialog?.kind === "enrol" && <EnrolDialog {...dialog.props} onClose={closeDialog} />}
            {dialog?.kind === "contact" && <ContactDialog {...dialog.props} />}
            {dialog?.kind === "remove-contact" && (
                <RemoveContactDialog cell={dialog.cell} contactId={dialog.contactId} onClose={closeDialog} />
            )}
        </EnrolmentContext.Provider>
    );
};

const Body: React.FC<{ url: UrlState; setUrl(patch: Partial<UrlState>): void }> = ({ url, setUrl }) => {
    const classes = useStyles();
    const { error, userModules, isLoading, isRefreshing } = useEnrolment();

    if (error) return <Typography color="error">{error}</Typography>;

    // Administering a module comes from its user groups, so someone with none of them is told why
    // rather than shown an empty table they could read as "nothing is enrolled".
    if (userModules && _.isEmpty(userModules)) {
        return (
            <Typography className={classes.empty}>
                {i18n.t(
                    "You do not administer any GLASS module. Access comes from a module's approval user group (for example 'AMR-AMC admin'); ask a GLASS administrator to add you."
                )}
            </Typography>
        );
    }

    if (isLoading) {
        return (
            <div className={classes.loading}>
                <CircularProgress size={28} />
                <span>{i18n.t("Loading enrolments…")}</span>
            </div>
        );
    }

    return (
        <>
            <SummaryCards />

            <div className={classes.tabs}>
                <Tabs
                    value={url.tab}
                    onChange={(_event, tab: Tab) => setUrl({ tab, status: "", q: "" })}
                    indicatorColor="primary"
                    textColor="primary"
                    variant="scrollable"
                >
                    {tabOrder.map(tab => (
                        <MuiTab key={tab} value={tab} label={tabLabels[tab]()} />
                    ))}
                </Tabs>
                {/* Refreshing after a change keeps the old data on screen; this shows it is updating. */}
                <div className={classes.progress}>{isRefreshing && <LinearProgress />}</div>
            </div>

            {/* Keyed on the tab so each view starts with its own search box and paging. */}
            <div key={url.tab}>
                {url.tab === "countries" && <CountriesTab url={url} setUrl={setUrl} />}
                {url.tab === "map" && <MapTab url={url} setUrl={setUrl} />}
                {url.tab === "contacts" && <ContactsTab url={url} setUrl={setUrl} />}
                {url.tab === "gaps" && <GapsTab url={url} setUrl={setUrl} />}
                {url.tab === "health" && <HealthTab url={url} setUrl={setUrl} />}
                {url.tab === "history" && <HistoryTab url={url} setUrl={setUrl} />}
            </div>
        </>
    );
};

const useStyles = makeStyles({
    page: { padding: "16px 24px 32px", background: palette.surface, minHeight: "calc(100vh - 48px)" },
    titleRow: { marginBottom: 8 },
    subtitle: { color: palette.muted },
    tabs: { marginTop: 16, borderBottom: `1px solid ${palette.border}` },
    progress: { height: 2 },
    loading: { display: "flex", alignItems: "center", gap: 12, padding: 32 },
    empty: { padding: 24, maxWidth: 720 },
});

export default GLASSEnrolmentReport;
