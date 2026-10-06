import _ from "lodash";
import { Id } from "../../../common/entities/Base";
import { ChangeSet, ContactChange, touchedItems } from "./ChangeSet";
import { ContactDetails } from "./Enrolment";

export type HistoryAction =
    | "enrol"
    | "unenrol"
    | "merge"
    | "assign-program"
    | "contact-add"
    | "contact-edit"
    | "contact-replace"
    | "contact-remove"
    | "placeholders-delete"
    | "revert";

/**
 * One administrator action, stored under its own datastore key.
 *
 * A record is written as "pending" before anything changes and settled to "applied" or "failed"
 * afterwards, so an interrupted action is still visible. Keys are never shared between records, so
 * two administrators working at once cannot overwrite each other's history.
 */
export type HistoryRecord = {
    id: Id;
    at: string;
    by: string;
    action: HistoryAction;
    status: "pending" | "applied" | "failed";
    errors: string[];
    changes: ChangeSet;
    /** Org units added to the program; the one change that is metadata rather than data. */
    assignedCountryIds: Id[];
    countryNames: Record<Id, string>;
    /** Set on a revert: the record it undoes. */
    revertOf?: Id;
};

const notRevertible: HistoryAction[] = ["assign-program", "placeholders-delete", "revert"];

export function revertingRecord(record: HistoryRecord, history: HistoryRecord[]): HistoryRecord | undefined {
    return history.find(other => other.revertOf === record.id && other.status === "applied");
}

export function canRevert(record: HistoryRecord, history: HistoryRecord[]): boolean {
    return record.status === "applied" && !notRevertible.includes(record.action) && !revertingRecord(record, history);
}

/**
 * Later applied records that changed the same enrolments or contacts. Reverting restores the state
 * as it was before this record, so it would silently undo those too; the person reverting is told.
 */
export function laterConflicts(record: HistoryRecord, history: HistoryRecord[]): HistoryRecord[] {
    const touched = touchedItems(record.changes);

    return history.filter(
        other =>
            other.id !== record.id &&
            other.status === "applied" &&
            other.at > record.at &&
            other.revertOf !== record.id &&
            [...touchedItems(other.changes)].some(item => touched.has(item))
    );
}

export type PreviousContact = ContactDetails & {
    countryId: Id;
    module: string;
    removedAt: string;
    removedBy: string;
};

/**
 * Focal points who have left: contacts removed or replaced through this report and not restored
 * since. DHIS2 keeps no usable history of its own on this program, so this log is the only record.
 */
export function previousContacts(history: HistoryRecord[]): PreviousContact[] {
    const applied = history.filter(record => record.status === "applied");
    const reverted = new Set(_.compact(applied.map(record => record.revertOf)));

    return _.flatMap(
        applied.filter(record => !reverted.has(record.id) && record.action !== "placeholders-delete"),
        record =>
            record.changes.contactChanges
                .filter((change): change is ContactChange & { before: ContactDetails } =>
                    Boolean(change.before && !change.after)
                )
                .map(change => ({
                    ...change.before,
                    countryId: change.countryId,
                    module: change.module,
                    removedAt: record.at,
                    removedBy: record.by,
                }))
    );
}

export function countryIdsOf(record: HistoryRecord): Id[] {
    return _.uniq([
        ...record.changes.statusChanges.map(change => change.countryId),
        ...record.changes.contactChanges.map(change => change.countryId),
        ...record.assignedCountryIds,
    ]);
}

export function modulesOf(record: HistoryRecord): string[] {
    return _.uniq([
        ...record.changes.statusChanges.map(change => change.module),
        ...record.changes.contactChanges.map(change => change.module),
    ]);
}
