import { ReportType } from "../../domain/common/entities/ReportType";

export function getReportType(): ReportType {
    const report = process.env.REACT_APP_REPORT_VARIANT || "";

    switch (true) {
        case report === "mal-approval-status":
            return "mal";
        case report === "mal-subscription-status":
            return "mal-subscription";
        case report === "glass-submission":
            return "glass";
        case report === "glass-admin":
            return "glass-admin";
        case report === "glass-enrolment":
            return "glass-enrolment";
        case report === "csy-summary-patient":
            return "summary-patient";
        case report === "csy-summary-mortality":
            return "summary-mortality";
        case report === "csy-audit-emergency":
            return "auditEmergency";
        case report === "csy-audit-trauma":
            return "auditTrauma";
        case report === "authorities-monitoring":
            return "authMonitoring";
        case report === "data-quality":
            return "data-quality";
        case report === "two-factor-monitoring":
            return "twoFactorUserMonitoring";
        case report === "file-resources-monitoring":
            return "fileResourcesMonitoring";
        default:
            return "nhwa";
    }
}
