import _ from "lodash";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAppContext } from "../../contexts/app-context";
import { useReload } from "../../utils/use-reload";
import { generateUid } from "../../../utils/uid";
import { Id } from "../../../domain/common/entities/Base";
import { ChangeSet, indexCells } from "../../../domain/reports/glass-enrolment/entities/ChangeSet";
import {
    AccessSummary,
    EnrolmentCell,
    GlassModule,
    administeredModules,
    buildCells,
} from "../../../domain/reports/glass-enrolment/entities/Enrolment";
import { HistoryAction, HistoryRecord } from "../../../domain/reports/glass-enrolment/entities/History";
import {
    EnrolmentSnapshot,
    WriteResult,
} from "../../../domain/reports/glass-enrolment/repositories/EnrolmentRepository";
import { Tab, UrlState } from "./useUrlState";
import { getEnrolmentUseCases } from "./enrolmentUseCases";

export type ApplyOptions = {
    assignedCountryIds?: Id[];
    revertOf?: Id;
};

/**
 * Loads the whole enrolment picture once and shares it across tabs, the map and the country panel.
 *
 * The program is small — a few hundred tracked entities, each module fetched in well under a
 * second — so filtering in memory keeps every sort, page and filter instant. After a write the data
 * is refreshed in the background while the previous version stays on screen.
 */
export function useEnrolmentDataLoader() {
    const { api, config } = useAppContext();
    const useCases = useMemo(() => getEnrolmentUseCases(api), [api]);
    const [reloadKey, reload] = useReload();

    const [modules, setModules] = useState<GlassModule[]>();
    const [snapshot, setSnapshot] = useState<EnrolmentSnapshot>();
    const [access, setAccess] = useState<AccessSummary>();
    const [history, setHistory] = useState<HistoryRecord[]>([]);
    const [error, setError] = useState<string>();
    const [isRefreshing, setIsRefreshing] = useState(false);

    /** The modules this person administers: those whose own admin group they belong to. */
    const userModules = useMemo(
        () => modules && administeredModules(modules, new Set(config.currentUser.userGroups.map(group => group.id))),
        [modules, config.currentUser.userGroups]
    );

    const moduleNames = useMemo(() => (userModules ?? []).map(module => module.name), [userModules]);

    useEffect(() => {
        useCases
            .getModules()
            .then(setModules)
            .catch((loadError: Error) => setError(loadError.message));
    }, [useCases]);

    useEffect(() => {
        if (!userModules || _.isEmpty(userModules)) return;
        let cancelled = false;
        setIsRefreshing(true);

        Promise.all([useCases.getSnapshot(userModules.map(module => module.name)), useCases.getHistory()])
            .then(([loadedSnapshot, loadedHistory]) => {
                if (cancelled) return;
                setSnapshot(loadedSnapshot);
                setHistory(loadedHistory);
            })
            .catch((loadError: Error) => !cancelled && setError(loadError.message))
            .finally(() => !cancelled && setIsRefreshing(false));

        return () => {
            cancelled = true;
        };
    }, [useCases, userModules, reloadKey]);

    // User coverage changes rarely and takes longest to load, so it arrives on its own and is
    // not refreshed after every write.
    useEffect(() => {
        if (!userModules || _.isEmpty(userModules)) return;
        useCases
            .getAccess(userModules)
            .then(setAccess)
            .catch(() => setAccess({}));
    }, [useCases, userModules]);

    const cells = useMemo(
        () =>
            snapshot
                ? buildCells(snapshot.countries, moduleNames, snapshot.enrolments, snapshot.assignedOrgUnitIds)
                : [],
        [snapshot, moduleNames]
    );

    const cellIndex = useMemo(() => indexCells(cells), [cells]);

    const countries = useMemo(() => snapshot?.countries ?? [], [snapshot]);
    const countryNames = useMemo(() => _.fromPairs(countries.map(country => [country.id, country.name])), [countries]);
    const regions = useMemo(() => _.sortBy(_.uniq(countries.map(c => c.region).filter(r => r))), [countries]);

    const validate = useCallback((changes: ChangeSet): Promise<WriteResult> => useCases.validate(changes), [useCases]);

    const apply = useCallback(
        async (action: HistoryAction, changes: ChangeSet, options: ApplyOptions = {}): Promise<WriteResult> => {
            const result = await useCases.apply({
                action,
                changes,
                countryNames,
                user: config.currentUser,
                newId: generateUid,
                ...options,
            });
            reload();
            return result;
        },
        [useCases, countryNames, config.currentUser, reload]
    );

    return {
        canEditProgram: snapshot?.canEditProgram ?? false,
        userModules,
        moduleNames,
        countries,
        countryNames,
        regions,
        cells,
        cellIndex,
        access,
        history,
        error,
        isLoading: !error && (!userModules || (!_.isEmpty(userModules) && !snapshot)),
        isRefreshing,
        validate,
        apply,
        getGeometries: useCases.getGeometries,
        reload,
        newId: generateUid,
    };
}

export type EnrolmentData = ReturnType<typeof useEnrolmentDataLoader>;

export type EnrolmentActions = {
    openCountry(countryId: Id): void;
    enrol(countryIds: Id[], options?: { module?: string; mode?: "enrol" | "unenrol" }): void;
    addContact(cell?: EnrolmentCell): void;
    editContact(cell: EnrolmentCell, contactId: Id, mode: "edit" | "replace"): void;
    removeContact(cell: EnrolmentCell, contactId: Id): void;
    showTab(tab: Tab, filters?: Partial<UrlState>): void;
};

export const EnrolmentContext = React.createContext<(EnrolmentData & EnrolmentActions) | null>(null);

export function useEnrolment() {
    const context = useContext(EnrolmentContext);
    if (!context) throw new Error("EnrolmentContext missing");
    return context;
}
