import React, { useEffect, useMemo, useState } from "react";
import { DataSubmissionViewModel, EARDataSubmissionViewModel } from "../DataSubmissionViewModel";
import {
    ConfirmationDialog,
    ObjectsList,
    TableColumn,
    TableConfig,
    useObjectsTable,
    useSnackbar,
} from "@eyeseetea/d2-ui-components";
import {
    TextArea,
    // @ts-ignore
} from "@dhis2/ui";
import i18n from "../../../../locales";
import { useAppContext } from "../../../contexts/app-context";
import {
    parseDataSubmissionItemId,
    parseEARSubmissionItemId,
} from "../../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import { Namespaces } from "../../../../data/common/clients/storage/Namespaces";
import _ from "lodash";
import { emptySubmissionFilter, Filters } from "./Filters";
import { Check, Dashboard, LockOpen, ThumbDown, ThumbUp } from "@material-ui/icons";
import { goToDhis2Url } from "../../../../utils/utils";
import { useDataSubmissionList } from "./useDataSubmissionList";
import { useDataSubmissionActions } from "./useDataSubmissionActions";

export const DataSubmissionList: React.FC = React.memo(() => {
    const { api, compositionRoot } = useAppContext();

    const snackbar = useSnackbar();
    const [filters, setFilters] = useState(emptySubmissionFilter);
    const [isDatasetUpdate, setDatasetUpdate] = useState<boolean>(false);

    const {
        dataSubmissionPeriod,
        initialSorting,
        isEARModule,
        isEGASPUser,
        pagination,
        moduleQuestionnaires,
        selectablePeriods,
        visibleColumns,
        visibleEARColumns,
        getEARRows,
        getRows,
        reload,
        saveReorderedColumns,
        saveReorderedEARColumns,
    } = useDataSubmissionList(filters);

    const {
        disableSave,
        isRejectionDialogOpen,
        loading,
        rejectionReason,
        saveText,
        snackbarMessage,
        approveEARSignal,
        closeRejectionDialog,
        onChangeRejectionReason,
        openDataSubmissionRejectionDialog,
        openEARSignalRejectionDialog,
        rejectDataSubmission,
        rejectEARSignal,
        updateDataSubmissionStatus,
    } = useDataSubmissionActions(isDatasetUpdate, reload);

    useEffect(() => {
        if (snackbarMessage) {
            snackbar[snackbarMessage.type](snackbarMessage.message);
        }
    }, [snackbar, snackbarMessage]);

    const baseTableColumns: TableColumn<DataSubmissionViewModel>[] = useMemo(
        () => [
            { name: "orgUnitName", text: i18n.t("Country"), sortable: true },
            { name: "period", text: i18n.t(isEGASPUser ? "Period" : "Year"), sortable: true },
            {
                name: "questionnaireCompleted",
                text: i18n.t("Questionnaire completed"),
                sortable: true,
                getValue: (row: DataSubmissionViewModel) =>
                    row.questionnaireCompleted ? "Completed" : "Not completed",
            },
            {
                name: "dataSetsUploaded",
                text: i18n.t("DataSets uploaded"),
                sortable: true,
            },
            {
                name: "submissionStatus",
                text: i18n.t("Status"),
                sortable: true,
            },
        ],
        [isEGASPUser]
    );

    const baseConfig: TableConfig<DataSubmissionViewModel> = useMemo(
        () => ({
            columns:
                !_.isEmpty(moduleQuestionnaires) || !filters.module
                    ? baseTableColumns
                    : baseTableColumns.filter(column => column.name !== "questionnaireCompleted"),
            actions: [
                {
                    name: "unapvdDashboard",
                    text: i18n.t("Go to GLASS Unapproved Dashboard"),
                    icon: <Dashboard />,
                    multiple: true,
                    onClick: async (selectedIds: string[]) => {
                        const items = _.compact(selectedIds.map(item => parseDataSubmissionItemId(item)));
                        if (items.length === 0) return;

                        const unapvdDashboardId = await compositionRoot.glassDataSubmission.updateStatus(
                            Namespaces.DATA_SUBMISSSIONS,
                            "unapvdDashboard",
                            items
                        );

                        goToDhis2Url(api.baseUrl, `/dhis-web-dashboard/index.html#/${unapvdDashboardId}`);
                    },
                    isActive: (rows: DataSubmissionViewModel[]) => {
                        return _.every(rows, row => row.status === "PENDING_APPROVAL");
                    },
                },
                {
                    name: "approve",
                    text: i18n.t("Approve"),
                    icon: <ThumbUp />,
                    multiple: true,
                    onClick: async (selectedIds: string[]) =>
                        updateDataSubmissionStatus("approve", selectedIds, Namespaces.DATA_SUBMISSSIONS),
                    isActive: (rows: DataSubmissionViewModel[]) => {
                        return _.every(rows, row => row.status === "PENDING_APPROVAL");
                    },
                },
                {
                    name: "accept",
                    text: i18n.t("Accept"),
                    icon: <Check />,
                    multiple: true,
                    onClick: async (selectedIds: string[]) =>
                        updateDataSubmissionStatus("accept", selectedIds, Namespaces.DATA_SUBMISSSIONS),
                    isActive: (rows: DataSubmissionViewModel[]) => {
                        return _.every(rows, row => row.status === "PENDING_UPDATE_APPROVAL");
                    },
                },
                {
                    name: "reject",
                    text: i18n.t("Reject"),
                    icon: <ThumbDown />,
                    multiple: true,
                    onClick: openDataSubmissionRejectionDialog,
                    // One status for the whole selection: a reject is either of a submission or of an update
                    // request, and a mixed selection failed at save with a "please reload" that never helped.
                    isActive: (rows: DataSubmissionViewModel[]) => {
                        const statuses = _.uniq(rows.map(row => row.status));
                        const status = statuses.length === 1 ? statuses[0] : undefined;
                        if (status !== "PENDING_APPROVAL" && status !== "PENDING_UPDATE_APPROVAL") return false;
                        setDatasetUpdate(status === "PENDING_UPDATE_APPROVAL");
                        return true;
                    },
                },
                {
                    name: "reopen",
                    text: i18n.t("Reopen Submission"),
                    icon: <LockOpen />,
                    multiple: true,
                    onClick: async (selectedIds: string[]) =>
                        updateDataSubmissionStatus("reopen", selectedIds, Namespaces.DATA_SUBMISSSIONS),
                    isActive: (rows: DataSubmissionViewModel[]) => {
                        return _.every(rows, row => row.status === "PENDING_APPROVAL");
                    },
                },
            ],
            initialSorting: initialSorting,
            paginationOptions: pagination,
        }),
        [
            api.baseUrl,
            baseTableColumns,
            compositionRoot.glassDataSubmission,
            filters.module,
            initialSorting,
            openDataSubmissionRejectionDialog,
            pagination,
            moduleQuestionnaires,
            updateDataSubmissionStatus,
        ]
    );

    const earBaseConfig: TableConfig<EARDataSubmissionViewModel> = useMemo(
        () => ({
            columns: [
                { name: "orgUnitName", text: i18n.t("Country"), sortable: true },
                { name: "creationDate", text: i18n.t("Creation Date"), sortable: true },
                {
                    name: "levelOfConfidentiality",
                    text: i18n.t("Level of Confidentiality"),
                    sortable: true,
                    getValue: row =>
                        row.levelOfConfidentiality === "CONFIDENTIAL" ? "Confidential" : "Non-Confidential",
                },
                { name: "submissionStatus", text: i18n.t("Status"), sortable: true },
            ],
            actions: [
                {
                    name: "signalDashboard",
                    text: i18n.t("Go to Signal"),
                    icon: <Dashboard />,
                    multiple: false,
                    onClick: (selectedIds: string[]) => {
                        const items = _.compact(selectedIds.map(item => parseEARSubmissionItemId(item)));
                        if (items.length === 0) return;

                        const signals = items.map(item => {
                            return {
                                orgUnit: item.orgUnit,
                                module: item.module,
                                id: item.id,
                            };
                        });

                        goToDhis2Url(
                            api.baseUrl,
                            `api/apps/glass/index.html#/signal?orgUnit=${signals[0]?.orgUnit}&period=${signals[0]?.module}&eventId=${signals[0]?.id}`
                        );
                    },
                },
                {
                    name: "approve",
                    text: i18n.t("Approve"),
                    icon: <ThumbUp />,
                    multiple: true,
                    onClick: async (selectedIds: string[]) => approveEARSignal(selectedIds),
                    isActive: (rows: EARDataSubmissionViewModel[]) => {
                        return _.every(rows, row => row.status === "PENDING_APPROVAL");
                    },
                },
                {
                    name: "reject",
                    text: i18n.t("Reject"),
                    icon: <ThumbDown />,
                    multiple: true,
                    onClick: openEARSignalRejectionDialog,
                    isActive: (rows: EARDataSubmissionViewModel[]) => {
                        return _.every(rows, row => row.status === "PENDING_APPROVAL");
                    },
                },
            ],
            initialSorting: {
                field: "orgUnitId" as const,
                order: "asc" as const,
            },
            paginationOptions: {
                pageSizeOptions: [10, 20, 50],
                pageSizeInitialValue: 10,
            },
        }),
        [api.baseUrl, approveEARSignal, openEARSignalRejectionDialog]
    );

    const tableProps = useObjectsTable<DataSubmissionViewModel>(baseConfig, getRows);
    const earTableProps = useObjectsTable<EARDataSubmissionViewModel>(earBaseConfig, getEARRows);

    function getFilterOptions(selectablePeriods: string[]) {
        return {
            periods: selectablePeriods,
        };
    }
    const filterOptions = useMemo(() => getFilterOptions(selectablePeriods), [selectablePeriods]);

    const columnsToShow = useMemo<TableColumn<DataSubmissionViewModel>[]>(() => {
        if (!visibleColumns || _.isEmpty(visibleColumns)) return tableProps.columns;

        const indexes = _(visibleColumns)
            .map((columnName, idx) => [columnName, idx] as [string, number])
            .fromPairs()
            .value();

        return _(tableProps.columns)
            .map(column => ({ ...column, hidden: !visibleColumns.includes(column.name) }))
            .sortBy(column => indexes[column.name] || 0)
            .value();
    }, [tableProps.columns, visibleColumns]);

    const earColumnsToShow = useMemo<TableColumn<EARDataSubmissionViewModel>[]>(() => {
        if (!visibleEARColumns || _.isEmpty(visibleEARColumns)) return earTableProps.columns;

        const indexes = _(visibleEARColumns)
            .map((columnName, idx) => [columnName, idx] as [string, number])
            .fromPairs()
            .value();

        return _(earTableProps.columns)
            .map(column => ({ ...column, hidden: !visibleEARColumns.includes(column.name) }))
            .sortBy(column => indexes[column.name] || 0)
            .value();
    }, [earTableProps.columns, visibleEARColumns]);

    return isEARModule ? (
        <ObjectsList<EARDataSubmissionViewModel>
            {...earTableProps}
            loading={loading}
            columns={earColumnsToShow}
            onChangeSearch={undefined}
            onReorderColumns={saveReorderedEARColumns}
        >
            <Filters isEARModule={isEARModule} values={filters} options={filterOptions} onChange={setFilters} />

            <ConfirmationDialog
                isOpen={isRejectionDialogOpen}
                title={i18n.t("Reject Signal")}
                onCancel={closeRejectionDialog}
                cancelText={i18n.t("Cancel")}
                onSave={async () => rejectEARSignal()}
                saveText={saveText}
                maxWidth="md"
                disableSave={disableSave}
                fullWidth
            >
                <p>{i18n.t("Please provide a reason for rejecting this signal:")}</p>
                <TextArea type="text" rows={4} onChange={onChangeRejectionReason} value={rejectionReason} />
            </ConfirmationDialog>
        </ObjectsList>
    ) : (
        <ObjectsList<DataSubmissionViewModel>
            loading={loading}
            {...tableProps}
            columns={columnsToShow}
            onChangeSearch={undefined}
            onReorderColumns={saveReorderedColumns}
        >
            <Filters
                dataSubmissionPeriod={dataSubmissionPeriod}
                values={filters}
                options={filterOptions}
                onChange={setFilters}
            />

            <ConfirmationDialog
                isOpen={isRejectionDialogOpen}
                title={i18n.t("Reject Data Submission")}
                onCancel={closeRejectionDialog}
                cancelText={i18n.t("Cancel")}
                onSave={async () => rejectDataSubmission()}
                saveText={saveText}
                maxWidth="md"
                disableSave={disableSave}
                fullWidth
            >
                <p>{i18n.t("Please provide a reason for rejecting this data submission:")}</p>
                <TextArea type="text" rows={4} onChange={onChangeRejectionReason} value={rejectionReason} />
            </ConfirmationDialog>
        </ObjectsList>
    );
});
