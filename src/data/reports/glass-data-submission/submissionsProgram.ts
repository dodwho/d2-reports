import _ from "lodash";
import { D2TrackerEventToPost } from "@eyeseetea/d2-api/api/trackerEvents";
import {
    GLASSDataSubmissionItem,
    Status,
    StatusChangedBy,
} from "../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import { SubmissionEntry } from "../../../domain/reports/glass-data-submission/entities/StatusChange";
import { generateUid } from "../../../utils/uid";

/**
 * The submissions tracker program, as the GLASS app (glass-dev, `dataSubmissionsProgram.ts`) writes it: one tracked
 * entity and one enrolment per submission, keyed `module|orgUnit|period`, one event per status change. The app writes the
 * country stage; the decisions made here (approve, reject, accept an update request, reopen) are events of the WHO
 * decision stage. The two repositories share no package: `__tests__/submissionsProgram.spec.ts` pins the ids and the
 * event shape, and a change to the program means changing both repositories.
 */
export const submissionsProgramIds = {
    program: "tYrldPT7GdM",
    keyAttribute: "BnPCDGNd65z",
    countryStage: "cwfWfm0n6I3",
    whoStage: "jxQ1ORphos5",
    countryStatus: "VBr63uPhVGs",
    whoDecision: "YFEuB08kqGD",
    previousStatus: "SbqldKig1uJ",
    decidedKey: "ZCEMoKm6IKD",
    originalChangedBy: "MtsLg6HDKCg",
} as const;

const ids = submissionsProgramIds;

/** The statuses the program stores. An entity whose latest event holds any other value is a problem, never guessed. */
const PROGRAM_STATUSES: Status[] = [
    "NOT_COMPLETED",
    "COMPLETE",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "PENDING_UPDATE_APPROVAL",
    "UPDATE_REQUEST_ACCEPTED",
];

export type SubmissionKey = Pick<GLASSDataSubmissionItem, "module" | "orgUnit" | "period">;

export function submissionKey(submission: SubmissionKey): string {
    return `${submission.module}|${submission.orgUnit}|${submission.period}`;
}

function parseSubmissionKey(key: string): SubmissionKey | undefined {
    const [module, orgUnit, period, ...rest] = key.split("|");
    return module && orgUnit && period && rest.length === 0 ? { module, orgUnit, period } : undefined;
}

type StatusHistory = GLASSDataSubmissionItem["statusHistory"];

/**
 * DHIS2 returns an event's occurredAt without a time zone and gives back exactly what it was sent when that has none
 * (DEV, 6 Nov 2026, milliseconds kept). So the UTC time is stored without its "Z" and read back with it.
 */
function toOccurredAt(changedAt: string): string {
    return new Date(changedAt).toISOString().replace(/Z$/, "");
}

function fromOccurredAt(occurredAt: string): string {
    return new Date(occurredAt.slice(0, 23) + "Z").toISOString();
}

function parseChangedBy(value: string): StatusChangedBy | undefined {
    const match = value.match(/^(.*) \(([A-Za-z0-9]+)\)$/);
    return match ? { username: match[1] ?? "", id: match[2] ?? "" } : undefined;
}

type StoredEvent = {
    programStage?: string;
    occurredAt?: string;
    status?: string;
    dataValues?: { dataElement?: string; value?: string }[];
};

/**
 * Why a submission's events cannot be read as a history (an event of another stage, or without a valid date, e.g.
 * made by hand in Capture), or undefined. Checked before `historyFromEvents`, which would throw on such dates.
 */
function problemInEvents(events: StoredEvent[]): string | undefined {
    const bad = events.find(
        event =>
            (event.programStage !== ids.countryStage && event.programStage !== ids.whoStage) ||
            Number.isNaN(Date.parse((event.occurredAt ?? "").slice(0, 23) + "Z"))
    );
    return bad
        ? `an event of stage ${bad.programStage ?? "(none)"} dated "${bad.occurredAt ?? ""}" cannot be read`
        : undefined;
}

/**
 * The status history stored in a submission's events, oldest first (DHIS2 keeps no other order). Only COMPLETED
 * events are changes: every change is written COMPLETED, so a scheduled or open event is not one.
 */
function historyFromEvents(events: StoredEvent[]): StatusHistory {
    return _(events)
        .filter(event => event.status === "COMPLETED")
        .map(event => {
            const value = (dataElement: string) =>
                event.dataValues?.find(dataValue => dataValue.dataElement === dataElement)?.value;
            const to = value(event.programStage === ids.whoStage ? ids.whoDecision : ids.countryStatus);
            const from = value(ids.previousStatus);
            const changedBy = value(ids.originalChangedBy);
            const parsedChangedBy = changedBy ? parseChangedBy(changedBy) : undefined;
            return {
                to: to as Status,
                changedAt: fromOccurredAt(event.occurredAt ?? ""),
                ...(from ? { from: from as Status } : {}),
                ...(parsedChangedBy ? { changedBy: parsedChangedBy } : {}),
            };
        })
        .sortBy(item => item.changedAt)
        .value();
}

export type StoredEntity = {
    trackedEntity?: string;
    attributes?: { attribute?: string; value?: string }[];
    enrollments?: { enrollment?: string; program?: string; events?: StoredEvent[] }[];
};

/** A submission read from the program. `enrollment` is where its next event is posted. */
export type ProgramSubmission = SubmissionEntry & { enrollment: string };

/** The submission an entity holds. An entity that cannot be read as one is named, never skipped or guessed. */
export function parseEntity(entity: StoredEntity): { submission?: ProgramSubmission; problem?: string } {
    const key = entity.attributes?.find(attribute => attribute.attribute === ids.keyAttribute)?.value;
    const keyParts = key ? parseSubmissionKey(key) : undefined;
    const enrollment = entity.enrollments?.find(enrollment => enrollment.program === ids.program);
    const eventProblem = problemInEvents(enrollment?.events ?? []);
    if (eventProblem) return { problem: `Data submission ${entity.trackedEntity ?? "(no id)"}: ${eventProblem}` };
    const statusHistory = historyFromEvents(enrollment?.events ?? []);
    const status = _.last(statusHistory)?.to;

    if (!entity.trackedEntity || !keyParts || !enrollment?.enrollment || !status || !PROGRAM_STATUSES.includes(status))
        return {
            problem: `Data submission ${
                entity.trackedEntity ?? "(no id)"
            } in the submissions program has no valid key, enrolment or status`,
        };
    return {
        submission: { id: entity.trackedEntity, ...keyParts, status, statusHistory, enrollment: enrollment.enrollment },
    };
}

/**
 * The one submission for a module, country and period. Older app versions sometimes stored several; the most used one
 * (longest status history, then lowest id) is chosen, as in the GLASS app, so both apps show the same status.
 */
export function pickSubmission<T extends Pick<SubmissionEntry, "id" | "statusHistory">>(matches: T[]): T | undefined {
    return [...matches].sort(
        (a, b) => b.statusHistory.length - a.statusHistory.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )[0];
}

/** One WHO decision event, with a new uid, for the last change in the history of `submission`. */
export function toWhoEvent(submission: ProgramSubmission): D2TrackerEventToPost {
    const change = _.last(submission.statusHistory);
    if (!change) throw new Error(`Data submission ${submission.id} has no status change to write`);

    return {
        event: generateUid(),
        program: ids.program,
        programStage: ids.whoStage,
        enrollment: submission.enrollment,
        trackedEntity: submission.id,
        orgUnit: submission.orgUnit,
        occurredAt: toOccurredAt(change.changedAt),
        status: "COMPLETED",
        dataValues: _.compact([
            { dataElement: ids.whoDecision, value: change.to },
            { dataElement: ids.decidedKey, value: submissionKey(submission) },
            change.from ? { dataElement: ids.previousStatus, value: change.from } : undefined,
            change.changedBy
                ? { dataElement: ids.originalChangedBy, value: `${change.changedBy.username} (${change.changedBy.id})` }
                : undefined,
        ]),
    };
}
