import _ from "lodash";
import { Id } from "../../../domain/common/entities/Base";
import { StatusChangedBy } from "../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import {
    planStatusChange,
    StatusRefusedError,
} from "../../../domain/reports/glass-data-submission/entities/StatusChange";
import { D2Api } from "../../../types/d2-api";
import { StoredSubmission, SubmissionChange, SubmissionsStore, toStatusChange } from "./submissionsStore";
import {
    ProgramSubmission,
    parseEntity,
    pickSubmission,
    StoredEntity,
    submissionKey,
    submissionsProgramIds as ids,
    toWhoEvent,
} from "./submissionsProgram";

/** Above the answer of every query below; a full page still makes the read ask for the next one (DHIS2 stops silently). */
const PAGE_SIZE = 500;
const KEYS_PER_QUERY = 100;

const fields = {
    trackedEntity: true,
    attributes: { attribute: true, value: true },
    enrollments: {
        enrollment: true,
        program: true,
        events: { programStage: true, occurredAt: true, status: true, dataValues: { dataElement: true, value: true } },
    },
} as const;

/** DHIS2 puts the reason for a refused import (for example no write access to a stage) in the report, not in `message`. */
function refusalMessage(error: unknown): string | undefined {
    const report = (error as { response?: { data?: { validationReport?: { errorReports?: { message?: string }[] } } } })
        ?.response?.data?.validationReport;
    const messages = _.compact(report?.errorReports?.map(errorReport => errorReport.message));
    return messages.length ? messages.join("; ") : undefined;
}

/**
 * Submissions in the submissions tracker program, written as the GLASS app writes them: each decision made here is one
 * event of the WHO decision stage, so only the changed submissions are written and no other change is lost.
 */
export class ProgramSubmissionsStore implements SubmissionsStore {
    constructor(private api: D2Api) {}

    /** One query per module. A refused read (403) or an entity that cannot be read as a submission is an error. */
    async read(moduleId: Id): Promise<StoredSubmission[]> {
        return this.readSubmissions(`${ids.keyAttribute}:sw:${moduleId}|`);
    }

    async check(change: SubmissionChange, changedBy: StatusChangedBy): Promise<void> {
        await this.assertCanWriteWhoStage();
        await this.assertInCaptureScope(await this.plan(change, changedBy));
    }

    async save(change: SubmissionChange, changedBy: StatusChangedBy): Promise<void> {
        const changed = await this.plan(change, changedBy);
        if (changed.length === 0) return;

        try {
            const report = await this.api.tracker
                .post({ importStrategy: "CREATE", atomicMode: "ALL" }, { events: changed.map(toWhoEvent) })
                .getData();
            if (report.status === "ERROR") throw new Error(report.message);
        } catch (error) {
            const reason = refusalMessage(error) ?? (error as Error)?.message;
            throw new StatusRefusedError(
                `Error saving the status change: the status was not changed and no email was sent, but data copies or registrations made for it may already have run: ${reason}`
            );
        }
    }

    /** The selected submissions as stored now, after the change is applied, and the ones the change touched. */
    private async plan(change: SubmissionChange, changedBy: StatusChangedBy): Promise<ProgramSubmission[]> {
        const keys = _.uniq(change.items.map(submissionKey));
        const stored = _.flatten(
            await Promise.all(
                _.chunk(keys, KEYS_PER_QUERY).map(chunk =>
                    this.readEntities(`${ids.keyAttribute}:in:${chunk.join(";")}`)
                )
            )
        );
        const entries = this.pickPerKey(this.parse(stored));

        const planned = planStatusChange(entries, toStatusChange(change), changedBy);
        return planned.filter((entry, index) => entry !== entries[index]);
    }

    private async readSubmissions(filter: string): Promise<ProgramSubmission[]> {
        return this.pickPerKey(this.parse(await this.readEntities(filter)));
    }

    private parse(entities: StoredEntity[]): ProgramSubmission[] {
        const parsed = entities.map(parseEntity);
        const problems = _.compact(parsed.map(({ problem }) => problem));
        if (problems.length > 0) throw new Error(problems.join("; "));
        return _.compact(parsed.map(({ submission }) => submission));
    }

    private pickPerKey(submissions: ProgramSubmission[]): ProgramSubmission[] {
        return _(submissions).groupBy(submissionKey).map(pickSubmission).compact().value();
    }

    /**
     * Always asks for the entities the user can reach (`ACCESSIBLE`): DHIS2 refuses a search with neither an org unit nor
     * that mode (409).
     */
    private async readEntities(filter: string, page = 1, read: StoredEntity[] = []): Promise<StoredEntity[]> {
        const response = await this.api.tracker.trackedEntities
            .get({ program: ids.program, ouMode: "ACCESSIBLE", filter, fields, page, pageSize: PAGE_SIZE })
            .getData();
        const entities = [...read, ...response.instances];
        return response.instances.length < PAGE_SIZE ? entities : this.readEntities(filter, page + 1, entities);
    }

    /**
     * Asked before any side effect (data copies, notifications): a refused write is a real failure now, and would leave
     * data copied and e-mails sent with the status unchanged.
     */
    private async assertCanWriteWhoStage(): Promise<void> {
        const stage = await this.api
            .get<{ access?: { data?: { write?: boolean } } }>(`/programStages/${ids.whoStage}`, {
                fields: "access[data[write]]",
            })
            .getData();

        if (stage.access?.data?.write !== true)
            throw new StatusRefusedError(
                "You do not have write access to the WHO decision stage of the submissions program, so the status cannot be changed. Nothing was changed."
            );
    }

    /**
     * The read reaches the countries of the user's search scope, but DHIS2 writes an event only in the capture scope, so
     * a country outside it is refused here, before any side effect, rather than at the save. A superuser (`ALL`) is not.
     */
    private async assertInCaptureScope(submissions: ProgramSubmission[]): Promise<void> {
        const orgUnitIds = _.uniq(submissions.map(submission => submission.orgUnit));
        if (orgUnitIds.length === 0) return;

        const me = await this.api
            .get<{ authorities: string[]; organisationUnits: { id: Id }[] }>("/me", {
                fields: "authorities,organisationUnits[id]",
            })
            .getData();
        if (me.authorities.includes("ALL")) return;

        const captureIds = new Set(me.organisationUnits.map(orgUnit => orgUnit.id));
        const orgUnits = _.flatten(
            await Promise.all(
                _.chunk(orgUnitIds, KEYS_PER_QUERY).map(async chunk => {
                    const response = await this.api
                        .get<{ organisationUnits: { id: Id; name: string; path: string }[] }>("/organisationUnits", {
                            filter: `id:in:[${chunk.join(",")}]`,
                            fields: "id,name,path",
                            paging: false,
                        })
                        .getData();
                    return response.organisationUnits;
                })
            )
        );
        const outside = orgUnitIds.filter(id => {
            const orgUnit = orgUnits.find(candidate => candidate.id === id);
            return !orgUnit?.path.split("/").some(pathId => captureIds.has(pathId));
        });

        if (outside.length > 0) {
            const names = outside.map(id => orgUnits.find(orgUnit => orgUnit.id === id)?.name ?? id);
            throw new StatusRefusedError(
                `You cannot change the status for ${names.join(", ")}: not in the organisation units you can enter data for. Nothing was changed.`
            );
        }
    }
}
