import _ from "lodash";
import { Id, NamedRef } from "../../../common/entities/Base";
import { User } from "../../../common/entities/User";

export type UpdateAction = "approve" | "reject" | "reopen" | "accept" | "unapvdDashboard";

export type DataSubmissionPeriod = "YEARLY" | "QUARTERLY";

export type UploadStatus = "UPLOADED" | "IMPORTED" | "VALIDATED" | "COMPLETED" | "DELETED";
export interface GLASSDataSubmissionItem {
    id: Id;
    module: string;
    orgUnit: string;
    orgUnitName: string;
    period: string;
    dataSubmissionPeriod: DataSubmissionPeriod;
    status: Status;
    questionnaireCompleted: boolean;
    uploadStatuses: UploadStatus[];
    submissionStatus: string;
    from: Date | null;
    to: Date | null;
    statusHistory: {
        changedAt: string;
        from: Status;
        to: Status;
        changedBy?: StatusChangedBy;
    }[];
    creationDate: string;
}

export type StatusChangedBy = { id: Id; username: string };

export interface EARDataSubmissionItem {
    creationDate: string;
    id: Id;
    module: Id;
    orgUnitId: string;
    orgUnitName: string;
    orgUnit: NamedRef;
    levelOfConfidentiality: "CONFIDENTIAL" | "NON-CONFIDENTIAL";
    status: Status;
    submissionStatus: string;
    statusHistory: {
        changedAt: string;
        from: Status;
        to: Status;
        changedBy?: StatusChangedBy;
    }[];
}

export interface GLASSDataSubmissionItemIdentifier {
    orgUnit: string;
    period: string;
    module: string;
}

export interface EARSubmissionItemIdentifier {
    orgUnit?: NamedRef;
    orgUnitId: string | undefined;
    orgUnitName: string | undefined;
    id: string;
    module: string | undefined;
    levelOfConfidentiality: string | undefined;
}

export interface ApprovalIds {
    id: Id;
    approvedId: Id;
}

export type Status =
    | "NOT_COMPLETED"
    | "COMPLETE"
    | "UPDATE_REQUEST_ACCEPTED"
    | "PENDING_APPROVAL"
    | "REJECTED"
    | "APPROVED"
    | "ACCEPTED"
    | "PENDING_UPDATE_APPROVAL"
    | "DRAFT";

type Module = "AMR" | "AMR - Individual" | "AMR - Fungal" | "AMC" | "EGASP" | "EAR";

export interface GLASSDataSubmissionModule {
    id: Id;
    name: Module;
    dataSets: ApprovalIds[];
    programs: ApprovalIds[];
    programStages: ApprovalIds[];
    questionnaires: ApprovalIds[];
    dashboards: {
        reportsMenu: string;
        validationReport: string;
    };
    dataSubmissionPeriod: DataSubmissionPeriod;
    userGroups: {
        captureAccess: NamedRef[];
        readAccess: NamedRef[];
        approveAccess: NamedRef[];
    };
}

export function getDataSubmissionItemId(submissionItem: GLASSDataSubmissionItem): string {
    return [submissionItem.orgUnit, submissionItem.period, submissionItem.module].join("-");
}

export function getEARSubmissionItemId(submissionItem: EARDataSubmissionItem): string {
    return [
        submissionItem.orgUnit.id,
        submissionItem.orgUnit.name,
        submissionItem.module,
        submissionItem.id,
        submissionItem.levelOfConfidentiality,
    ].join("-");
}

export function parseDataSubmissionItemId(string: string): GLASSDataSubmissionItemIdentifier | undefined {
    const [orgUnit, period, module] = string.split("-");
    if (!period || !orgUnit || !module) return undefined;

    return { module, period, orgUnit };
}

export function parseEARSubmissionItemId(string: string): EARSubmissionItemIdentifier | undefined {
    const [orgUnitId, orgUnitName, module, id, levelOfConfidentiality] = string.split("-");

    if (!id) return undefined;

    return { module, id, orgUnitId, orgUnitName, levelOfConfidentiality };
}

export function getUserModules(modules: GLASSDataSubmissionModule[], user: User): GLASSDataSubmissionModule[] {
    const userGroups = user.userGroups;
    const userGroupIds = userGroups.map(userGroup => userGroup.id);

    const userModules = modules.filter(module => {
        const moduleUserGroupIds = module.userGroups.approveAccess.map(userGroup => userGroup.id) ?? [];

        return _.some(moduleUserGroupIds, moduleUserGroupId => userGroupIds.includes(moduleUserGroupId));
    });

    return userModules;
}
