import { Id } from "../../../domain/common/entities/Base";
import {
    GLASSDataSubmissionItem,
    GLASSDataSubmissionItemIdentifier,
    Status,
    StatusChangedBy,
} from "../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import {
    selectSubmissions,
    SubmissionEntry,
} from "../../../domain/reports/glass-data-submission/entities/StatusChange";
import { StorageClient } from "../../common/clients/storage/StorageClient";
import { checkStatusChange, saveStatusChange } from "./statusChangeStorage";

/** A stored submission as the list needs it; the DataStore also keeps `from`, `to` and `creationDate`. */
export type StoredSubmission = SubmissionEntry & Partial<Pick<GLASSDataSubmissionItem, "from" | "to" | "creationDate">>;

/** The submissions chosen in the list and the statuses they must be in. Every status change names its expected `from`. */
export interface SubmissionChange {
    items: GLASSDataSubmissionItemIdentifier[];
    from: Status[];
    to: Status;
}

/**
 * Where the submissions and their statuses are kept: the DataStore list or the submissions tracker program, as
 * `dataSubmissionsStore` in `glass/general` says.
 */
export interface SubmissionsStore {
    /** The stored submissions of a module (the DataStore list may also hold other modules). */
    read(moduleId: Id): Promise<StoredSubmission[]>;
    /** Checks the change against the statuses stored now, without writing. Called before an action's side effects. */
    check(change: SubmissionChange, changedBy: StatusChangedBy): Promise<void>;
    /** Re-reads, then changes only the selected entries that are still in the expected status. */
    save(change: SubmissionChange, changedBy: StatusChangedBy): Promise<void>;
}

export class DataStoreSubmissionsStore implements SubmissionsStore {
    constructor(private storage: StorageClient, private namespace: string) {}

    async read(): Promise<StoredSubmission[]> {
        return (await this.storage.getObject<GLASSDataSubmissionItem[]>(this.namespace)) ?? [];
    }

    check(change: SubmissionChange, changedBy: StatusChangedBy): Promise<void> {
        return checkStatusChange(this.storage, this.namespace, toStatusChange(change), changedBy);
    }

    save(change: SubmissionChange, changedBy: StatusChangedBy): Promise<void> {
        return saveStatusChange(this.storage, this.namespace, toStatusChange(change), changedBy);
    }
}

export function toStatusChange({ items, from, to }: SubmissionChange) {
    return { selected: selectSubmissions(items), from, to };
}
