import _ from "lodash";
import { Id } from "../../../common/entities/Base";

/**
 * Enrolment of a country into a GLASS module.
 *
 * The source of truth is the tracker program named by `glass/general.enrolmentProgram`: one tracked
 * entity per (country org unit, module), carrying the module in a tracked entity attribute, with one
 * enrolment. GLASS shows a module to a country only while one of its enrolments is ACTIVE, so an
 * un-enrolment cancels rather than deletes, and the country's contacts survive it.
 */
export type EnrolmentStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type Country = {
    id: Id;
    name: string;
    /** ISO3 where the org unit has one. */
    code: string;
    /** WHO region code, from the parent org unit. */
    region: string;
};

export type ContactDetails = {
    firstName: string;
    familyName: string;
    function: string;
    email: string;
    telephone: string;
    institution: string;
    address: string;
    city: string;
    zipCode: string;
    language: string;
    /** The date this person took up the role, stored as the event's occurred date. */
    startDate: string;
};

/** A national focal point: one event in the enrolment's focal point stage. */
export type Contact = ContactDetails & {
    id: Id;
    enrollmentId: Id;
    trackedEntityId: Id;
    updatedAt: string;
};

export type Enrolment = {
    trackedEntityId: Id;
    enrollmentId: Id;
    countryId: Id;
    module: string;
    status: EnrolmentStatus;
    enrolledAt: string;
    occurredAt: string;
    contacts: Contact[];
    /**
     * Events carrying no details at all. The stage auto-generates one on every enrolment made in
     * the Capture app, which is why most of the program's events are empty.
     */
    placeholderIds: Id[];
};

export type CellStatus = "enrolled" | "enrolled-no-contact" | "inactive" | "not-enrolled" | "blocked";

/** One (country, module) pair: everything the matrix, the map and the country panel show. */
export type EnrolmentCell = {
    country: Country;
    module: string;
    /** Every enrolment for the pair; more than one tracked entity means the pair is duplicated. */
    enrolments: Enrolment[];
    status: CellStatus;
    /** The org unit is not assigned to the enrolment program, so it cannot be enrolled. */
    isBlocked: boolean;
    /** The contacts GLASS itself shows for the country — see `contactsShownFor`. */
    contacts: Contact[];
    /** Enrolment date of the enrolment that grants access, if any. */
    enrolledAt: string | undefined;
};

export function isActive(enrolment: Enrolment): boolean {
    return enrolment.status === "ACTIVE";
}

/**
 * Whether an entry holds anything at all. Every field counts, so an entry with only an address or a
 * language is never mistaken for an empty placeholder and deleted.
 */
export function hasDetails(details: Partial<ContactDetails>): boolean {
    return contentFields.some(field => Boolean(details[field]?.trim()));
}

/** Every field of a contact except its start date, which is when it applies rather than what it says. */
export const contentFields = [
    "firstName",
    "familyName",
    "function",
    "email",
    "telephone",
    "institution",
    "address",
    "city",
    "zipCode",
    "language",
] as const;

export function fullName(details: Pick<ContactDetails, "firstName" | "familyName">): string {
    return [details.firstName, details.familyName]
        .map(part => part.trim())
        .filter(part => part)
        .join(" ");
}

export function keyOf(target: { countryId: Id; module: string }): string {
    return `${target.countryId}|${target.module}`;
}

export function trackedEntityCount(enrolments: Enrolment[]): number {
    return _.uniq(enrolments.map(enrolment => enrolment.trackedEntityId)).length;
}

/**
 * The enrolment an action on a non-active pair should revive: the most recent one. Reviving every
 * duplicate at once would recreate the duplication the country already has.
 */
export function latestEnrolment(enrolments: Enrolment[]): Enrolment | undefined {
    return _.maxBy(enrolments, enrolment => enrolment.enrolledAt);
}

/**
 * The contacts GLASS shows for a pair, using GLASS's own rule: those on active enrolments, or, when
 * none is active, those on the most recent enrolment. Showing the same set here means what an
 * administrator edits is exactly what the country sees.
 */
export function contactsShownFor(enrolments: Enrolment[]): Contact[] {
    const active = enrolments.filter(isActive);
    const source = _.isEmpty(active) ? _.compact([latestEnrolment(enrolments)]) : active;
    return _.flatMap(source, enrolment => enrolment.contacts);
}

export function buildCells(
    countries: Country[],
    modules: string[],
    enrolments: Enrolment[],
    assignedOrgUnitIds: Set<Id>
): EnrolmentCell[] {
    const byKey = _.groupBy(enrolments, keyOf);

    return _.flatMap(modules, module =>
        countries.map((country): EnrolmentCell => {
            const cellEnrolments = byKey[keyOf({ countryId: country.id, module })] ?? [];
            const active = cellEnrolments.filter(isActive);
            const contacts = contactsShownFor(cellEnrolments);
            const isBlocked = !assignedOrgUnitIds.has(country.id);

            const status: CellStatus = !_.isEmpty(active)
                ? _.isEmpty(contacts)
                    ? "enrolled-no-contact"
                    : "enrolled"
                : !_.isEmpty(cellEnrolments)
                ? "inactive"
                : isBlocked
                ? "blocked"
                : "not-enrolled";

            return {
                country,
                module,
                enrolments: cellEnrolments,
                status,
                isBlocked,
                contacts,
                enrolledAt: _.minBy(active, enrolment => enrolment.enrolledAt)?.enrolledAt,
            };
        })
    );
}

export function isEnrolled(cell: EnrolmentCell): boolean {
    return cell.status === "enrolled" || cell.status === "enrolled-no-contact";
}

/** A contact untouched for this long is worth confirming with the country. */
export const STALE_AFTER_YEARS = 2;

export function isStale(contact: Contact, now: Date): boolean {
    if (!contact.updatedAt) return false;
    const threshold = new Date(now);
    threshold.setFullYear(threshold.getFullYear() - STALE_AFTER_YEARS);
    return new Date(contact.updatedAt) < threshold;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
    return emailPattern.test(email.trim());
}

/** Users able to use a module for a country, split by where they sit in the org unit tree. */
export type UserCoverage = {
    /** Users assigned to the country itself or somewhere inside it. */
    inCountry: number;
    /** Users assigned to the country's region or above, who therefore cover it too. */
    above: number;
};

/** module -> country id -> coverage */
export type AccessSummary = Record<string, Record<Id, UserCoverage>>;

export type GlassModule = {
    id: Id;
    name: string;
    userGroups: {
        readAccess: { id: Id; name: string }[];
        captureAccess: { id: Id; name: string }[];
        approveAccess: { id: Id; name: string }[];
        confidentialAccess?: { id: Id; name: string }[];
    };
};

/**
 * The modules a user administers: those where they belong to one of the module's own admin groups,
 * recognised by name ("AMR-AMC admin", "AMR-Individual admin"…). Approval groups alone are not
 * enough — for AMC they include the data capture group, whose members are country data entry staff.
 */
export function administeredModules(modules: GlassModule[], userGroupIds: Set<Id>): GlassModule[] {
    return modules.filter(module =>
        _.flatten(_.compact(Object.values(module.userGroups))).some(
            group => group.name.trim().toLowerCase().endsWith(" admin") && userGroupIds.has(group.id)
        )
    );
}

export type CountryGeometry = {
    id: Id;
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
};
