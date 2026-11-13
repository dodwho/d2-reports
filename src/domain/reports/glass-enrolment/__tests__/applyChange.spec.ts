import { emptyChangeSet } from "../entities/ChangeSet";
import { HistoryRecord } from "../entities/History";
import { EnrolmentRepository } from "../repositories/EnrolmentRepository";
import { ApplyChangeUseCase } from "../usecases/EnrolmentUseCases";

describe("ApplyChangeUseCase", () => {
    it("settles the history record as failed when the write throws, and passes the error on", async () => {
        const saved: HistoryRecord[] = [];
        const repository = {
            saveHistory: (record: HistoryRecord) => Promise.resolve(void saved.push(record)),
            apply: () => Promise.reject(new Error("Network down")),
        } as unknown as EnrolmentRepository;

        const request = {
            action: "enrol",
            changes: emptyChangeSet,
            countryNames: {},
            user: { username: "admin" },
            newId: () => "abc123",
        } as unknown as Parameters<ApplyChangeUseCase["execute"]>[0];

        await expect(new ApplyChangeUseCase(repository).execute(request)).rejects.toThrow("Network down");
        expect(saved.map(record => record.status)).toEqual(["pending", "failed"]);
        expect(saved[1]?.errors).toEqual(["Network down"]);
    });
});
