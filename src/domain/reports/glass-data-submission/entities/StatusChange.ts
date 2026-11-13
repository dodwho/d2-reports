import {
    EARDataSubmissionItem,
    EARSubmissionItemIdentifier,
    GLASSDataSubmissionItem,
    GLASSDataSubmissionItemIdentifier,
    Status,
    StatusChangedBy,
} from "./GLASSDataSubmissionItem";

export type StatusEntry = Pick<GLASSDataSubmissionItem, "id" | "status" | "statusHistory">;

/** What a status change needs of a stored submission, whichever store holds it. */
export type SubmissionEntry = StatusEntry & Pick<GLASSDataSubmissionItem, "module" | "orgUnit" | "period">;

export interface StatusChange<T extends StatusEntry> {
    /** One test per selected submission. Each must match a stored entry whose status is in `from`. */
    selected: Array<(entry: T) => boolean>;
    from: Status[];
    to: Status;
}

/** Thrown when a stored status is no longer the one the user saw: nothing is written. */
export class StatusConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StatusConflictError";
        Object.setPrototypeOf(this, StatusConflictError.prototype);
    }
}

/** Thrown when the store refuses the write itself (no write access to the WHO decision stage): nothing is written. */
export class StatusRefusedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StatusRefusedError";
        Object.setPrototypeOf(this, StatusRefusedError.prototype);
    }
}

export function selectSubmissions(items: GLASSDataSubmissionItemIdentifier[]) {
    return items.map(
        item => (entry: SubmissionEntry) =>
            entry.orgUnit === item.orgUnit && entry.module === item.module && String(entry.period) === item.period
    );
}

export function selectSignals(signals: EARSubmissionItemIdentifier[]) {
    return signals.map(
        signal => (entry: EARDataSubmissionItem) =>
            entry.orgUnit.id === signal.orgUnitId && entry.module === signal.module && entry.id === signal.id
    );
}

/**
 * Applies the change to the entries read from the store just now. An entry is changed only when it is selected and
 * its status is in `from`; every other entry is returned as it is. A selected submission with no entry in `from`
 * (changed or deleted by someone else since the user saw it) refuses the whole change. Other entries for the same
 * module, country and period (older app versions stored duplicates) are left as they are.
 */
/**
 * The time of a new status change, as the GLASS app stamps it (`nextChangedAt` in glass-dev). The submissions program
 * orders changes by time only, so a browser clock behind the latest change's would put the new status before the
 * current one: never earlier than 1 ms after the latest stored change.
 */
export function nextChangedAt(history: { changedAt: string }[], now: Date): string {
    const latest = Math.max(-Infinity, ...history.map(item => Date.parse(item.changedAt)).filter(time => !isNaN(time)));
    return new Date(Math.max(now.getTime(), latest + 1)).toISOString();
}

export function planStatusChange<T extends StatusEntry>(
    entries: T[],
    change: StatusChange<T>,
    changedBy: StatusChangedBy,
    now: Date = new Date()
): T[] {
    const refused = change.selected
        .map(isSelected => entries.filter(isSelected))
        .filter(matches => !matches.some(entry => change.from.includes(entry.status)));

    if (refused.length > 0) {
        const found = refused.map(matches => matches.map(entry => entry.status).join("/") || "not found").join(", ");
        throw new StatusConflictError(
            `${refused.length} of ${change.selected.length} selected submissions are not ${change.from.join(" or ")} ` +
                `any more (now: ${found}), so they cannot be changed to ${change.to}. ` +
                "They may have been changed meanwhile: please reload the page."
        );
    }

    return entries.map(entry => {
        const isChanged = change.from.includes(entry.status) && change.selected.some(isSelected => isSelected(entry));
        if (!isChanged) return entry;

        const historyItem = {
            changedAt: nextChangedAt(entry.statusHistory, now),
            from: entry.status,
            to: change.to,
            changedBy,
        };
        return { ...entry, status: change.to, statusHistory: [...entry.statusHistory, historyItem] };
    });
}
