import _ from "lodash";
import { paginate, PaginatedObjects } from "../../../domain/common/entities/PaginatedObjects";
import {
    ApprovalIds,
    GLASSDataSubmissionItem,
    GLASSDataSubmissionItemIdentifier,
    GLASSDataSubmissionModule,
    EARDataSubmissionItem,
    EARSubmissionItemIdentifier,
    getUserModules,
    Status,
    StatusChangedBy,
} from "../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import {
    EARDataSubmissionOptions,
    GLASSDataSubmissionOptions,
    GLASSDataSubmissionRepository,
} from "../../../domain/reports/glass-data-submission/repositories/GLASSDataSubmissionRepository";
import { D2Api, SelectedPick } from "../../../types/d2-api";
import { DataStoreStorageClient } from "../../common/clients/storage/DataStoreStorageClient";
import { StorageClient } from "../../common/clients/storage/StorageClient";
import { Instance } from "../../common/entities/Instance";
import { promiseMap } from "../../../utils/promises";
import { Id, NamedRef, Ref } from "../../../domain/common/entities/Base";
import {
    earStatusItems,
    statusItems,
} from "../../../webapp/reports/glass-data-submission/glass-data-submission-list/Filters";
import { Namespaces } from "../../common/clients/storage/Namespaces";
import { Config } from "../../../domain/common/entities/Config";
import { generateUid } from "../../../utils/uid";
import { OrgUnitWithChildren } from "../../../domain/reports/glass-data-submission/entities/OrgUnit";
import { D2TrackerEventSchema, TrackerEventsResponse } from "@eyeseetea/d2-api/api/trackerEvents";
import { AMR_GLASS_PROE_UPLOADS_PROGRAM_ID, getValueById, uploadsDHIS2Ids } from "../../common/entities/GlassUploads";
import {
    D2TrackedEntityInstanceToPost,
    D2TrackerTrackedEntitySchema,
    TrackedEntitiesGetResponse,
} from "@eyeseetea/d2-api/api/trackerTrackedEntities";
import { getUploadStatusSortKey } from "./getUploadStatusSortKey";

interface CompleteDataSetRegistrationsResponse {
    completeDataSetRegistrations: Registration[] | undefined;
}

interface Registration {
    period: string;
    dataSet: string;
    organisationUnit: string;
    attributeOptionCombo: string;
    date: string;
    storedBy: string;
    completed: boolean;
}

type UploadStatus = "UPLOADED" | "IMPORTED" | "VALIDATED" | "COMPLETED" | "DELETED";
type GLASSDataSubmissionItemUpload = { dataSubmissionId: Id; status: UploadStatus };

interface MessageConversations {
    messageConversations: {
        id: Id;
        displayName: string;
    }[];
}

type DataValueType = {
    dataElement: string;
    period: string;
    orgUnit: string;
    value: string;
    [key: string]: string;
};

type DataValueSetsType = {
    dataSet: string;
    period: string;
    orgUnit: string;
    completeDate?: string;
    dataValues: DataValueType[];
};

const DEFAULT_CHUNK_SIZE = 100;

export class GLASSDataSubmissionDefaultRepository implements GLASSDataSubmissionRepository {
    private storageClient: StorageClient;
    private globalStorageClient: StorageClient;

    constructor(private api: D2Api) {
        const instance = new Instance({ url: this.api.baseUrl });
        this.storageClient = new DataStoreStorageClient("user", instance);
        this.globalStorageClient = new DataStoreStorageClient("global", instance);
    }

    async get(
        options: GLASSDataSubmissionOptions,
        namespace: string
    ): Promise<PaginatedObjects<GLASSDataSubmissionItem>> {
        const { paging, sorting, module: selectedModuleId, periods } = options;
        if (!selectedModuleId) return emptyPage;

        const modules = await this.getModules();
        const dataSubmissionsDatastore = await this.getDataSubmissionObjects(namespace);

        const dataSubmissions = await this.getDataSubmissions(
            dataSubmissionsDatastore,
            modules,
            selectedModuleId,
            periods
        );
        const filteredRows = this.getFilteredRows(dataSubmissions, options);

        if (sorting?.field === "uploadStatuses") {
            const sortedRows = _.orderBy(
                filteredRows,
                [row => getUploadStatusSortKey(row.uploadStatuses ?? [])],
                [sorting.direction]
            );

            const { pager, objects: rowsInPage } = paginate(sortedRows, paging);
            return { pager, objects: rowsInPage };
        }

        const { pager, objects: rowsInPage } = paginate(filteredRows, paging, sorting);
        return {
            pager,
            objects: rowsInPage,
        };
    }

    private async getDataSubmissionObjects(namespace: string) {
        return (await this.globalStorageClient.getObject<GLASSDataSubmissionItem[]>(namespace)) ?? [];
    }

    private async getDataSubmissions(
        dataSubmissionsDatastore: GLASSDataSubmissionItem[],
        modules: GLASSDataSubmissionModule[],
        selectedModuleId: Id,
        periods: string[]
    ): Promise<GLASSDataSubmissionItem[]> {
        const enrolledCountries = await this.getEnrolledCountries();
        const amrFocalPointProgramId = await this.getAMRFocalPointProgramId();
        const dataSubmissionIdentifiers = await this.getDataSubmissionIdentifiers(
            amrFocalPointProgramId,
            enrolledCountries.join(";"),
            modules,
            periods
        );

        const moduleQuestionnaires =
            modules
                .find(module => module.id === selectedModuleId)
                ?.questionnaires.map(questionnaire => questionnaire.id) ?? [];

        const registrations = await this.getRegistrations(dataSubmissionIdentifiers, moduleQuestionnaires);

        const allDataSubmissionIds: Id[] = _(dataSubmissionsDatastore)
            .map(ds => ds.id)
            .compact()
            .uniq()
            .value();

        const uploads = await this.getUploadsBySubmissionIdsAndModuleChunked(allDataSubmissionIds, selectedModuleId);
        const uploadStatusesByDataSubmissionId = this.buildUploadStatusesByDataSubmissionId(uploads);

        const dataSubmissions: GLASSDataSubmissionItem[] = dataSubmissionIdentifiers.map(dataSubmissionIdentifier => {
            const dataSubmissionDatastore = dataSubmissionsDatastore.find(
                dataSubmissionObject =>
                    dataSubmissionObject.period === dataSubmissionIdentifier.period &&
                    dataSubmissionObject.orgUnit === dataSubmissionIdentifier.orgUnit &&
                    dataSubmissionObject.module === dataSubmissionIdentifier.module
            );

            const key = getRegistrationKey({
                orgUnitId: dataSubmissionIdentifier.orgUnit,
                period: dataSubmissionIdentifier.period,
            });
            const match = registrations[key];

            const submissionStatus =
                statusItems.find(item => item.value === dataSubmissionDatastore?.status)?.text ?? "Not completed";
            const dataSubmissionPeriod =
                modules.find(module => dataSubmissionIdentifier.module === module.id)?.dataSubmissionPeriod ?? "YEARLY";

            const uploadStatuses = dataSubmissionDatastore?.id
                ? uploadStatusesByDataSubmissionId.get(dataSubmissionDatastore?.id) ?? []
                : [];

            const dataSubmissionItem: GLASSDataSubmissionItem = {
                ...dataSubmissionIdentifier,
                ...match,
                ...dataSubmissionDatastore,
                submissionStatus,
                uploadStatuses: uploadStatuses,
                dataSubmissionPeriod,
                id: dataSubmissionDatastore?.id ?? generateUid(),
                period: dataSubmissionIdentifier.period.slice(0, 4),
                orgUnitName: match?.orgUnitName ?? "",
                questionnaireCompleted: match?.questionnaireCompleted ?? false,
                status: dataSubmissionDatastore?.status ?? "NOT_COMPLETED",
                statusHistory: dataSubmissionDatastore?.statusHistory ?? [],
                from: dataSubmissionDatastore?.from ?? null,
                to: dataSubmissionDatastore?.to ?? null,
                creationDate: dataSubmissionDatastore?.creationDate ?? new Date().toISOString(),
            };

            return dataSubmissionItem;
        });

        return dataSubmissions;
    }

    private buildUploadStatusesByDataSubmissionId(uploads: GLASSDataSubmissionItemUpload[]): Map<Id, UploadStatus[]> {
        const map = new Map<Id, UploadStatus[]>();
        for (const r of uploads) {
            const arr = map.get(r.dataSubmissionId) ?? [];
            arr.push(r.status);
            map.set(r.dataSubmissionId, arr);
        }
        return map;
    }

    private async getUploadsBySubmissionIdsAndModuleChunked(
        dataSubmissionIds: Id[],
        selectedModuleId: Id
    ): Promise<GLASSDataSubmissionItemUpload[]> {
        const uniqueIds = _(dataSubmissionIds).compact().uniq().value();
        if (uniqueIds.length === 0) return [];

        const chunks: Id[][] = _.chunk(uniqueIds, DEFAULT_CHUNK_SIZE);

        const uploads: GLASSDataSubmissionItemUpload[] = [];

        const moduleIdFilter = `${uploadsDHIS2Ids.moduleId}:eq:${selectedModuleId}`;

        for (const idsChunk of chunks) {
            const inValues = idsChunk.join(";");

            const dataSubmissionIdsFilter = `${uploadsDHIS2Ids.dataSubmissionId}:in:${inValues}`;

            const response = await this.api.tracker.events
                .get({
                    program: AMR_GLASS_PROE_UPLOADS_PROGRAM_ID,
                    skipPaging: true,
                    fields: uploadsEventFields,
                    filter: [moduleIdFilter, dataSubmissionIdsFilter].join(","),
                })
                .getData();

            const events: D2UploadTrackerEvent[] = response.instances ?? [];

            for (const event of events) {
                const dataSubmissionId = getValueById(event.dataValues, uploadsDHIS2Ids.dataSubmissionId) || "";
                const status = (getValueById(event.dataValues, uploadsDHIS2Ids.status) as UploadStatus) || "UPLOADED";

                if (!dataSubmissionId) continue;
                uploads.push({ dataSubmissionId, status });
            }
        }

        return uploads;
    }

    private async getEnrolledCountries(): Promise<string[]> {
        const userOrgUnits = await this.getUserOrgUnits();
        const orgUnitsWithChildren = await this.getOUsWithChildren(userOrgUnits);

        const countriesOutsideNARegion = await this.getCountriesOutsideNARegion();
        const enrolledCountries = orgUnitsWithChildren.filter(orgUnit => countriesOutsideNARegion.includes(orgUnit));

        return enrolledCountries;
    }

    private async getOUsWithChildren(userOrgUnits: string[]): Promise<string[]> {
        const { organisationUnits } = await this.api.metadata
            .get({
                organisationUnits: {
                    fields: {
                        id: true,
                        level: true,
                        children: {
                            id: true,
                            level: true,
                            children: {
                                id: true,
                                level: true,
                            },
                        },
                    },
                    filter: {
                        level: {
                            eq: "1",
                        },
                    },
                },
            })
            .getData();

        const orgUnitsWithChildren = _(userOrgUnits)
            .flatMap(ou => {
                const res = flattenNodes(flattenNodes(organisationUnits).filter(res => res.id === ou)).map(
                    node => node.id
                );
                return res;
            })
            .uniq()
            .value();

        return orgUnitsWithChildren;
    }

    private async getUserOrgUnits(): Promise<string[]> {
        return (await this.api.get<{ organisationUnits: Ref[] }>("/me").getData()).organisationUnits.map(ou => ou.id);
    }

    private async getDataSubmissionIdentifiers(
        program: string,
        orgUnit: string,
        modules: GLASSDataSubmissionModule[],
        dataSubmissionPeriods: string[]
    ): Promise<GLASSDataSubmissionItemIdentifier[]> {
        const instances = await this.getAllTrackedEntities(program, orgUnit);

        const orgUnitModules: { orgUnit: string; module: string }[] = _(instances)
            .map(instance => {
                const module = instance.attributes.map(attribute => attribute.value)[0] ?? "";

                return {
                    orgUnit: instance.orgUnit,
                    module: moduleMapping[module] ?? "",
                };
            })
            .uniqBy(instance => `${instance.orgUnit}_${instance.module}`)
            .value();

        return orgUnitModules.flatMap(orgUnitModule => {
            return dataSubmissionPeriods.map(dataSubmissionPeriod => ({
                ...orgUnitModule,
                period: dataSubmissionPeriod,
                module: modules.find(module => module.name === orgUnitModule.module)?.id ?? "",
            }));
        });
    }

    private async getCountriesOutsideNARegion(): Promise<string[]> {
        const { organisationUnits: kosovoOu } = await this.api.metadata
            .get({
                organisationUnits: {
                    fields: {
                        id: true,
                    },
                    filter: {
                        name: {
                            eq: "Kosovo",
                        },
                        level: {
                            eq: "3",
                        },
                        "parent.code": {
                            eq: "NA",
                        },
                    },
                },
            })
            .getData();

        const { organisationUnits } = await this.api.metadata
            .get({
                organisationUnits: {
                    fields: {
                        id: true,
                    },
                    filter: {
                        level: {
                            eq: "3",
                        },
                        "parent.code": {
                            ne: "NA",
                        },
                    },
                    paging: false,
                },
            })
            .getData();

        return _.concat(organisationUnits, kosovoOu).map(orgUnit => orgUnit.id);
    }

    private async getAMRFocalPointProgramId(): Promise<string> {
        const { programs } = await this.api.metadata
            .get({
                programs: {
                    fields: {
                        id: true,
                    },
                    filter: {
                        name: {
                            eq: "AMR - Focal Point",
                        },
                    },
                },
            })
            .getData();

        const programId = _.first(programs)?.id ?? "";

        return programId;
    }

    async getUserModules(config: Config): Promise<GLASSDataSubmissionModule[]> {
        const modules = await this.getModules();

        return getUserModules(modules, config.currentUser);
    }

    async getEAR(
        options: EARDataSubmissionOptions,
        namespace: string
    ): Promise<PaginatedObjects<EARDataSubmissionItem>> {
        const { paging, sorting, orgUnitIds, from, to, submissionStatus } = options;

        const userOrgUnits = (await this.api.get<{ organisationUnits: Ref[] }>("/me").getData()).organisationUnits.map(
            ou => ou.id
        );
        const { organisationUnits } = await this.api
            .get<any>(
                "/metadata?organisationUnits:fields=children[children[id,level],id,level],id,level&organisationUnits:filter=level:eq:1"
            )
            .getData();
        const orgUnitsWithChildren = _(userOrgUnits)
            .flatMap(ou => {
                const res = flattenNodes(flattenNodes(organisationUnits).filter(res => res.id === ou)).map(
                    node => node.id
                );
                return res;
            })
            .uniq()
            .value();

        const objects = (await this.globalStorageClient.getObject<EARDataSubmissionItem[]>(namespace)) ?? [];

        const rows = objects.filter(object => orgUnitsWithChildren.includes(object.orgUnit.id));

        const filteredRows = rows
            .filter(row => {
                return (
                    (_.isEmpty(orgUnitIds) || !row.orgUnit ? row : orgUnitIds.includes(row.orgUnit.id)) &&
                    !!(!from && !to
                        ? row
                        : (from && new Date(row.creationDate) >= from) || (to && new Date(row.creationDate) <= to)) &&
                    (!submissionStatus ? row : row.status === submissionStatus)
                );
            })
            .map(row => {
                const submissionStatus = earStatusItems.find(item => item.value === row.status)?.text ?? "";
                return { ...row, submissionStatus };
            });

        return paginate(filteredRows, paging, sorting);
    }

    private async getRegistrations(
        items: GLASSDataSubmissionItemIdentifier[],
        moduleQuestionnaires: Id[]
    ): Promise<Record<RegistrationKey, RegistrationItemBase>> {
        const orgUnitIds = _.uniq(items.map(obj => obj.orgUnit));
        const periods = _.uniq(items.map(obj => obj.period));
        const orgUnitsById = await this.getOrgUnits(orgUnitIds);
        const apiRegistrations = !_(moduleQuestionnaires).compact().isEmpty()
            ? await this.getApiRegistrations({
                  orgUnitIds,
                  periods,
                  moduleQuestionnaires,
              })
            : [];

        const registrationsByOrgUnitPeriod = _.keyBy(apiRegistrations, apiReg =>
            getRegistrationKey({ orgUnitId: apiReg.organisationUnit, period: apiReg.period })
        );

        return _(items)
            .map((item): RegistrationItemBase => {
                const key = getRegistrationKey({ orgUnitId: item.orgUnit, period: item.period });
                const registration = registrationsByOrgUnitPeriod[key];
                const orgUnitName = orgUnitsById[item.orgUnit]?.name || "-";

                return {
                    orgUnit: item.orgUnit,
                    period: item.period,
                    orgUnitName: orgUnitName,
                    questionnaireCompleted: registration?.completed ?? false,
                };
            })
            .keyBy(item => getRegistrationKey({ orgUnitId: item.orgUnit, period: item.period }))
            .value();
    }

    private async getApiRegistrations(options: {
        orgUnitIds: Id[];
        periods: string[];
        moduleQuestionnaires: Id[];
    }): Promise<Registration[]> {
        const responses = options.moduleQuestionnaires.flatMap(dataSet =>
            _.chunk(options.orgUnitIds, 300).map(orgUnitIdsGroups =>
                this.api.get<CompleteDataSetRegistrationsResponse>("/completeDataSetRegistrations", {
                    dataSet: dataSet,
                    orgUnit: orgUnitIdsGroups,
                    period: options.periods,
                })
            )
        );

        return _(await promiseMap(responses, response => response.getData()))
            .flatMap(r => r.completeDataSetRegistrations || [])
            .value();
    }

    private async getOrgUnits(orgUnitIds: Id[]): Promise<Record<Id, NamedRef>> {
        const responses = _.chunk(orgUnitIds, 300).map(orgUnitIdsGroup =>
            this.api.metadata.get({
                organisationUnits: {
                    fields: { id: true, displayName: true },
                    filter: { id: { in: orgUnitIdsGroup } },
                },
            })
        );

        const metadataList = await promiseMap(responses, response => response.getData());

        return _(metadataList)
            .flatMap(metadata =>
                metadata.organisationUnits.map(orgUnit => ({
                    id: orgUnit.id,
                    name: orgUnit.displayName,
                }))
            )
            .keyBy(orgUnit => orgUnit.id)
            .value();
    }

    async getColumns(namespace: string): Promise<string[]> {
        const columns = await this.storageClient.getObject<string[]>(namespace);

        return columns ?? [];
    }

    async saveColumns(namespace: string, columns: string[]): Promise<void> {
        return this.storageClient.saveObject<string[]>(namespace, columns);
    }

    async dhis2MessageCount(): Promise<number> {
        const { messageConversations } =
            (await this.api
                .get<MessageConversations>("/messageConversations.json?filter=read%3Aeq%3Afalse")
                .getData()) ?? [];

        return messageConversations.length;
    }

    private async getModules(): Promise<GLASSDataSubmissionModule[]> {
        const modules =
            (await this.globalStorageClient.getObject<GLASSDataSubmissionModule[]>(
                Namespaces.DATA_SUBMISSSIONS_MODULES
            )) ?? [];

        return _(modules)
            .map(module => ({
                ...module,
                userGroups: { ...module.userGroups, approveAccess: module.userGroups.approveAccess ?? [] },
            }))
            .value();
    }

    private getFilteredRows(
        rows: GLASSDataSubmissionItem[],
        options: GLASSDataSubmissionOptions
    ): GLASSDataSubmissionItem[] {
        const { orgUnitIds, module, dataSubmissionPeriod, periods, quarters, completionStatus, submissionStatus } =
            options;
        const quarterPeriods = _.flatMap(periods, year => quarters.map(quarter => `${year}${quarter}`));

        return rows.filter(row => {
            const isInOrgUnit = !!(_.isEmpty(orgUnitIds) || !row.orgUnit ? row : orgUnitIds.includes(row.orgUnit));
            const isInModule = row.module === module;

            const isDataSubmissionYearly = dataSubmissionPeriod === "YEARLY";
            const isInPeriod = isDataSubmissionYearly
                ? periods.includes(row.period)
                : quarterPeriods.includes(row.period);

            const isCompleted = !!(completionStatus !== undefined
                ? row.questionnaireCompleted === completionStatus
                : row);
            const isSubmitted = !!(!submissionStatus ? row : row.status === submissionStatus);

            return isInOrgUnit && isInModule && isInPeriod && isCompleted && isSubmitted;
        });
    }

    private async getNotificationText(
        items: GLASSDataSubmissionItemIdentifier[],
        modules: GLASSDataSubmissionModule[],
        status: string
    ) {
        const glassModule = modules.find(module => module.id === items[0]?.module)?.name;
        const orgUnitIds = _(items)
            .map(({ orgUnit }) => orgUnit)
            .compact()
            .uniq()
            .value();
        const orgUnitsById = await this.getOrgUnits(orgUnitIds);
        const itemsWithCountry = items.map(item => {
            const country = item.orgUnit ? orgUnitsById[item.orgUnit]?.name || "-" : undefined;
            return { period: item.period, country };
        });
        const multipleItems = items.length > 1;

        const text = `The data ${
            multipleItems ? "submissions" : "submission"
        } for ${glassModule} module for${itemsWithCountry.map(
            item => ` year ${item.period} and country ${item.country}`
        )} ${multipleItems ? "have" : "has"} changed to ${status.toUpperCase()}.`;

        return text;
    }

    private getEARNotificationText(
        signals: EARSubmissionItemIdentifier[],
        modules: GLASSDataSubmissionModule[],
        status: string
    ) {
        const earModule = modules.find(module => module.id === signals[0]?.module)?.name;

        const text = signals
            .map(
                signal =>
                    `${
                        signal.levelOfConfidentiality === "CONFIDENTIAL" ? "Confidential" : "Non-Confidential"
                    } Signal for ${earModule} module and country ${
                        signal.orgUnitName
                    } ${status} at ${new Date().toISOString()}`
            )
            .join("\n");

        return text;
    }

    private async getRecipientUsers(items: GLASSDataSubmissionItemIdentifier[], modules: GLASSDataSubmissionModule[]) {
        const userGroups = _.flatMap(
            _.compact(
                items.map(
                    item =>
                        modules.find(mod => mod.id === item.module && !_.isEmpty(mod.userGroups))?.userGroups
                            .captureAccess
                )
            )
        ).map(({ id }) => id);

        const orgUnits = _(
            await promiseMap(
                items,
                async item =>
                    await this.api.get<any>(`/organisationUnits/${item.orgUnit}?fields=ancestors,id`).getData()
            )
        )
            .flatMapDeep(obj => [obj.id, _.map(obj.ancestors, "id")])
            .flatten()
            .value();

        const { objects: recipientUsers } = await this.api.models.users
            .get({
                fields: {
                    id: true,
                },
                filter: {
                    "organisationUnits.id": { in: orgUnits },
                    "userGroups.id": { in: userGroups },
                },
            })
            .getData();

        return recipientUsers;
    }

    private async getEARRecipientUsers(items: EARSubmissionItemIdentifier[], modules: GLASSDataSubmissionModule[]) {
        const userGroups = _.flatMap(
            _.compact(
                items.map(
                    item =>
                        modules.find(mod => mod.id === item.module && !_.isEmpty(mod.userGroups))?.userGroups.readAccess
                )
            )
        ).map(({ id }) => id);

        const orgUnits = _(
            await promiseMap(
                items,
                async item =>
                    await this.api.get<any>(`/organisationUnits/${item.orgUnitId}?fields=ancestors,id`).getData()
            )
        )
            .flatMapDeep(obj => [obj.id, _.map(obj.ancestors, "id")])
            .flatten()
            .value();

        const { objects: recipientUsers } = await this.api.models.users
            .get({
                fields: {
                    id: true,
                },
                filter: {
                    "organisationUnits.id": { in: orgUnits },
                    "userGroups.id": { in: userGroups },
                },
            })
            .getData();

        return recipientUsers;
    }

    private async getDataSetsValue(dataSet: string, orgUnit: string, period: string) {
        return await this.api
            .get<DataValueSetsType>("/dataValueSets", {
                dataSet,
                orgUnit,
                period,
            })
            .getData();
    }

    private async getDSDataElements(dataSet: string) {
        return await this.api
            .get<any>(`/dataSets/${dataSet}`, { fields: "dataSetElements[dataElement[id,name]]" })
            .getData();
    }

    private async getTrackerProgramEvents(
        program: string,
        orgUnit: string,
        isEGASPModule: boolean
    ): Promise<D2TrackerEvent[]> {
        const response: TrackerEventsResponse<typeof eventFields> = await this.api.tracker.events
            .get({
                fields: eventFields,
                program: program,
                orgUnit: orgUnit,
                ouMode: isEGASPModule ? "DESCENDANTS" : "SELECTED",
                skipPaging: true,
            })
            .getData();

        return response.instances;
    }

    private async createTrackerProgramEventsByChunks(eventsToPost: D2TrackerEvent[]): Promise<void> {
        await promiseMap(_.chunk(eventsToPost, 100), async eventsGroup => {
            return await this.api.tracker
                .post({ importStrategy: "CREATE" }, { events: _.reject(eventsGroup, _.isEmpty) })
                .getData();
        });
    }

    private async importTrackedEntitiesByStrategy(
        trackedEntities: D2TrackedEntityInstanceToPost[],
        importStrategy: "CREATE" | "UPDATE" | "CREATE_AND_UPDATE" | "DELETE",
        async?: boolean
    ): Promise<void> {
        if (async) {
            await this.api.tracker
                .postAsync({ importStrategy: importStrategy }, { trackedEntities: trackedEntities })
                .getData();
        } else {
            await this.api.tracker
                .post({ importStrategy: importStrategy }, { trackedEntities: trackedEntities })
                .getData();
        }
    }

    private async importEventsByStrategy(
        events: D2TrackerEvent[],
        importStrategy: "CREATE" | "UPDATE" | "CREATE_AND_UPDATE" | "DELETE",
        async?: boolean
    ): Promise<void> {
        if (async) {
            await this.api.tracker.postAsync({ importStrategy: importStrategy }, { events: events }).getData();
        } else {
            await this.api.tracker.post({ importStrategy: importStrategy }, { events: events }).getData();
        }
    }

    private getTEIsWithProgramStages(
        trackedEntityInstances: D2TrackerEntity[],
        programStages: string[]
    ): D2TrackerEntity[] {
        return trackedEntityInstances.filter(trackedEntity => {
            const teiProgramStage = trackedEntity.enrollments[0]?.events[0]?.programStage ?? "";

            return programStages.includes(teiProgramStage);
        });
    }

    private getTrackedEntitiesOfPage(params: {
        orgUnit: Id;
        page: number;
        pageSize: number;
        program: Id;
        period?: string;
        trackedEntity?: string;
        totalPages?: boolean;
        enrollmentEnrolledAfter?: string;
        enrollmentEnrolledBefore?: string;
    }): Promise<TrackedEntitiesGetResponse<typeof trackedEntitiesFields>> {
        const { program, orgUnit, enrollmentEnrolledAfter, enrollmentEnrolledBefore, ...restParams } = params;

        return this.api.tracker.trackedEntities
            .get({
                fields: trackedEntitiesFields,
                program: program,
                orgUnit: orgUnit,
                enrollmentOccurredAfter: enrollmentEnrolledAfter,
                enrollmentOccurredBefore: enrollmentEnrolledBefore,
                ouMode: "SELECTED",
                ...restParams,
            })
            .getData();
    }

    private async getAllTrackedEntities(program: string, orgUnit: string, period?: string): Promise<D2TrackerEntity[]> {
        const trackedEntities: D2TrackerEntity[] = [];
        const enrollmentEnrolledAfter = period ? `${period}-1-1` : undefined;
        const enrollmentEnrolledBefore = period ? `${period}-12-31` : undefined;
        const totalPages = true;
        const pageSize = 200;
        let currentPage = 1;
        let response;

        try {
            do {
                response = await this.getTrackedEntitiesOfPage({
                    program: program,
                    orgUnit: orgUnit,
                    page: currentPage,
                    pageSize: pageSize,
                    totalPages: totalPages,
                    enrollmentEnrolledBefore,
                    enrollmentEnrolledAfter,
                });
                if (!response.total) {
                    throw new Error(`Error getting paginated events of program ${program} and organisation ${orgUnit}`);
                }
                trackedEntities.push(...response.instances);
                currentPage++;
            } while (response.page < Math.ceil((response.total as number) / pageSize));
            return trackedEntities;
        } catch {
            return [];
        }
    }

    private makeDataValuesArray(
        approvalDataSetId: string,
        dataValueSets: DataValueType[],
        dataElementsMatchedArray: { [key: string]: any }[]
    ) {
        return dataValueSets.flatMap(dataValueSet => {
            const dataValue = { ...dataValueSet };
            const destId = dataElementsMatchedArray.find(
                dataElementsMatchedObj => dataElementsMatchedObj.origId === dataValueSet.dataElement
            )?.destId;

            if (!_.isEmpty(destId) && !_.isEmpty(dataValue.value)) {
                dataValue.dataElement = destId;
                dataValue.dataSet = approvalDataSetId;
                delete dataValue.lastUpdated;
                delete dataValue.comment;

                return dataValue;
            } else {
                return [];
            }
        });
    }

    async approve(
        namespace: string,
        items: GLASSDataSubmissionItemIdentifier[],
        signals?: EARSubmissionItemIdentifier[]
    ) {
        const modules = await this.getModules();

        if (!_.isEmpty(items)) {
            const objects = await this.globalStorageClient.listObjectsInCollection<GLASSDataSubmissionItem>(namespace);

            await this.approveByModule(modules, items);
            const newSubmissionValues = await this.getNewSubmissionValues(items, objects, "APPROVED");
            const recipients = await this.getRecipientUsers(items, modules);

            const message = await this.getNotificationText(items, modules, "approved");
            this.sendNotifications(message, message, [], recipients);

            return await this.globalStorageClient.saveObject<GLASSDataSubmissionItem[]>(namespace, newSubmissionValues);
        } else if (signals) {
            const objects = await this.globalStorageClient.listObjectsInCollection<EARDataSubmissionItem>(namespace);
            const newSubmissionValues = await this.getNewEARSubmissionValues(signals, objects, "APPROVED");
            const recipients = await this.getEARRecipientUsers(signals, modules);

            const message = this.getEARNotificationText(signals, modules, "approved");
            this.sendNotifications(message, message, [], recipients);

            return await this.globalStorageClient.saveObject<EARDataSubmissionItem[]>(namespace, newSubmissionValues);
        }
    }

    private async approveByModule(
        modules: GLASSDataSubmissionModule[],
        items: GLASSDataSubmissionItemIdentifier[]
    ): Promise<void> {
        const selectedModule = modules.find(module => module.id === _.first(items)?.module)?.name ?? "";
        const { AMC, AMR, AMR_FUNGHI, AMR_INDIVIDUAL, EGASP } = moduleMapping;

        switch (selectedModule) {
            case AMC: {
                const amcModule = modules.find(module => module.name === AMC);
                const amcPrograms = amcModule?.programs ?? [];
                const amcProgramStages = amcModule?.programStages ?? [];
                const amcProductRegisterProgramId = await this.getAMCProductRegisterId(); // the AMC - Product Register program is tne only tracker program in this module

                const amcEventPrograms = _.filter(
                    amcPrograms,
                    amcProgram => amcProgram.id !== amcProductRegisterProgramId
                );
                const amcTrackerPrograms = _.filter(
                    amcPrograms,
                    amcProgram => amcProgram.id === amcProductRegisterProgramId
                );

                _.forEach(amcEventPrograms, async amcProgram => await this.duplicateEventProgram(amcProgram, items));
                _.forEach(
                    amcTrackerPrograms,
                    async amcProgram => await this.duplicateTrackerProgram(amcProgram, amcProgramStages, items)
                );
                break;
            }
            case AMR: {
                const amrDataSets = modules.find(module => module.name === AMR)?.dataSets ?? [];
                const amrQuestionnaires = modules.find(module => module.name === AMR)?.questionnaires ?? [];

                _.forEach(amrDataSets, async amrDataSet => await this.duplicateDataSet(amrDataSet, items));
                _.forEach(
                    amrQuestionnaires,
                    async amrQuestionnaire => await this.duplicateDataSet(amrQuestionnaire, items)
                );
                break;
            }
            case AMR_FUNGHI: {
                const amrFungalModule = modules.find(module => module.name === AMR_FUNGHI);
                const amrFungalQuestionnaires = amrFungalModule?.questionnaires ?? [];
                const amrFungalPrograms = amrFungalModule?.programs ?? [];
                const amrFungalProgramStages = amrFungalModule?.programStages ?? [];

                _.forEach(
                    amrFungalQuestionnaires,
                    async amrFungalQuestionnaire => await this.duplicateDataSet(amrFungalQuestionnaire, items)
                );
                _.forEach(
                    amrFungalPrograms,
                    async amrFungalProgram =>
                        await this.duplicateTrackerProgram(amrFungalProgram, amrFungalProgramStages, items)
                );
                break;
            }
            case AMR_INDIVIDUAL: {
                const amrIndividualModule = modules.find(module => module.name === AMR_INDIVIDUAL);
                const amrIndividualQuestionnaires = amrIndividualModule?.questionnaires ?? [];
                const amrIndividualPrograms = amrIndividualModule?.programs ?? [];
                const amrIndividualProgramStages = amrIndividualModule?.programStages ?? [];

                _.forEach(amrIndividualQuestionnaires, async amrIndividualQuestionnaire => {
                    await this.duplicateDataSet(amrIndividualQuestionnaire, items);
                });
                _.forEach(amrIndividualPrograms, async amrIndividualProgram => {
                    await this.duplicateTrackerProgram(amrIndividualProgram, amrIndividualProgramStages, items);
                });
                break;
            }
            case EGASP: {
                const egaspPrograms = modules.find(module => module.name === EGASP)?.programs ?? [];
                _.forEach(
                    egaspPrograms,
                    async egaspProgram =>
                        await this.duplicateEventProgram(egaspProgram, items, selectedModule === EGASP)
                );
                break;
            }
        }
    }

    private async getAMCProductRegisterId() {
        const { objects } = await this.api.models.programs
            .get({
                fields: { id: true },
                filter: { code: { eq: AMC_PRODUCT_REGISTER_CODE } },
            })
            .getData();

        return _.first(objects)?.id ?? "";
    }

    private async duplicateDataSet(dataSet: ApprovalIds, items: GLASSDataSubmissionItemIdentifier[]) {
        _.forEach(items, async item => {
            const dataValueSets = (await this.getDataSetsValue(dataSet.id, item.orgUnit, item.period)).dataValues;

            if (!_.isEmpty(dataValueSets)) {
                const DSDataElements: { dataSetElements: { dataElement: NamedRef }[] } = await this.getDSDataElements(
                    dataSet.id
                );
                const ADSDataElements: { dataSetElements: { dataElement: NamedRef }[] } = await this.getDSDataElements(
                    dataSet.approvedId
                );

                const uniqueDataElementsIds = _.uniq(_.map(dataValueSets, "dataElement"));
                const dataElementsMatchedArray = DSDataElements.dataSetElements.map(element => {
                    const dataElement = element.dataElement;
                    if (uniqueDataElementsIds.includes(dataElement.id)) {
                        const apvdName = dataElement.name + "-APVD";
                        const ADSDataElement = ADSDataElements.dataSetElements.find(
                            element => element.dataElement.name === apvdName
                        );
                        return {
                            origId: dataElement.id,
                            destId: ADSDataElement?.dataElement.id,
                            name: dataElement.name,
                        };
                    } else {
                        return [];
                    }
                });

                const dataValuesToPost = this.makeDataValuesArray(
                    dataSet.approvedId,
                    dataValueSets,
                    dataElementsMatchedArray
                );

                await promiseMap(_.chunk(dataValuesToPost, 1000), async dataValuesGroup => {
                    return await this.api.dataValues
                        .postSet({}, { dataValues: _.reject(dataValuesGroup, _.isEmpty) })
                        .getData();
                });
            }
        });
    }

    private async duplicateTrackerProgram(
        program: ApprovalIds,
        programStages: ApprovalIds[],
        items: GLASSDataSubmissionItemIdentifier[]
    ): Promise<void> {
        _.forEach(items, async item => {
            const allTrackedEntities: D2TrackerEntity[] = await this.getAllTrackedEntities(
                program.id,
                item.orgUnit,
                item.period
            );
            const trackedEntities = this.getTEIsWithProgramStages(
                allTrackedEntities,
                programStages.map(programStage => programStage.id)
            );

            if (!_.isEmpty(trackedEntities)) {
                const allTrackedEntitiesInApprovedId: D2TrackerEntity[] = await this.getAllTrackedEntities(
                    program.approvedId,
                    item.orgUnit,
                    item.period
                );
                const approvedTrackedEntities = this.getTEIsWithProgramStages(
                    allTrackedEntitiesInApprovedId,
                    programStages.map(programStage => programStage.approvedId)
                );

                if (!_.isEmpty(approvedTrackedEntities)) {
                    await this.importTrackedEntitiesByStrategy(approvedTrackedEntities, "DELETE");
                }

                const trackedEntitiesToPost: D2TrackerEntity[] = trackedEntities.map(trackedEntity => ({
                    ...trackedEntity,
                    trackedEntity: "",
                    programOwners: trackedEntity.programOwners.map(programOwner => ({
                        ...programOwner,
                        program: program.approvedId,
                    })),
                    enrollments: trackedEntity.enrollments.map(enrollment => ({
                        ...enrollment,
                        enrollment: "",
                        trackedEntity: "",
                        program: program.approvedId,
                        events: enrollment.events.map(event => {
                            const approvedProgramStage =
                                programStages.find(programStage => event.programStage === programStage.id)
                                    ?.approvedId ?? "";

                            return {
                                ...event,
                                event: "",
                                trackedEntity: "",
                                program: program.approvedId,
                                programStage: approvedProgramStage,
                            };
                        }),
                    })),
                }));

                await this.importTrackedEntitiesByStrategy(trackedEntitiesToPost, "CREATE_AND_UPDATE", true);
            }
        });
    }

    private async getProgramStages(program: string): Promise<NamedRef[]> {
        const { programs } = await this.api.metadata
            .get({
                programs: {
                    fields: {
                        programStages: {
                            id: true,
                            name: true,
                        },
                    },
                    filter: {
                        id: { eq: program },
                    },
                    paging: false,
                },
            })
            .getData();

        return _.first(programs)?.programStages ?? [];
    }

    private async duplicateEventProgram(
        program: ApprovalIds,
        items: GLASSDataSubmissionItemIdentifier[],
        isEGASPModule?: boolean
    ): Promise<void> {
        _.forEach(items, async item => {
            const programEvents = await this.getTrackerProgramEvents(program.id, item.orgUnit, isEGASPModule ?? false);
            const events = programEvents.filter(
                event => String(new Date(event.occurredAt).getFullYear()) === item.period
            );

            if (!_.isEmpty(events)) {
                const approvedProgramEvents = await this.getTrackerProgramEvents(
                    program.approvedId,
                    item.orgUnit,
                    isEGASPModule ?? false
                );
                const approvedEvents = approvedProgramEvents.filter(
                    event => String(new Date(event.occurredAt).getFullYear()) === item.period
                );

                if (!_.isEmpty(approvedEvents)) {
                    await this.importEventsByStrategy(approvedEvents, "DELETE");
                }

                const approvedProgramStage = (await this.getProgramStages(program.approvedId))[0];
                const eventsToPost = events.map(event => {
                    return {
                        ...event,
                        event: "",
                        program: program.approvedId,
                        programStage: approvedProgramStage?.id ?? "",
                    };
                });

                await this.createTrackerProgramEventsByChunks(eventsToPost);
            }
        });
    }

    async reject(
        namespace: string,
        items: GLASSDataSubmissionItemIdentifier[],
        message: string,
        isDatasetUpdate: boolean,
        signals?: EARSubmissionItemIdentifier[]
    ) {
        const modules = await this.getModules();

        if (!_.isEmpty(items)) {
            const objects = await this.globalStorageClient.listObjectsInCollection<GLASSDataSubmissionItem>(namespace);
            const newSubmissionValues = await this.getNewSubmissionValues(
                items,
                objects,
                isDatasetUpdate ? "APPROVED" : "REJECTED"
            );
            const recipients = await this.getRecipientUsers(items, modules);

            const body = `Please review the messages and the reports to find about the causes of this rejection. You have to upload new datasets.\n Reason for rejection:\n ${message}`;

            this.sendNotifications("Rejected by WHO", body, [], recipients);

            await this.postDataSetRegistration(items, modules, false);

            return await this.globalStorageClient.saveObject<GLASSDataSubmissionItem[]>(namespace, newSubmissionValues);
        } else if (signals) {
            const objects = await this.globalStorageClient.listObjectsInCollection<EARDataSubmissionItem>(namespace);
            const newSubmissionValues = await this.getNewEARSubmissionValues(signals, objects, "REJECTED");
            const recipients = await this.getEARRecipientUsers(signals, modules);

            const notificationText = this.getEARNotificationText(signals, modules, "rejected");
            const body = `${notificationText} with the following message:\n${message}`;

            this.sendNotifications(notificationText, body, [], recipients);

            return await this.globalStorageClient.saveObject<EARDataSubmissionItem[]>(namespace, newSubmissionValues);
        }
    }

    async reopen(namespace: string, items: GLASSDataSubmissionItemIdentifier[]) {
        const objects = await this.globalStorageClient.listObjectsInCollection<GLASSDataSubmissionItem>(namespace);
        const modules = await this.getModules();

        const newSubmissionValues = await this.getNewSubmissionValues(items, objects, "NOT_COMPLETED");
        const recipients = await this.getRecipientUsers(items, modules);

        const message = await this.getNotificationText(items, modules, "reopened");

        this.sendNotifications(message, message, [], recipients);

        await this.postDataSetRegistration(items, modules, false);

        return await this.globalStorageClient.saveObject<GLASSDataSubmissionItem[]>(namespace, newSubmissionValues);
    }

    async accept(namespace: string, items: GLASSDataSubmissionItemIdentifier[]) {
        const objects = await this.globalStorageClient.listObjectsInCollection<GLASSDataSubmissionItem>(namespace);
        const modules = await this.getModules();

        const newSubmissionValues = await this.getNewSubmissionValues(items, objects, "UPDATE_REQUEST_ACCEPTED");
        const recipients = await this.getRecipientUsers(items, modules);

        const message = await this.getNotificationText(items, modules, "update request accepted");
        this.sendNotifications(message, message, [], recipients);

        await this.postDataSetRegistration(items, modules, false);

        return await this.globalStorageClient.saveObject<GLASSDataSubmissionItem[]>(namespace, newSubmissionValues);
    }

    async getGLASSDashboardId(): Promise<string> {
        const modules = await this.getModules();
        const glassUnapvdDashboardId = modules.find(module => module.name === "AMR")?.dashboards.validationReport ?? "";

        return glassUnapvdDashboardId;
    }

    async getOrganisationUnitsWithChildren(): Promise<OrgUnitWithChildren[]> {
        const { organisationUnits } = await this.api.metadata
            .get({
                organisationUnits: {
                    fields: {
                        id: true,
                        name: true,
                        level: true,
                        path: true,
                        children: {
                            id: true,
                            name: true,
                            level: true,
                            path: true,
                            children: { id: true, name: true, level: true, path: true },
                        },
                    },
                    filter: { level: { eq: "1" } },
                },
            })
            .getData();

        const regionalLevelOUs = organisationUnits.flatMap(ou => ou.children);
        const countryLevelOUs = regionalLevelOUs.flatMap(ou => ou.children);
        const allOrgUnits = _.union(organisationUnits, regionalLevelOUs, countryLevelOUs);

        return _.orderBy(allOrgUnits, "level", "asc");
    }

    private async postDataSetRegistration(
        items: GLASSDataSubmissionItemIdentifier[],
        modules: GLASSDataSubmissionModule[],
        completed: boolean
    ) {
        const selectedModule = items[0]?.module;
        const moduleQuestionnaires =
            modules
                .find(module => module.id === selectedModule)
                ?.questionnaires.map(questionnaire => questionnaire.id) ?? [];

        const dataSetRegistrations = items.flatMap(item =>
            moduleQuestionnaires.map(dataSet => ({
                dataSet: dataSet,
                period: item.period,
                organisationUnit: item.orgUnit,
                completed,
            }))
        );

        if (!_(moduleQuestionnaires).compact().isEmpty()) {
            await this.api
                .post<CompleteDataSetRegistrationsResponse>(
                    "/completeDataSetRegistrations",
                    {},
                    { completeDataSetRegistrations: dataSetRegistrations }
                )
                .getData();
        }
    }

    private async sendNotifications(subject: string, text: string, userGroups: Ref[], users?: Ref[]): Promise<void> {
        this.api.messageConversations.post({
            subject,
            text,
            userGroups,
            users,
        });
    }

    private async getChangedBy(): Promise<StatusChangedBy> {
        const { id, username } = await this.api.get<StatusChangedBy>("/me?fields=id,username").getData();
        return { id, username };
    }

    private async getNewSubmissionValues(
        items: GLASSDataSubmissionItemIdentifier[],
        objects: GLASSDataSubmissionItem[],
        status: Status
    ) {
        const changedBy = await this.getChangedBy();

        return objects.map(object => {
            const isNewItem = !!items.find(
                item =>
                    item.orgUnit === object.orgUnit &&
                    item.module === object.module &&
                    item.period === String(object.period)
            );

            const statusHistory = {
                changedAt: new Date().toISOString(),
                from: object.status,
                to: status,
                changedBy,
            };

            return isNewItem ? { ...object, status, statusHistory: [...object.statusHistory, statusHistory] } : object;
        });
    }

    private async getNewEARSubmissionValues(
        signals: EARSubmissionItemIdentifier[],
        objects: EARDataSubmissionItem[],
        status: Status
    ) {
        const changedBy = await this.getChangedBy();

        return objects.map(object => {
            const isNewItem = !!signals.find(
                signal =>
                    signal.orgUnitId === object.orgUnit.id && signal.module === object.module && signal.id === object.id
            );

            const statusHistory = {
                changedAt: new Date().toISOString(),
                from: object.status,
                to: status,
                changedBy,
            };

            return isNewItem
                ? { ...object, status: status, statusHistory: [...object.statusHistory, statusHistory] }
                : object;
        });
    }
}

const emptyPage: PaginatedObjects<GLASSDataSubmissionItem> = {
    pager: { page: 1, pageCount: 1, pageSize: 10, total: 1 },
    objects: [],
};

const AMC_PRODUCT_REGISTER_CODE = "AMR_GLASS_AMC_PRO_PRODUCT_REGISTER";

const moduleMapping: Record<string, string> = {
    AMC: "AMC",
    AMR: "AMR",
    AMR_FUNGHI: "AMR - Fungal", // to do: remove this line when submissions have value AMR_FUNGAL
    AMR_FUNGAL: "AMR - Fungal",
    AMR_INDIVIDUAL: "AMR - Individual",
    EAR: "EAR",
    EGASP: "EGASP",
};

type RegistrationItemBase = Pick<
    GLASSDataSubmissionItem,
    "orgUnitName" | "orgUnit" | "period" | "questionnaireCompleted"
>;

function getRegistrationKey(options: { orgUnitId: Id; period: string }): RegistrationKey {
    return [options.orgUnitId, options.period].join(".");
}

type RegistrationKey = string; // `${orgUnitId}.${period}`

const flattenNodes = (orgUnitNodes: OrgUnitNode[]): OrgUnitNode[] =>
    _.flatMap(orgUnitNodes, node => (node.children ? [node, ...flattenNodes(node.children)] : [node]));

type OrgUnitNode = {
    level: number;
    id: string;
    children?: OrgUnitNode[];
};

const eventFields = {
    program: true,
    programStage: true,
    event: true,
    dataValues: true,
    orgUnit: true,
    occurredAt: true,
    status: true,
} as const;

type D2TrackerEvent = SelectedPick<D2TrackerEventSchema, typeof eventFields>;

const trackedEntitiesFields = {
    trackedEntity: true,
    trackedEntityType: true,
    orgUnit: true,
    enrollments: {
        trackedEntity: true,
        occurredAt: true,
        orgUnit: true,
        program: true,
        enrollment: true,
        status: true,
        enrolledAt: true,
        events: {
            orgUnit: true,
            program: true,
            programStage: true,
            event: true,
            occurredAt: true,
            dataValues: {
                dataElement: true,
                value: true,
            },
        },
    },
    attributes: {
        attribute: true,
        valueType: true,
        value: true,
    },
    programOwners: true,
} as const;

type D2TrackerEntity = SelectedPick<D2TrackerTrackedEntitySchema, typeof trackedEntitiesFields>;

const uploadsEventFields = {
    event: true,
    dataValues: true,
} as const;

type D2UploadTrackerEvent = SelectedPick<D2TrackerEventSchema, typeof uploadsEventFields>;
