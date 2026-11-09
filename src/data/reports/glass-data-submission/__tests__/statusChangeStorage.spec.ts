import {
    GLASSDataSubmissionItem,
    Status,
} from "../../../../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import {
    selectSubmissions,
    StatusChange,
    StatusConflictError,
} from "../../../../domain/reports/glass-data-submission/entities/StatusChange";
import { checkStatusChange, saveStatusChange } from "../statusChangeStorage";

const changedBy = { id: "user1", username: "approver" };

function entry(id: string, orgUnit: string, status: Status): GLASSDataSubmissionItem {
    return {
        id,
        orgUnit,
        module: "AMC",
        period: "2025",
        status,
        statusHistory: [],
    } as unknown as GLASSDataSubmissionItem;
}

const approveFrance: StatusChange<GLASSDataSubmissionItem> = {
    selected: selectSubmissions([{ orgUnit: "FRA", module: "AMC", period: "2025" }]),
    from: ["PENDING_APPROVAL"],
    to: "APPROVED",
};

/** In-memory key. `beforeRead` runs at the start of each read, so a test can change the key between two reads. */
function fakeStorage(initial: GLASSDataSubmissionItem[], beforeRead: (reads: number) => void = () => undefined) {
    const state = { value: initial, reads: 0, saves: [] as GLASSDataSubmissionItem[][] };
    const storage = {
        listObjectsInCollection: async () => {
            state.reads += 1;
            beforeRead(state.reads);
            return state.value;
        },
        saveObject: async (_key: string, value: GLASSDataSubmissionItem[]) => {
            state.saves.push(value);
            state.value = value;
        },
    };
    return { storage: storage as never, state };
}

describe("saveStatusChange", () => {
    it("keeps a change made by someone else between the first read and the save", async () => {
        const initial = [entry("a", "FRA", "PENDING_APPROVAL"), entry("b", "DEU", "PENDING_APPROVAL")];
        const { storage, state } = fakeStorage(initial, reads => {
            // Another approver approves Germany after this user's check (read 1) and before the save (read 2).
            if (reads === 2) state.value = [initial[0] as GLASSDataSubmissionItem, entry("b", "DEU", "APPROVED")];
        });

        await checkStatusChange(storage, "data-submissions", approveFrance, changedBy);
        await saveStatusChange(storage, "data-submissions", approveFrance, changedBy);

        expect(state.saves).toHaveLength(1);
        expect(state.saves[0]?.map(e => [e.orgUnit, e.status])).toEqual([
            ["FRA", "APPROVED"],
            ["DEU", "APPROVED"],
        ]);
        expect(state.saves[0]?.[1]?.statusHistory).toEqual([]);
    });

    it("refuses and writes nothing when the entry was rejected between the first read and the save", async () => {
        const { storage, state } = fakeStorage([entry("a", "FRA", "PENDING_APPROVAL")], reads => {
            if (reads === 2) state.value = [entry("a", "FRA", "REJECTED")];
        });

        await checkStatusChange(storage, "data-submissions", approveFrance, changedBy);
        await expect(saveStatusChange(storage, "data-submissions", approveFrance, changedBy)).rejects.toThrow(
            StatusConflictError
        );

        expect(state.saves).toEqual([]);
    });
});

describe("checkStatusChange", () => {
    it("refuses a stale request without writing", async () => {
        const { storage, state } = fakeStorage([entry("a", "FRA", "APPROVED")]);

        await expect(checkStatusChange(storage, "data-submissions", approveFrance, changedBy)).rejects.toThrow(
            /reload the page/
        );

        expect(state.saves).toEqual([]);
    });
});
