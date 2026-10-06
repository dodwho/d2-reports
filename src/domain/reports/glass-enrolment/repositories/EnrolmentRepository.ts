import { Id } from "../../../common/entities/Base";
import { ChangeSet, Conflict } from "../entities/ChangeSet";
import { AccessSummary, Country, CountryGeometry, Enrolment, GlassModule } from "../entities/Enrolment";
import { HistoryRecord } from "../entities/History";

/** What the server said a write did, or would do on a dry run. */
export type WriteResult = {
    affected: number;
    errors: string[];
    /** Set when the change was refused because the data changed since it was planned. */
    conflicts?: Conflict[];
};

export type EnrolmentSnapshot = {
    countries: Country[];
    enrolments: Enrolment[];
    /** Org units the enrolment program is assigned to; any other country cannot be enrolled. */
    assignedOrgUnitIds: Set<Id>;
    /** Whether this user may change the program's metadata, which adding a country requires. */
    canEditProgram: boolean;
};

export interface EnrolmentRepository {
    getModules(): Promise<GlassModule[]>;
    getSnapshot(modules: string[]): Promise<EnrolmentSnapshot>;
    getAccess(modules: GlassModule[]): Promise<AccessSummary>;
    getGeometries(): Promise<CountryGeometry[]>;

    /**
     * Applies a change set. A dry run asks DHIS2 to validate exactly the same payload without
     * persisting it, so a preview reports the server's verdict rather than a guess.
     */
    apply(changes: ChangeSet, dryRun: boolean): Promise<WriteResult>;

    /** The only metadata write: lets a blocked country be enrolled at all. */
    assignToProgram(countryIds: Id[]): Promise<WriteResult>;

    getHistory(): Promise<HistoryRecord[]>;
    saveHistory(record: HistoryRecord): Promise<void>;
}
