import {
    ATCOptions,
    GLASSDataMaintenanceOptions,
    GLASSDataMaintenanceRepository,
} from "../../../domain/reports/glass-admin/repositories/GLASSDataMaintenanceRepository";
import { DataStoreStorageClient } from "../../common/clients/storage/DataStoreStorageClient";
import { StorageClient } from "../../common/clients/storage/StorageClient";
import { Instance } from "../../common/entities/Instance";
import { glassDataStoreNamespace, Namespaces } from "../../common/clients/storage/Namespaces";
import { copyDataStoreSharing } from "../../common/clients/storage/dataStoreSharing";
import { NamedRef, Ref } from "../../../domain/common/entities/Ref";
import { D2Api, SelectedPick } from "../../../types/d2-api";
import {
    AMCRecalculation,
    ATCItem,
    ATCItemIdentifier,
    ATCPaginatedObjects,
    GLASSDataMaintenanceItem,
    GLASSMaintenancePaginatedObjects,
    GLASSModule,
    getUserModules,
} from "../../../domain/reports/glass-admin/entities/GLASSDataMaintenanceItem";
import _ from "lodash";
import { Config } from "../../../domain/common/entities/Config";
import { Id } from "../../../domain/common/entities/Base";
import { paginate } from "../../../domain/common/entities/PaginatedObjects";
import { GlassAtcVersionData } from "../../../domain/reports/glass-admin/entities/GlassAtcVersionData";
import {
    AMR_GLASS_PROE_UPLOADS_PROGRAM_ID,
    getValueById,
    GlassUploads,
    GlassUploadsStatus,
    NOT_COMPLETED_STATUSES,
    uploadsDHIS2Ids,
} from "../../common/entities/GlassUploads";
import { D2TrackerEventSchema, D2TrackerEventToPost, TrackerEventsResponse } from "@eyeseetea/d2-api/api/trackerEvents";

const START_YEAR_PERIOD = 2016;
const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_CHUNK_SIZE = 100;

export class GLASSDataMaintenanceDefaultRepository implements GLASSDataMaintenanceRepository {
    private storageClient: StorageClient;
    private globalStorageClient: StorageClient;

    constructor(private api: D2Api) {
        const instance = new Instance({ url: this.api.baseUrl });
        this.storageClient = new DataStoreStorageClient("user", instance);
        this.globalStorageClient = new DataStoreStorageClient("global", instance);
    }

    async get(
        options: GLASSDataMaintenanceOptions
    ): Promise<GLASSMaintenancePaginatedObjects<GLASSDataMaintenanceItem>> {
        const { paging, sorting, module } = options;
        if (!module) return emptyPage;

        const notCompleteUploads = await this.getUploadsByModuleAndNotCompleted(module);
        const countries: NamedRef[] = await this.getCountries();

        const filteredFiles = this.getFilteredFiles(notCompleteUploads, countries);

        const itemIdsNotDeletedStatus = this.getItemIdsNotDeleted(filteredFiles);
        const { objects, pager } = paginate(filteredFiles, paging, sorting);

        return { objects: objects, pager: pager, itemIdsNotDeletedStatus: itemIdsNotDeletedStatus };
    }

    private async getUploadsByModuleAndNotCompleted(moduleId: Id): Promise<GlassUploads[]> {
        const d2TrackerEvents: D2UploadTrackerEvent[] = [];

        const moduleIdFilter = `${uploadsDHIS2Ids.moduleId}:eq:${moduleId}`;
        const statusFilter = `${uploadsDHIS2Ids.status}:in:${NOT_COMPLETED_STATUSES.join(";")}`;

        let page = 1;
        let response: TrackerEventsResponse<typeof uploadsEventFields>;
        do {
            response = await this.api.tracker.events
                .get({
                    program: AMR_GLASS_PROE_UPLOADS_PROGRAM_ID,
                    fields: uploadsEventFields,
                    filter: [moduleIdFilter, statusFilter].join(","),
                    totalPages: true,
                    page: page,
                    pageSize: DEFAULT_PAGE_SIZE,
                })
                .getData();
            d2TrackerEvents.push(...response.instances);
            page++;
        } while (response.page < Math.ceil((response.total as number) / DEFAULT_PAGE_SIZE));

        return d2TrackerEvents
            .map(event => {
                const status =
                    (getValueById(event.dataValues, uploadsDHIS2Ids.status) as GlassUploadsStatus) || "UPLOADED";
                const period = getValueById(event.dataValues, uploadsDHIS2Ids.period) || "";
                const fileId = getValueById(event.dataValues, uploadsDHIS2Ids.documentId) || "";
                const fileName = getValueById(event.dataValues, uploadsDHIS2Ids.documentName) || "";
                const fileType = getValueById(event.dataValues, uploadsDHIS2Ids.documentFileType) || "";

                if (!status || !period || !fileId) return null;

                const upload: GlassUploads = {
                    id: event.event,
                    fileId: fileId,
                    fileName: fileName,
                    fileType: fileType,
                    status: status,
                    period: period,
                    module: moduleId,
                    orgUnit: event.orgUnit,
                };

                return upload;
            })
            .filter((upload): upload is GlassUploads => Boolean(upload));
    }

    async getATCs(options: ATCOptions, namespace: string): Promise<ATCPaginatedObjects<ATCItem>> {
        const { paging, sorting } = options;

        const atcs = await this.getATCItems(namespace);
        const uploadedYears = _(atcs)
            .map(atc => atc.year)
            .uniq()
            .value();
        const { objects, pager } = paginate(atcs, paging, sorting);

        return { objects: objects, pager: pager, uploadedYears: uploadedYears };
    }

    private async getATCItems(namespace: string) {
        return (await this.globalStorageClient.getObject<ATCItem[]>(namespace)) ?? [];
    }

    async getUserModules(config: Config): Promise<GLASSModule[]> {
        const modules = await this.getModules();

        return getUserModules(modules, config.currentUser);
    }

    async delete(itemIds: Id[]): Promise<void> {
        await this.deleteFileResources(itemIds);

        await this.setDeletedStatusToUploadsByFileIds(itemIds);
    }

    private async setDeletedStatusToUploadsByFileIds(fileIds: Id[]): Promise<void> {
        const uniqueIds = _(fileIds).compact().uniq().value();
        if (uniqueIds.length === 0) return;

        const chunks: Id[][] = _.chunk(uniqueIds, DEFAULT_CHUNK_SIZE);

        for (const idsChunk of chunks) {
            const inValues = idsChunk.join(";");

            const response = await this.api.tracker.events
                .get({
                    program: AMR_GLASS_PROE_UPLOADS_PROGRAM_ID,
                    skipPaging: true,
                    fields: uploadsEventFields,
                    filter: `${uploadsDHIS2Ids.documentId}:in:${inValues}`,
                })
                .getData();

            const events: D2UploadTrackerEvent[] = response.instances ?? [];
            if (events.length === 0) continue;

            const eventsWithDeletedStatus: D2TrackerEventToPost[] = events.map(event => {
                const updatedDataValues = event.dataValues.map(dataValue =>
                    dataValue.dataElement === uploadsDHIS2Ids.status
                        ? {
                              ...dataValue,
                              value: "DELETED" as GlassUploadsStatus,
                          }
                        : dataValue
                );

                return {
                    ...event,
                    dataValues: updatedDataValues,
                };
            });

            await this.api.tracker.post({ importStrategy: "UPDATE" }, { events: eventsWithDeletedStatus }).getData();
        }
    }

    async getColumns(namespace: string): Promise<string[]> {
        const columns = await this.storageClient.getObject<string[]>(namespace);

        return columns ?? [];
    }

    async saveColumns(namespace: string, columns: string[]): Promise<void> {
        return this.storageClient.saveObject<string[]>(namespace, columns);
    }

    async uploadATC(
        namespace: string,
        glassAtcVersionData: GlassAtcVersionData,
        year: string,
        selectedItems?: ATCItemIdentifier[]
    ): Promise<void> {
        const atcItems = await this.getATCItems(namespace);
        const [versionKey, updatedATCItems] = selectedItems
            ? [`ATC-${this.updateVersion(atcItems, selectedItems)}`, this.patchATCVersion(atcItems, selectedItems)]
            : [`ATC-${year}-v1`, this.uploadNewATC(year, atcItems)];

        await this.globalStorageClient.saveObject<GlassAtcVersionData>(versionKey, glassAtcVersionData);
        // Lock the new version like ATCs before ATCs lists it: a new key is writable by every logged-in user
        await copyDataStoreSharing(this.api, glassDataStoreNamespace, Namespaces.ATCS, versionKey);
        await this.globalStorageClient.saveObject<ATCItem[]>(Namespaces.ATCS, updatedATCItems);
    }

    async getRecalculationLogic(namespace: string): Promise<AMCRecalculation | undefined> {
        return await this.globalStorageClient.getObject<AMCRecalculation>(namespace);
    }

    async cancelRecalculation(namespace: string): Promise<void> {
        const amcRecalculationLogic = await this.getRecalculationLogic(namespace);

        if (amcRecalculationLogic) {
            const updatedRecalculationLogic = {
                ...amcRecalculationLogic,
                recalculate: false,
            };

            await this.globalStorageClient.saveObject<AMCRecalculation>(namespace, updatedRecalculationLogic);
        }
    }

    async saveRecalculationLogic(namespace: string): Promise<void> {
        const amcRecalculationLogic = await this.getRecalculationLogic(namespace);

        const currentDate = new Date().toISOString();
        const periods = this.getATCPeriods();
        const enrolledCountries = await this.getEnrolledCountries();

        const amcRecalculation: AMCRecalculation = {
            date: currentDate,
            periods: periods,
            orgUnitsIds: enrolledCountries,
            loggerProgram: amcRecalculationLogic?.loggerProgram ?? "",
            recalculate: true,
        };

        this.globalStorageClient.saveObject<AMCRecalculation>(namespace, amcRecalculation);
    }

    async getLoggerProgramName(programId: string): Promise<string> {
        const { programs } = await this.api.metadata
            .get({
                programs: {
                    fields: {
                        id: true,
                        name: true,
                    },
                    filter: {
                        id: {
                            eq: programId,
                        },
                    },
                },
            })
            .getData();

        return programs[0]?.name ?? "";
    }

    private getATCPeriods = (): string[] => {
        const currentYear = new Date().getFullYear();

        return _.range(START_YEAR_PERIOD, currentYear + 1).map(year => year.toString());
    };

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

    private async getCountriesOutsideNARegion(): Promise<string[]> {
        const { organisationUnits: kosovoOu } = await this.api.metadata
            .get({
                organisationUnits: {
                    fields: {
                        id: true,
                    },
                    filter: {
                        code: {
                            eq: "XKX",
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

    private uploadNewATC(year: string, atcItems: ATCItem[]): ATCItem[] {
        const atcYears = atcItems.map(atcItem => _.parseInt(atcItem.year));
        const previousVersionYear = Math.max(...atcYears);

        const newItem: ATCItem = {
            year: year,
            version: "1",
            uploadedDate: new Date().toISOString(),
            currentVersion: _.parseInt(year) > previousVersionYear,
            previousVersion: false,
        };

        return _(atcItems)
            .map(atcItem => {
                if (atcItem.currentVersion) {
                    return {
                        ...atcItem,
                        currentVersion: false,
                        previousVersion: true,
                    };
                } else if (atcItem.previousVersion) {
                    return {
                        ...atcItem,
                        previousVersion: false,
                    };
                } else {
                    return atcItem;
                }
            })
            .concat(newItem)
            .value();
    }

    private patchATCVersion(atcItems: ATCItem[], selectedItems: ATCItemIdentifier[]): ATCItem[] {
        const newItems: ATCItem[] = selectedItems.map(selectedItem => this.getNewPatchItem(selectedItem, atcItems));
        const selectedATCItem = this.getSelectedATCItem(atcItems, selectedItems[0]);

        const updatedATCItems = _(atcItems)
            .map(atcItem => {
                const matchingItem = this.getSelectedATCItem(selectedItems, atcItem);

                if (atcItem.previousVersion && selectedATCItem?.currentVersion) {
                    return {
                        ...atcItem,
                        previousVersion: false,
                    };
                } else if (matchingItem?.currentVersion) {
                    return {
                        ...atcItem,
                        currentVersion: false,
                        previousVersion: true,
                    };
                }

                return atcItem;
            })
            .value();

        return [...newItems, ...updatedATCItems];
    }

    private getNewPatchItem(selectedItem: ATCItemIdentifier, atcItems: ATCItem[]): ATCItem {
        const newVersion = this.getNewVersionNumber(atcItems, selectedItem);

        return {
            currentVersion: selectedItem.currentVersion,
            previousVersion: false,
            uploadedDate: new Date().toISOString(),
            version: newVersion,
            year: selectedItem.year,
        };
    }

    private getNewVersionNumber(atcItems: ATCItem[], selectedItem: ATCItemIdentifier | undefined) {
        return (
            (_(atcItems)
                .filter(atcItem => atcItem.year === selectedItem?.year)
                .map(atcItem => _.parseInt(atcItem.version))
                .max() ?? 0) + 1
        )?.toString();
    }

    private getSelectedATCItem(atcItems: ATCItemIdentifier[], selectedItem: ATCItemIdentifier | undefined) {
        return atcItems.find(
            atcItem =>
                atcItem.year === selectedItem?.year && _.parseInt(atcItem.version) === _.parseInt(selectedItem?.version)
        );
    }

    private updateVersion(atcItems: ATCItem[], items: ATCItemIdentifier[]): string {
        const item = _.first(items);
        const newVersion = this.getNewVersionNumber(atcItems, item);

        if (item) {
            return `${item.year}-v${_.parseInt(newVersion)}`;
        } else {
            return "";
        }
    }

    private async getCountries(): Promise<NamedRef[]> {
        const { objects: organisationUnits } = await this.api.models.organisationUnits
            .get({
                fields: {
                    id: true,
                    name: true,
                },
                filter: {
                    level: { eq: "3" },
                },
                paging: false,
            })
            .getData();

        return organisationUnits;
    }

    private async getModules(): Promise<GLASSModule[]> {
        const modules =
            (await this.globalStorageClient.getObject<GLASSModule[]>(Namespaces.DATA_SUBMISSSIONS_MODULES)) ?? [];

        return _(modules)
            .map(module => ({ ...module, userGroups: { approveAccess: module.userGroups.approveAccess ?? [] } }))
            .filter(module => module.name !== earModule)
            .value();
    }

    private async getUploads(): Promise<GlassUploads[]> {
        const uploads = (await this.globalStorageClient.getObject<GlassUploads[]>("uploads")) ?? [];

        return uploads;
    }

    private async deleteFileResources(fileIds: Id[]): Promise<void> {
        _.forEach(fileIds, async fileId => {
            try {
                await this.api.delete(`/documents/${fileId}`).getData();
            } catch (error) {
                console.debug("File does not exist");
            }
        });
    }

    private getFilteredFiles(notCompleteUploads: GlassUploads[], countries: NamedRef[]): GLASSDataMaintenanceItem[] {
        const lastDataSubmissionYear = new Date().getFullYear() - 1; // last submission year is the previous year

        return _(notCompleteUploads)
            .map(upload => ({
                ...upload,
                id: upload.fileId,
                orgUnitName: countries.find(country => country.id === upload.orgUnit)?.name ?? "",
            }))
            .filter(upload => {
                const isBeforeSubmissionYear = parseInt(upload.period, 10) < lastDataSubmissionYear;
                return isBeforeSubmissionYear;
            })
            .value();
    }

    private getItemIdsNotDeleted(rows: GLASSDataMaintenanceItem[]): string[] {
        return _(rows)
            .filter(row => row.status !== "DELETED")
            .map(row => row.id)
            .value();
    }
}

const emptyPage: GLASSMaintenancePaginatedObjects<GLASSDataMaintenanceItem> = {
    pager: { page: 1, pageCount: 1, pageSize: 10, total: 1 },
    objects: [],
    itemIdsNotDeletedStatus: [],
};

const earModule = "EAR";

const flattenNodes = (orgUnitNodes: OrgUnitNode[]): OrgUnitNode[] =>
    _.flatMap(orgUnitNodes, node => (node.children ? [node, ...flattenNodes(node.children)] : [node]));

type OrgUnitNode = {
    level: number;
    id: string;
    children?: OrgUnitNode[];
};

const uploadsEventFields = {
    event: true,
    program: true,
    programStage: true,
    orgUnit: true,
    dataValues: true,
    occurredAt: true,
} as const;

type D2UploadTrackerEvent = SelectedPick<D2TrackerEventSchema, typeof uploadsEventFields>;
