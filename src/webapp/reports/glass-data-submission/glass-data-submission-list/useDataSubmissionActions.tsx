import { useCallback, useState } from "react";
import {
    EARSubmissionItemIdentifier,
    GLASSDataSubmissionItemIdentifier,
    parseDataSubmissionItemId,
    parseEARSubmissionItemId,
    UpdateAction,
} from "../../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import { StatusConflictError } from "../../../../domain/reports/glass-data-submission/entities/StatusChange";
import _ from "lodash";
import i18n from "../../../../locales";
import { useAppContext } from "../../../contexts/app-context";
import { Namespaces } from "../../../../data/common/clients/storage/Namespaces";
import { useBooleanState } from "../../../utils/use-boolean";

type SnackbarMessage = {
    type: "error" | "success";
    message: string;
};

export function useDataSubmissionActions(isDatasetUpdate: boolean, reload: () => void) {
    const { compositionRoot } = useAppContext();

    const [isRejectionDialogOpen, { enable: openRejectionDialog, disable: closeDialog }] = useBooleanState(false);
    const [rejectionReason, setRejectionReason] = useState<string>("");
    const [rejectedItems, setRejectedItems] = useState<GLASSDataSubmissionItemIdentifier[]>([]);
    const [rejectedSignals, setRejectedSignals] = useState<EARSubmissionItemIdentifier[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [snackbarMessage, setSnackbarMessage] = useState<SnackbarMessage>();

    const saveText = !loading ? "Reject" : "Rejecting";
    const disableSave = rejectionReason === "" || loading;

    const onChangeRejectionReason = useCallback(({ value }: { value: string }) => {
        setRejectionReason(value);
    }, []);

    const openDataSubmissionRejectionDialog = useCallback(
        async (selectedIds: string[]) => {
            const items = _.compact(selectedIds.map(item => parseDataSubmissionItemId(item)));
            if (items.length === 0) return;

            setRejectedItems(items);
            openRejectionDialog();
        },
        [openRejectionDialog]
    );

    const openEARSignalRejectionDialog = useCallback(
        async (selectedIds: string[]) => {
            const items = _.compact(selectedIds.map(item => parseEARSubmissionItemId(item)));
            if (items.length === 0) return;

            setRejectedSignals(items);
            openRejectionDialog();
        },
        [openRejectionDialog]
    );

    const closeRejectionDialog = useCallback(() => {
        closeDialog();
        setRejectionReason("");
    }, [closeDialog, setRejectionReason]);

    const updateDataSubmissionStatus = useCallback(
        async (action: UpdateAction, selectedIds: string[], namespace: string) => {
            const items = _.compact(selectedIds.map(item => parseDataSubmissionItemId(item)));
            if (items.length === 0) return;

            setLoading(true);
            try {
                await compositionRoot.glassDataSubmission.updateStatus(namespace, action, items)?.then(() => {
                    setSnackbarMessage({
                        type: "success",
                        message: i18n.t("Data submissions have been successfully {{action}}", {
                            action: actionsPastMap[action] || action,
                        }),
                    });
                });
            } catch (error) {
                console.debug(error);
                setSnackbarMessage({
                    type: "error",
                    message: errorMessage(
                        error,
                        i18n.t("Error when trying to {{action}} submission", { action: action })
                    ),
                });
            } finally {
                setLoading(false);
                reload();
            }
        },
        [compositionRoot.glassDataSubmission, reload]
    );

    const approveEARSignal = useCallback(
        async (selectedIds: string[]) => {
            const items = _.compact(selectedIds.map(item => parseEARSubmissionItemId(item)));
            if (items.length === 0) return;

            setLoading(true);
            try {
                await compositionRoot.glassDataSubmission
                    .updateStatus(Namespaces.SIGNALS, "approve", [], undefined, undefined, items)
                    ?.then(() => {
                        setSnackbarMessage({
                            type: "success",
                            message: i18n.t("Signals have been successfully approved"),
                        });
                    });
            } catch (error) {
                console.debug(error);
                setSnackbarMessage({
                    type: "error",
                    message: errorMessage(error, i18n.t("Error when trying to approve signal")),
                });
            } finally {
                setLoading(false);
                reload();
            }
        },
        [compositionRoot.glassDataSubmission, reload]
    );

    const rejectDataSubmission = useCallback(async () => {
        setLoading(true);
        try {
            await compositionRoot.glassDataSubmission
                .updateStatus(Namespaces.DATA_SUBMISSSIONS, "reject", rejectedItems, rejectionReason, isDatasetUpdate)
                ?.then(() =>
                    setSnackbarMessage({
                        type: "success",
                        message: i18n.t("Data submissions have been successfully rejected"),
                    })
                );
        } catch (error) {
            console.debug(error);
            setSnackbarMessage({
                type: "error",
                message: errorMessage(error, i18n.t("Error when trying to reject submission")),
            });
        } finally {
            setLoading(false);
            closeRejectionDialog();
            reload();
        }
    }, [
        closeRejectionDialog,
        compositionRoot.glassDataSubmission,
        isDatasetUpdate,
        rejectedItems,
        rejectionReason,
        reload,
    ]);

    const rejectEARSignal = useCallback(async () => {
        setLoading(true);
        try {
            await compositionRoot.glassDataSubmission
                .updateStatus(Namespaces.SIGNALS, "reject", [], rejectionReason, false, rejectedSignals)
                ?.then(() =>
                    setSnackbarMessage({ type: "success", message: i18n.t("Signals have been successfully rejected") })
                );
        } catch (error) {
            console.debug(error);
            setSnackbarMessage({
                type: "error",
                message: errorMessage(error, i18n.t("Error when trying to reject signal")),
            });
        } finally {
            setLoading(false);
            closeRejectionDialog();
            reload();
        }
    }, [closeRejectionDialog, compositionRoot.glassDataSubmission, rejectedSignals, rejectionReason, reload]);

    return {
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
    };
}

/** A status conflict explains itself (reload the page); any other error keeps the generic text. */
function errorMessage(error: unknown, fallback: string): string {
    return error instanceof StatusConflictError ? error.message : fallback;
}

const actionsPastMap: { [key: string]: string } = {
    approve: "approved",
    reject: "rejected",
    accept: "accepted",
    reopen: "reopened",
};
