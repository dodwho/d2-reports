import { StatusChangedBy } from "../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import {
    planStatusChange,
    StatusChange,
    StatusEntry,
} from "../../../domain/reports/glass-data-submission/entities/StatusChange";
import { StorageClient } from "../../common/clients/storage/StorageClient";

type Storage = Pick<StorageClient, "listObjectsInCollection" | "saveObject">;

/**
 * Checks the change against the stored statuses read now, without writing. Called before the side effects of an
 * action (data copies, notifications) so a stale request does not trigger them.
 */
export async function checkStatusChange<T extends StatusEntry>(
    storage: Storage,
    namespace: string,
    change: StatusChange<T>,
    changedBy: StatusChangedBy
): Promise<void> {
    planStatusChange(await storage.listObjectsInCollection<T>(namespace), change, changedBy);
}

/**
 * Re-reads the whole list just before saving and changes only the selected entries, so changes made by others since
 * the page was loaded are kept. The DataStore cannot "save only if unchanged": the window left is the time between
 * this read and the save.
 */
export async function saveStatusChange<T extends StatusEntry>(
    storage: Storage,
    namespace: string,
    change: StatusChange<T>,
    changedBy: StatusChangedBy
): Promise<void> {
    const fresh = await storage.listObjectsInCollection<T>(namespace);
    await storage.saveObject(namespace, planStatusChange(fresh, change, changedBy));
}
