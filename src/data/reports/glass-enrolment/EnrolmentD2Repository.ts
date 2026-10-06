import _ from "lodash";
import { D2Api } from "../../../types/d2-api";
import { Id } from "../../../domain/common/entities/Base";
import { ChangeSet, ContactChange, StatusChange } from "../../../domain/reports/glass-enrolment/entities/ChangeSet";
import {
    AccessSummary,
    Contact,
    ContactDetails,
    Country,
    CountryGeometry,
    Enrolment,
    EnrolmentStatus,
    GlassModule,
    hasDetails,
} from "../../../domain/reports/glass-enrolment/entities/Enrolment";
import { HistoryRecord } from "../../../domain/reports/glass-enrolment/entities/History";
import {
    EnrolmentRepository,
    EnrolmentSnapshot,
    WriteResult,
} from "../../../domain/reports/glass-enrolment/repositories/EnrolmentRepository";
import { Namespaces, glassDataStoreNamespace } from "../../common/clients/storage/Namespaces";
import {
    DEFAULT_ENROLMENT_PROGRAM_ID,
    ENROLMENT_MODULE_ATTRIBUTE_ID,
    FOCAL_POINT_DATA_ELEMENTS,
    HISTORY_NAMESPACE,
    MODULE_ENROLMENT_CODES,
} from "../../common/entities/GlassEnrolment";

const PAGE_SIZE = 250;
const CHUNK_SIZE = 100;

type GeneralInfo = { countryLevel?: number; enrolmentProgram?: string };

type ProgramInfo = {
    programId: Id;
    programStageId: Id;
    trackedEntityType: Id;
    assignedOrgUnitIds: Set<Id>;
    canEditProgram: boolean;
};

type CountryWithPath = Country & { path: string };

type TrackerType = "TRACKED_ENTITY" | "ENROLLMENT" | "EVENT";

export class EnrolmentD2Repository implements EnrolmentRepository {
    private generalInfo: Promise<GeneralInfo> | undefined;
    private programInfo: Promise<ProgramInfo> | undefined;
    private countries: Promise<CountryWithPath[]> | undefined;

    constructor(private api: D2Api) {}

    // --- configuration -----------------------------------------------------------------------

    /**
     * `glass/general` already declares the enrolment program and the country level; reading them
     * keeps the ids in one place instead of hardcoding them in both this app and GLASS itself.
     * The datastore is reached through the api the app authenticated, not a second client.
     */
    private getGeneralInfo(): Promise<GeneralInfo> {
        this.generalInfo ??= this.api
            .dataStore(glassDataStoreNamespace)
            .get<GeneralInfo>("general")
            .getData()
            .then(info => info ?? {});
        return this.generalInfo;
    }

    private getProgramInfo(): Promise<ProgramInfo> {
        this.programInfo ??= this.getGeneralInfo().then(async ({ enrolmentProgram }) => {
            const programId = enrolmentProgram || DEFAULT_ENROLMENT_PROGRAM_ID;
            const program = await this.api
                .get<{
                    trackedEntityType: { id: Id };
                    organisationUnits: { id: Id }[];
                    programStages: { id: Id }[];
                    access?: { update?: boolean };
                }>(`/programs/${programId}`, {
                    fields: "trackedEntityType[id],organisationUnits[id],programStages[id],access[update]",
                })
                .getData();

            return {
                programId,
                programStageId: program.programStages[0]?.id ?? "",
                trackedEntityType: program.trackedEntityType.id,
                assignedOrgUnitIds: new Set(program.organisationUnits.map(orgUnit => orgUnit.id)),
                canEditProgram: program.access?.update ?? false,
            };
        });
        return this.programInfo;
    }

    private getCountries(): Promise<CountryWithPath[]> {
        this.countries ??= this.getGeneralInfo().then(async ({ countryLevel }) => {
            const { objects } = await this.api.models.organisationUnits
                .get({
                    fields: { id: true, name: true, code: true, path: true, parent: { code: true, name: true } },
                    filter: { level: { eq: String(countryLevel ?? 3) } },
                    paging: false,
                })
                .getData();

            return _.sortBy(
                objects.map(orgUnit => ({
                    id: orgUnit.id,
                    name: orgUnit.name,
                    code: orgUnit.code ?? "",
                    region: orgUnit.parent?.code || orgUnit.parent?.name || "",
                    path: orgUnit.path,
                })),
                country => country.name
            );
        });
        return this.countries;
    }

    // --- reads -------------------------------------------------------------------------------

    async getModules(): Promise<GlassModule[]> {
        const modules = await this.api
            .dataStore(glassDataStoreNamespace)
            .get<GlassModule[]>(Namespaces.DATA_SUBMISSSIONS_MODULES)
            .getData();
        return modules ?? [];
    }

    async getSnapshot(modules: string[]): Promise<EnrolmentSnapshot> {
        const [countries, programInfo, perModule] = await Promise.all([
            this.getCountries(),
            this.getProgramInfo(),
            Promise.all(modules.map(module => this.getEnrolments(module))),
        ]);

        return {
            countries: countries.map(country => _.omit(country, "path")),
            enrolments: _.flatten(perModule),
            assignedOrgUnitIds: programInfo.assignedOrgUnitIds,
            canEditProgram: programInfo.canEditProgram,
        };
    }

    /**
     * One paged query per module over the whole instance. The program holds a few hundred tracked
     * entities, so this is a handful of sub-second requests however many countries are on screen.
     */
    private async getEnrolments(module: string): Promise<Enrolment[]> {
        const code = MODULE_ENROLMENT_CODES[module];
        if (!code) return [];

        const { programId } = await this.getProgramInfo();
        const enrolments: Enrolment[] = [];

        for (let page = 1; ; page++) {
            const response = await this.api.tracker.trackedEntities
                .get({
                    program: programId,
                    ouMode: "ALL",
                    filter: `${ENROLMENT_MODULE_ATTRIBUTE_ID}:eq:${code}`,
                    fields: {
                        trackedEntity: true,
                        orgUnit: true,
                        enrollments: {
                            enrollment: true,
                            status: true,
                            enrolledAt: true,
                            occurredAt: true,
                            events: {
                                event: true,
                                occurredAt: true,
                                updatedAt: true,
                                dataValues: { dataElement: true, value: true },
                            },
                        },
                    },
                    page,
                    pageSize: PAGE_SIZE,
                })
                .getData();

            const instances = response.instances ?? [];

            instances.forEach(instance =>
                (instance.enrollments ?? []).forEach(enrollment => {
                    const events = (enrollment.events ?? []).map(event => ({
                        id: event.event,
                        details: toDetails(event),
                        updatedAt: event.updatedAt ?? "",
                    }));
                    const [withDetails, empty] = _.partition(events, event => hasDetails(event.details));

                    enrolments.push({
                        trackedEntityId: instance.trackedEntity,
                        enrollmentId: enrollment.enrollment,
                        countryId: instance.orgUnit,
                        module,
                        status: enrollment.status as EnrolmentStatus,
                        enrolledAt: (enrollment.enrolledAt ?? "").slice(0, 10),
                        occurredAt: (enrollment.occurredAt ?? "").slice(0, 10),
                        contacts: withDetails.map(
                            (event): Contact => ({
                                ...event.details,
                                id: event.id,
                                enrollmentId: enrollment.enrollment,
                                trackedEntityId: instance.trackedEntity,
                                updatedAt: event.updatedAt,
                            })
                        ),
                        placeholderIds: empty.map(event => event.id),
                    });
                })
            );

            if (instances.length < PAGE_SIZE) break;
        }

        return enrolments;
    }

    /**
     * How many users can use each module for each country, following GLASS's own rule: a user
     * needs one of the module's access groups and the country within their org units. They are
     * counted separately by whether they are assigned inside the country or above it (a region or
     * the whole world), because only the first says the country itself has someone working on it.
     */
    async getAccess(modules: GlassModule[]): Promise<AccessSummary> {
        const groupsOf = (module: GlassModule) =>
            new Set([...module.userGroups.readAccess, ...module.userGroups.captureAccess].map(group => group.id));

        const allGroupIds = _.uniq(_.flatMap(modules, module => [...groupsOf(module)]));
        if (_.isEmpty(allGroupIds)) return {};

        type D2User = {
            id: Id;
            userGroups: { id: Id }[];
            organisationUnits: { path: string }[];
            dataViewOrganisationUnits: { path: string }[];
        };

        const users: D2User[] = [];
        for (let page = 1; ; page++) {
            const response = await this.api
                .get<{ users: D2User[]; pager?: { pageCount: number } }>("/users", {
                    filter: `userGroups.id:in:[${allGroupIds.join(",")}]`,
                    fields: "id,userGroups[id],organisationUnits[path],dataViewOrganisationUnits[path]",
                    page,
                    pageSize: PAGE_SIZE,
                })
                .getData();

            users.push(...response.users);
            if (page >= (response.pager?.pageCount ?? 1)) break;
        }

        const countries = await this.getCountries();
        const countryLevel = (await this.getGeneralInfo()).countryLevel ?? 3;

        return _.fromPairs(
            modules.map(module => {
                const groups = groupsOf(module);
                const moduleUsers = users.filter(user => user.userGroups.some(group => groups.has(group.id)));

                const inCountry: Record<Id, Set<Id>> = {};
                const above: Record<Id, Set<Id>> = {};

                moduleUsers.forEach(user =>
                    [...user.organisationUnits, ...user.dataViewOrganisationUnits].forEach(({ path }) => {
                        const ancestry = path.split("/").filter(id => id);
                        const countryId = ancestry[countryLevel - 1];

                        if (countryId) {
                            (inCountry[countryId] ??= new Set()).add(user.id);
                        } else {
                            // Assigned above country level: covers every country beneath it.
                            countries
                                .filter(country => country.path.startsWith(path))
                                .forEach(country => (above[country.id] ??= new Set()).add(user.id));
                        }
                    })
                );

                return [
                    module.name,
                    _.fromPairs(
                        countries.map(country => [
                            country.id,
                            { inCountry: inCountry[country.id]?.size ?? 0, above: above[country.id]?.size ?? 0 },
                        ])
                    ),
                ];
            })
        );
    }

    async getGeometries(): Promise<CountryGeometry[]> {
        const countryLevel = (await this.getGeneralInfo()).countryLevel ?? 3;
        const response = await this.api
            .get<{ organisationUnits: Partial<CountryGeometry>[] }>("/organisationUnits", {
                filter: `level:eq:${countryLevel}`,
                fields: "id,geometry",
                paging: false,
            })
            .getData();

        return response.organisationUnits.filter(
            (orgUnit): orgUnit is CountryGeometry =>
                Boolean(orgUnit.id) &&
                (orgUnit.geometry?.type === "Polygon" || orgUnit.geometry?.type === "MultiPolygon")
        );
    }

    // --- writes ------------------------------------------------------------------------------

    /**
     * Applies a change set as up to five tracker imports: new tracked entities, enrolment status
     * updates, then contact creations, updates and deletions. A dry run sends the same imports in
     * VALIDATE mode, so the preview is DHIS2's verdict and nothing is persisted.
     */
    async apply(changes: ChangeSet, dryRun: boolean): Promise<WriteResult> {
        const program = await this.getProgramInfo();

        const [creations, statusUpdates] = _.partition(changes.statusChanges, change => change.from === "NONE");
        const contactsByKind = _.groupBy(changes.contactChanges, contactChangeKind);

        const results = [
            await this.post(
                "CREATE",
                "TRACKED_ENTITY",
                creations.map(change => toTrackedEntity(change, program)),
                chunk => ({ trackedEntities: chunk }),
                dryRun
            ),
            await this.post(
                "UPDATE",
                "ENROLLMENT",
                statusUpdates.map(change => toEnrollment(change, program)),
                chunk => ({ enrollments: chunk }),
                dryRun
            ),
            await this.post(
                "CREATE",
                "EVENT",
                (contactsByKind["create"] ?? []).map(change => toEvent(change, program)),
                chunk => ({ events: chunk }),
                dryRun
            ),
            await this.post(
                "UPDATE",
                "EVENT",
                (contactsByKind["update"] ?? []).map(change => toEvent(change, program)),
                chunk => ({ events: chunk }),
                dryRun
            ),
            await this.post(
                "DELETE",
                "EVENT",
                (contactsByKind["delete"] ?? []).map(change => ({ event: change.eventId })),
                chunk => ({ events: chunk }),
                dryRun
            ),
        ];

        return {
            affected: _.sumBy(results, result => result.affected),
            errors: _.uniq(_.flatMap(results, result => result.errors)),
        };
    }

    /**
     * Adds org units to the program one at a time through its collection item endpoint, which
     * touches nothing else on the program. A metadata import would have to send the whole program
     * to avoid replacing it.
     */
    async assignToProgram(countryIds: Id[]): Promise<WriteResult> {
        const { programId } = await this.getProgramInfo();
        const errors: string[] = [];
        let affected = 0;

        for (const countryId of countryIds) {
            try {
                await this.api.post(`/programs/${programId}/organisationUnits/${countryId}`).getData();
                affected++;
            } catch (error) {
                errors.push(`${countryId}: ${errorMessage(error)}`);
            }
        }

        this.programInfo = undefined; // the assigned set has changed
        return { affected, errors };
    }

    private async post<T>(
        importStrategy: "CREATE" | "UPDATE" | "DELETE",
        countedType: TrackerType,
        items: T[],
        toRequest: (chunk: T[]) => object,
        dryRun: boolean
    ): Promise<WriteResult> {
        let affected = 0;
        const errors: string[] = [];

        for (const chunk of _.chunk(items, CHUNK_SIZE)) {
            try {
                const response = await this.api.tracker
                    .post(
                        {
                            importStrategy,
                            importMode: dryRun ? "VALIDATE" : "COMMIT",
                            // One rejected row must not roll back the rest of its chunk.
                            atomicMode: "OBJECT",
                            skipRuleEngine: true,
                        },
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        toRequest(chunk) as any
                    )
                    .getData();

                const stats = response.bundleReport?.typeReportMap?.[countedType]?.stats;
                affected += dryRun
                    ? chunk.length - (response.validationReport?.errorReports?.length ?? 0)
                    : (stats?.created ?? 0) + (stats?.updated ?? 0) + (stats?.deleted ?? 0);
                errors.push(...(response.validationReport?.errorReports ?? []).map(report => report.message));
            } catch (error) {
                errors.push(errorMessage(error));
            }
        }

        return { affected, errors };
    }

    // --- history -----------------------------------------------------------------------------

    async getHistory(): Promise<HistoryRecord[]> {
        const records: HistoryRecord[] = [];

        for (let page = 1; ; page++) {
            let entries: { key: string; value: HistoryRecord }[];
            try {
                const response = await this.api
                    .get<{ entries: { key: string; value: HistoryRecord }[] }>(`/dataStore/${HISTORY_NAMESPACE}`, {
                        fields: ".",
                        page,
                        pageSize: PAGE_SIZE,
                    })
                    .getData();
                entries = response.entries ?? [];
            } catch (error) {
                // The namespace only exists once the first change has been recorded.
                if (isNotFound(error)) return [];
                throw error;
            }

            records.push(...entries.map(entry => entry.value));
            if (entries.length < PAGE_SIZE) break;
        }

        return records;
    }

    async saveHistory(record: HistoryRecord): Promise<void> {
        await this.api.dataStore(HISTORY_NAMESPACE).save(record.id, record).getData();
    }
}

function contactChangeKind(change: ContactChange): "create" | "update" | "delete" {
    if (!change.before) return "create";
    if (!change.after) return "delete";
    return "update";
}

function toTrackedEntity(change: StatusChange, program: ProgramInfo) {
    const attributes = [{ attribute: ENROLMENT_MODULE_ATTRIBUTE_ID, value: MODULE_ENROLMENT_CODES[change.module] }];

    return {
        trackedEntity: change.trackedEntityId,
        trackedEntityType: program.trackedEntityType,
        orgUnit: change.countryId,
        attributes,
        enrollments: [{ ...toEnrollment(change, program), attributes }],
    };
}

function toEnrollment(change: StatusChange, program: ProgramInfo) {
    return {
        enrollment: change.enrollmentId,
        trackedEntity: change.trackedEntityId,
        program: program.programId,
        orgUnit: change.countryId,
        enrolledAt: change.enrolledAt,
        occurredAt: change.occurredAt,
        status: change.to,
        events: [],
    };
}

function toEvent(change: ContactChange, program: ProgramInfo) {
    const details = change.after as ContactDetails;

    return {
        event: change.eventId,
        program: program.programId,
        programStage: program.programStageId,
        enrollment: change.enrollmentId,
        trackedEntity: change.trackedEntityId,
        orgUnit: change.countryId,
        occurredAt: details.startDate,
        status: "COMPLETED",
        dataValues: _.map(FOCAL_POINT_DATA_ELEMENTS, (dataElement, field) => ({
            dataElement,
            value: details[field as keyof ContactDetails] ?? "",
        })),
    };
}

type D2Event = { occurredAt?: string; dataValues?: { dataElement: Id; value?: string }[] };

function toDetails(event: D2Event): ContactDetails {
    const byDataElement = _.fromPairs((event.dataValues ?? []).map(dv => [dv.dataElement, dv.value ?? ""]));
    const fields = _.mapValues(FOCAL_POINT_DATA_ELEMENTS, dataElement => (byDataElement[dataElement] ?? "").trim());

    return { ...fields, startDate: (event.occurredAt ?? "").slice(0, 10) };
}

function errorMessage(error: unknown): string {
    const response = (error as { response?: { data?: { message?: string } } })?.response;
    return response?.data?.message ?? (error instanceof Error ? error.message : String(error));
}

function isNotFound(error: unknown): boolean {
    return (error as { response?: { status?: number } })?.response?.status === 404;
}
