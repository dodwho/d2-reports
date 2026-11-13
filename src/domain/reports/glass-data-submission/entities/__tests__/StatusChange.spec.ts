import { GLASSDataSubmissionItem, Status } from "../GLASSDataSubmissionItem";
import { planStatusChange, selectSubmissions, StatusChange, StatusConflictError } from "../StatusChange";

const changedBy = { id: "user1", username: "approver" };
const now = new Date("2026-11-09T12:00:00.000Z");

function entry(id: string, orgUnit: string, status: Status, historyLength = 0): GLASSDataSubmissionItem {
    return {
        id,
        orgUnit,
        module: "AMC",
        period: "2025",
        status,
        statusHistory: Array.from({ length: historyLength }, () => ({
            changedAt: "2026-01-01T00:00:00.000Z",
            from: "NOT_COMPLETED" as Status,
            to: "COMPLETE" as Status,
        })),
    } as GLASSDataSubmissionItem;
}

function approve(...orgUnits: string[]): StatusChange<GLASSDataSubmissionItem> {
    return {
        selected: selectSubmissions(orgUnits.map(orgUnit => ({ orgUnit, module: "AMC", period: "2025" }))),
        from: ["PENDING_APPROVAL"],
        to: "APPROVED",
    };
}

describe("planStatusChange", () => {
    it("changes only the selected entry and records who changed it, from which status", () => {
        const entries = [entry("a", "FRA", "PENDING_APPROVAL"), entry("b", "DEU", "PENDING_APPROVAL")];

        const result = planStatusChange(entries, approve("FRA"), changedBy, now);

        expect(result[0]).toMatchObject({ id: "a", status: "APPROVED" });
        expect(result[0]?.statusHistory).toEqual([
            { changedAt: now.toISOString(), from: "PENDING_APPROVAL", to: "APPROVED", changedBy },
        ]);
        expect(result[1]).toBe(entries[1]);
    });

    it("stamps the change after the latest stored change when this browser's clock is behind", () => {
        const stored = entry("a", "FRA", "PENDING_APPROVAL", 1);
        const later = {
            ...stored,
            statusHistory: stored.statusHistory.map(item => ({ ...item, changedAt: "2026-11-09T12:03:00.000Z" })),
        };

        const result = planStatusChange([later], approve("FRA"), changedBy, now);

        expect(result[0]?.statusHistory[1]?.changedAt).toBe("2026-11-09T12:03:00.001Z");
        expect(planStatusChange([stored], approve("FRA"), changedBy, now)[0]?.statusHistory[1]?.changedAt).toBe(
            now.toISOString()
        );
    });

    it("refuses when the stored status is no longer the expected one, and changes nothing", () => {
        const entries = [entry("a", "FRA", "REJECTED"), entry("b", "DEU", "PENDING_APPROVAL")];

        expect(() => planStatusChange(entries, approve("FRA", "DEU"), changedBy, now)).toThrow(StatusConflictError);
        expect(() => planStatusChange(entries, approve("FRA", "DEU"), changedBy, now)).toThrow(
            /1 of 2 selected submissions are not PENDING_APPROVAL any more \(now: REJECTED\).*reload the page/
        );
    });

    it("refuses a selected submission that is not stored any more", () => {
        expect(() => planStatusChange([entry("b", "DEU", "PENDING_APPROVAL")], approve("FRA"), changedBy)).toThrow(
            /now: not found/
        );
    });

    it("with duplicate entries, changes the one in the expected status and leaves the other", () => {
        const entries = [entry("a", "FRA", "NOT_COMPLETED"), entry("b", "FRA", "PENDING_APPROVAL", 3)];

        const result = planStatusChange(entries, approve("FRA"), changedBy, now);

        expect(result[0]).toBe(entries[0]);
        expect(result[1]).toMatchObject({ id: "b", status: "APPROVED" });
        expect(result[1]?.statusHistory).toHaveLength(4);
    });

    it("refuses when every duplicate entry is in another status", () => {
        const entries = [entry("a", "FRA", "NOT_COMPLETED"), entry("b", "FRA", "APPROVED")];

        expect(() => planStatusChange(entries, approve("FRA"), changedBy)).toThrow(StatusConflictError);
    });

    it("matches a numeric period stored in the key against the text period of the selection", () => {
        const stored = { ...entry("a", "FRA", "PENDING_APPROVAL"), period: 2025 as unknown as string };

        expect(planStatusChange([stored], approve("FRA"), changedBy, now)[0]?.status).toBe("APPROVED");
    });
});
