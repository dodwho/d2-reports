import _ from "lodash";
import { UseCase } from "../../../../compositionRoot";
import { Id } from "../../../common/entities/Base";
import { User } from "../../../common/entities/User";
import { ChangeSet, Conflict, emptyChangeSet, findConflicts, invertChangeSet } from "../entities/ChangeSet";
import { AccessSummary, CountryGeometry, GlassModule } from "../entities/Enrolment";
import { HistoryAction, HistoryRecord } from "../entities/History";
import { EnrolmentRepository, EnrolmentSnapshot, WriteResult } from "../repositories/EnrolmentRepository";

export class GetModulesUseCase implements UseCase {
    constructor(private repository: EnrolmentRepository) {}

    execute(): Promise<GlassModule[]> {
        return this.repository.getModules();
    }
}

export class GetSnapshotUseCase implements UseCase {
    constructor(private repository: EnrolmentRepository) {}

    execute(modules: string[]): Promise<EnrolmentSnapshot> {
        return this.repository.getSnapshot(modules);
    }
}

export class GetAccessUseCase implements UseCase {
    constructor(private repository: EnrolmentRepository) {}

    execute(modules: GlassModule[]): Promise<AccessSummary> {
        return this.repository.getAccess(modules);
    }
}

export class GetGeometriesUseCase implements UseCase {
    constructor(private repository: EnrolmentRepository) {}

    execute(): Promise<CountryGeometry[]> {
        return this.repository.getGeometries();
    }
}

export class GetHistoryUseCase implements UseCase {
    constructor(private repository: EnrolmentRepository) {}

    async execute(): Promise<HistoryRecord[]> {
        return _.orderBy(await this.repository.getHistory(), record => record.at, "desc");
    }
}

export type ChangeRequest = {
    action: HistoryAction;
    changes: ChangeSet;
    countryNames: Record<Id, string>;
    user: User;
    newId: () => Id;
    assignedCountryIds?: Id[];
    revertOf?: Id;
};

/**
 * Applies a change and records it.
 *
 * The record is saved as pending before anything is written, then settled to applied or failed.
 * Written first, it survives an action interrupted part-way through: history is never left
 * claiming less than was attempted, and the contacts a removal took away are already in it.
 */
export class ApplyChangeUseCase implements UseCase {
    constructor(private repository: EnrolmentRepository) {}

    async execute(request: ChangeRequest): Promise<WriteResult> {
        const at = new Date().toISOString();
        const record: HistoryRecord = {
            id: historyKey(at, request.newId()),
            at,
            by: request.user.username,
            action: request.action,
            status: "pending",
            errors: [],
            changes: request.changes,
            assignedCountryIds: request.assignedCountryIds ?? [],
            countryNames: request.countryNames,
            revertOf: request.revertOf,
        };

        // Re-read what the change touches: if anything moved since it was planned, refuse it
        // before a history record or a single write is made.
        const conflicts = await currentConflicts(this.repository, request.changes);
        if (!_.isEmpty(conflicts)) return { affected: 0, errors: [], conflicts };

        await this.repository.saveHistory(record);

        const result = _.isEmpty(record.assignedCountryIds)
            ? await this.repository.apply(request.changes, false)
            : await this.repository.assignToProgram(record.assignedCountryIds);

        await this.repository.saveHistory({
            ...record,
            status: _.isEmpty(result.errors) ? "applied" : "failed",
            errors: result.errors,
        });

        return result;
    }
}

export class ValidateChangeUseCase implements UseCase {
    constructor(private repository: EnrolmentRepository) {}

    async execute(changes: ChangeSet): Promise<WriteResult> {
        const conflicts = await currentConflicts(this.repository, changes);
        if (!_.isEmpty(conflicts)) return { affected: 0, errors: [], conflicts };
        return this.repository.apply(changes, true);
    }
}

async function currentConflicts(repository: EnrolmentRepository, changes: ChangeSet): Promise<Conflict[]> {
    const modules = _.uniq([
        ...changes.statusChanges.map(change => change.module),
        ...changes.contactChanges.map(change => change.module),
    ]);
    if (_.isEmpty(modules)) return [];

    const { enrolments } = await repository.getSnapshot(modules);
    return findConflicts(changes, enrolments);
}

/**
 * A datastore key for a record: time-ordered, unique, and free of "." and ":". DHIS2 reads what
 * follows a dot in a key as a file extension and drops it, which with a plain ISO timestamp made
 * every record written in the same second share, and overwrite, a single key.
 */
export function historyKey(at: string, uid: Id): string {
    return `${at.replace(/[^0-9TZ]/g, "")}-${uid}`;
}

/** The change set that undoes a recorded action; applying it goes through ApplyChangeUseCase. */
export function revertChangesOf(record: HistoryRecord, newId: () => Id): ChangeSet {
    return record.status === "applied" ? invertChangeSet(record.changes, newId) : emptyChangeSet;
}
