import _ from "lodash";
import { Id } from "../../../common/entities/Base";
import {
    Contact,
    ContactDetails,
    Enrolment,
    EnrolmentCell,
    EnrolmentStatus,
    contentFields,
    fullName,
    isActive,
    keyOf,
    latestEnrolment,
} from "./Enrolment";

/**
 * Every write this report makes is expressed as a change set: enrolment status transitions plus
 * contact edits. One executor applies them, one record stores them, and the inverse of any change
 * set is itself a change set — which is what makes every action previewable, auditable and
 * revertible by the same code path.
 */

/** "NONE" means the enrolment did not exist and the change creates it. */
export type StatusChange = {
    countryId: Id;
    module: string;
    trackedEntityId: Id;
    enrollmentId: Id;
    enrolledAt: string;
    occurredAt: string;
    from: EnrolmentStatus | "NONE";
    to: EnrolmentStatus;
};

/**
 * A contact edit. `before` absent means the contact is created; `after` absent means it is removed;
 * both present means it is updated. The removed contact's details stay in `before`, which is how a
 * previous focal point remains answerable after it has gone from DHIS2.
 */
export type ContactChange = {
    countryId: Id;
    module: string;
    trackedEntityId: Id;
    enrollmentId: Id;
    eventId: Id;
    before?: ContactDetails;
    after?: ContactDetails;
};

export type ChangeSet = {
    statusChanges: StatusChange[];
    contactChanges: ContactChange[];
};

export const emptyChangeSet: ChangeSet = { statusChanges: [], contactChanges: [] };

export function isEmptyChangeSet(changes: ChangeSet): boolean {
    return _.isEmpty(changes.statusChanges) && _.isEmpty(changes.contactChanges);
}

export type Target = { countryId: Id; module: string };

export type SkipReason = "already-enrolled" | "not-enrolled" | "blocked";

/** What an enrol or un-enrol will do for one pair, shown line by line before it is applied. */
export type PlanLine = Target & {
    outcome: "create" | "revive" | "cancel" | "skip";
    reason?: SkipReason;
};

export type Plan = { lines: PlanLine[]; changes: ChangeSet };

type CellLookup = Record<string, EnrolmentCell | undefined>;

export function indexCells(cells: EnrolmentCell[]): CellLookup {
    return _.keyBy(cells, cell => keyOf({ countryId: cell.country.id, module: cell.module }));
}

/**
 * Enrols pairs. A pair already active is skipped; a pair with only cancelled or completed
 * enrolments has its latest one revived, keeping the contacts recorded against it; a pair never
 * enrolled gets a new tracked entity, unless its org unit is not assigned to the program.
 */
export function planEnrol(targets: Target[], cells: CellLookup, enrolledAt: string, newId: () => Id): Plan {
    const lines: PlanLine[] = [];
    const statusChanges: StatusChange[] = [];

    targets.forEach(target => {
        const cell = cells[keyOf(target)];
        const enrolments = cell?.enrolments ?? [];

        if (enrolments.some(isActive)) {
            lines.push({ ...target, outcome: "skip", reason: "already-enrolled" });
            return;
        }

        const revivable = latestEnrolment(enrolments);
        if (revivable) {
            lines.push({ ...target, outcome: "revive" });
            statusChanges.push(transition(revivable, "ACTIVE"));
            return;
        }

        if (cell?.isBlocked) {
            lines.push({ ...target, outcome: "skip", reason: "blocked" });
            return;
        }

        lines.push({ ...target, outcome: "create" });
        statusChanges.push({
            ...target,
            trackedEntityId: newId(),
            enrollmentId: newId(),
            enrolledAt,
            occurredAt: enrolledAt,
            from: "NONE",
            to: "ACTIVE",
        });
    });

    return { lines, changes: { statusChanges, contactChanges: [] } };
}

/** Un-enrols pairs by cancelling every active enrolment; nothing is deleted. */
export function planUnenrol(targets: Target[], cells: CellLookup): Plan {
    const lines: PlanLine[] = [];
    const statusChanges: StatusChange[] = [];

    targets.forEach(target => {
        const active = (cells[keyOf(target)]?.enrolments ?? []).filter(isActive);

        if (_.isEmpty(active)) {
            lines.push({ ...target, outcome: "skip", reason: "not-enrolled" });
            return;
        }

        lines.push({ ...target, outcome: "cancel" });
        statusChanges.push(...active.map(enrolment => transition(enrolment, "CANCELLED")));
    });

    return { lines, changes: { statusChanges, contactChanges: [] } };
}

/**
 * Collapses a duplicated pair onto a single enrolment.
 *
 * The survivor is the oldest active enrolment, or the oldest of all if none is active, so the
 * country keeps its access. Contacts found only on the redundant enrolments are copied onto the
 * survivor before those are cancelled. They are copied, not moved: DHIS2 does not let an event
 * change enrolment, and copying leaves the originals untouched on the cancelled enrolment.
 */
export function planMerge(enrolments: Enrolment[], newId: () => Id): ChangeSet {
    if (_.uniqBy(enrolments, enrolment => enrolment.trackedEntityId).length < 2) return emptyChangeSet;

    const byAge = _.sortBy(enrolments, enrolment => enrolment.enrolledAt);
    const survivor = byAge.find(isActive) ?? byAge[0];
    if (!survivor) return emptyChangeSet;

    const redundant = byAge.filter(enrolment => enrolment.enrollmentId !== survivor.enrollmentId);
    const known = new Set(survivor.contacts.map(personKey));

    const copies = _.uniqBy(
        _.flatMap(redundant, enrolment => enrolment.contacts).filter(contact => !known.has(personKey(contact))),
        personKey
    );

    return {
        statusChanges: redundant
            .filter(enrolment => enrolment.status !== "CANCELLED")
            .map(enrolment => transition(enrolment, "CANCELLED")),
        contactChanges: copies.map(contact => ({
            countryId: survivor.countryId,
            module: survivor.module,
            trackedEntityId: survivor.trackedEntityId,
            enrollmentId: survivor.enrollmentId,
            eventId: newId(),
            after: detailsOf(contact),
        })),
    };
}

/** The same person recorded twice is recognised by email, or by name when there is no email. */
function personKey(contact: ContactDetails): string {
    const email = contact.email.trim().toLowerCase();
    return email ? `email:${email}` : `name:${fullName(contact).toLowerCase()}`;
}

/** Contacts are attached to an active enrolment of the pair, falling back to its latest one. */
export function enrolmentForContacts(cell: EnrolmentCell): Enrolment | undefined {
    return _.minBy(cell.enrolments.filter(isActive), e => e.enrolledAt) ?? latestEnrolment(cell.enrolments);
}

export function planAddContact(cell: EnrolmentCell, details: ContactDetails, newId: () => Id): ChangeSet {
    const enrolment = enrolmentForContacts(cell);
    if (!enrolment) return emptyChangeSet;

    return {
        statusChanges: [],
        contactChanges: [{ ...refOf(enrolment), eventId: newId(), after: details }],
    };
}

export function planEditContact(contact: Contact, cell: EnrolmentCell, details: ContactDetails): ChangeSet {
    return {
        statusChanges: [],
        contactChanges: [{ ...refOf(cell, contact), eventId: contact.id, before: detailsOf(contact), after: details }],
    };
}

export function planRemoveContact(contact: Contact, cell: EnrolmentCell): ChangeSet {
    return {
        statusChanges: [],
        contactChanges: [{ ...refOf(cell, contact), eventId: contact.id, before: detailsOf(contact) }],
    };
}

/** Replacing is removing the outgoing person and adding the successor as one recorded change. */
export function planReplaceContact(
    contact: Contact,
    cell: EnrolmentCell,
    successor: ContactDetails,
    newId: () => Id
): ChangeSet {
    return {
        statusChanges: [],
        contactChanges: [
            ...planRemoveContact(contact, cell).contactChanges,
            { ...refOf(cell, contact), eventId: newId(), after: successor },
        ],
    };
}

export function planDeletePlaceholders(cells: EnrolmentCell[]): ChangeSet {
    return {
        statusChanges: [],
        contactChanges: _.flatMap(cells, cell =>
            _.flatMap(cell.enrolments, enrolment =>
                enrolment.placeholderIds.map(eventId => ({
                    ...refOf(enrolment),
                    eventId,
                    before: emptyDetails(""),
                }))
            )
        ),
    };
}

/**
 * The change set that undoes another. Status changes return to where they came from, except that
 * an enrolment this report created is cancelled rather than deleted; contact edits are mirrored,
 * and a removed contact is recreated under a new id from the details kept in `before`.
 */
export function invertChangeSet(changes: ChangeSet, newId: () => Id): ChangeSet {
    return {
        statusChanges: changes.statusChanges.map(change => ({
            ...change,
            from: change.to,
            to: change.from === "NONE" ? "CANCELLED" : change.from,
        })),
        contactChanges: changes.contactChanges.map(change => {
            if (!change.before) return { ..._.omit(change, "after"), before: change.after };
            if (!change.after) return { ..._.omit(change, "before"), eventId: newId(), after: change.before };
            return { ...change, before: change.after, after: change.before };
        }),
    };
}

/** Change-set items that the same item in a later change set would conflict with on revert. */
export function touchedItems(changes: ChangeSet): Set<Id> {
    return new Set([
        ...changes.statusChanges.map(change => change.enrollmentId),
        ...changes.contactChanges.map(change => change.eventId),
    ]);
}

export function emptyDetails(startDate: string): ContactDetails {
    return {
        firstName: "",
        familyName: "",
        function: "",
        email: "",
        telephone: "",
        institution: "",
        address: "",
        city: "",
        zipCode: "",
        language: "",
        startDate,
    };
}

/**
 * Every field of the focal point stage, so a saved contact round-trips completely: an edit that
 * dropped a field it did not show would erase whatever the country had recorded there.
 */
export function detailsOf(contact: ContactDetails): ContactDetails {
    return _.pick(contact, Object.keys(emptyDetails("")) as (keyof ContactDetails)[]);
}

/** Reasons a contact form cannot be saved yet, in the order a person would fix them. */
export function contactProblems(details: ContactDetails, isValidEmail: (email: string) => boolean): string[] {
    return _.compact([
        !(details.firstName.trim() || details.familyName.trim() || details.email.trim()) && "name-or-email-required",
        details.email && !isValidEmail(details.email) && "invalid-email",
        !/^\d{4}-\d{2}-\d{2}$/.test(details.startDate) && "invalid-date",
    ]);
}

function transition(enrolment: Enrolment, to: EnrolmentStatus): StatusChange {
    return {
        countryId: enrolment.countryId,
        module: enrolment.module,
        trackedEntityId: enrolment.trackedEntityId,
        enrollmentId: enrolment.enrollmentId,
        enrolledAt: enrolment.enrolledAt,
        occurredAt: enrolment.occurredAt,
        from: enrolment.status,
        to,
    };
}

type EnrolmentRef = Pick<ContactChange, "countryId" | "module" | "trackedEntityId" | "enrollmentId">;

function refOf(source: Enrolment | EnrolmentCell, contact?: Contact): EnrolmentRef {
    if ("enrollmentId" in source) {
        return {
            countryId: source.countryId,
            module: source.module,
            trackedEntityId: source.trackedEntityId,
            enrollmentId: source.enrollmentId,
        };
    }

    return {
        countryId: source.country.id,
        module: source.module,
        trackedEntityId: contact?.trackedEntityId ?? "",
        enrollmentId: contact?.enrollmentId ?? "",
    };
}

export type ConflictReason = "status-changed" | "already-enrolled" | "contact-changed" | "contact-removed";

export type Conflict = Target & { reason: ConflictReason };

/**
 * What in a change set no longer matches DHIS2.
 *
 * A change is planned from the data on screen, which may be minutes old. If another administrator
 * has since touched the same enrolment or contact, applying it would silently undo their work, or —
 * for two people enrolling the same country — create a duplicate that DHIS2 itself accepts. So each
 * change states what it expects to find, and anything that differs is reported instead of written.
 */
export function findConflicts(changes: ChangeSet, current: Enrolment[]): Conflict[] {
    const byEnrolment = _.keyBy(current, enrolment => enrolment.enrollmentId);
    const activePairs = new Set(current.filter(isActive).map(keyOf));

    const eventContent = new Map<Id, ContactDetails>([
        ..._.flatMap(current, e => e.contacts.map(c => [c.id, detailsOf(c)] as [Id, ContactDetails])),
        ..._.flatMap(current, e => e.placeholderIds.map(id => [id, emptyDetails("")] as [Id, ContactDetails])),
    ]);

    const conflicts: Conflict[] = [
        ..._.compact(
            changes.statusChanges.map(change => {
                const target = { countryId: change.countryId, module: change.module };
                if (change.from === "NONE") {
                    return activePairs.has(keyOf(target))
                        ? { ...target, reason: "already-enrolled" as const }
                        : undefined;
                }
                return byEnrolment[change.enrollmentId]?.status === change.from
                    ? undefined
                    : { ...target, reason: "status-changed" as const };
            })
        ),
        ..._.compact(
            changes.contactChanges.map(change => {
                if (!change.before) return undefined;
                const target = { countryId: change.countryId, module: change.module };
                const found = eventContent.get(change.eventId);
                if (!found) return { ...target, reason: "contact-removed" as const };
                return sameContent(found, change.before)
                    ? undefined
                    : { ...target, reason: "contact-changed" as const };
            })
        ),
    ];

    return _.uniqBy(conflicts, conflict => `${keyOf(conflict)}|${conflict.reason}`);
}

function sameContent(found: ContactDetails, expected: ContactDetails): boolean {
    const fieldsMatch = contentFields.every(field => (found[field] ?? "").trim() === (expected[field] ?? "").trim());
    return fieldsMatch && (!expected.startDate || found.startDate === expected.startDate);
}
