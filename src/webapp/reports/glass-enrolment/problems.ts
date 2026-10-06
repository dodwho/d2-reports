import _ from "lodash";
import i18n from "../../../locales";
import { Id } from "../../../domain/common/entities/Base";
import { Conflict } from "../../../domain/reports/glass-enrolment/entities/ChangeSet";
import { WriteResult } from "../../../domain/reports/glass-enrolment/repositories/EnrolmentRepository";

/** Everything that stopped a change, as sentences a person can act on. */
export function problemsOf(result: WriteResult, countryNames: Record<Id, string>): string[] {
    return [...(result.conflicts ?? []).map(conflict => describeConflict(conflict, countryNames)), ...result.errors];
}

export function hasProblems(result: WriteResult): boolean {
    return !_.isEmpty(result.errors) || !_.isEmpty(result.conflicts);
}

/** Conflicts mean the page is out of date, which the person fixes by reloading, not by retrying. */
export function isStale(result: WriteResult): boolean {
    return !_.isEmpty(result.conflicts);
}

function describeConflict(conflict: Conflict, countryNames: Record<Id, string>): string {
    const where = `${countryNames[conflict.countryId] ?? conflict.countryId} — ${conflict.module}`;

    switch (conflict.reason) {
        case "already-enrolled":
            return i18n.t("{{where}}: enrolled by someone else since this page was loaded", { where });
        case "status-changed":
            return i18n.t("{{where}}: enrolment changed by someone else since this page was loaded", { where });
        case "contact-changed":
            return i18n.t("{{where}}: focal point edited by someone else since this page was loaded", { where });
        case "contact-removed":
            return i18n.t("{{where}}: focal point removed by someone else since this page was loaded", { where });
    }
}
