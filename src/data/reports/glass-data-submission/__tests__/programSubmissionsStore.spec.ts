import {
    StatusConflictError,
    StatusRefusedError,
} from "../../../../domain/reports/glass-data-submission/entities/StatusChange";
import { ProgramSubmissionsStore } from "../programSubmissionsStore";
import { StoredEntity, submissionsProgramIds as ids } from "../submissionsProgram";
import { submissionsStoreSetting } from "../submissionsStoreSetting";
import { SubmissionChange } from "../submissionsStore";

const changedBy = { id: "u1", username: "ann" };

function entity(id: string, key: string | undefined, statuses: string[]): StoredEntity {
    return {
        trackedEntity: id,
        attributes: key ? [{ attribute: ids.keyAttribute, value: key }] : [],
        enrollments: [
            {
                enrollment: `enr-${id}`,
                program: ids.program,
                events: statuses.map((status, index) => ({
                    programStage: ids.countryStage,
                    occurredAt: `2026-03-01T${String(10 + index).padStart(2, "0")}:00:00.000`,
                    dataValues: [{ dataElement: ids.countryStatus, value: status }],
                })),
            },
        ],
    };
}

const approve = (...orgUnits: string[]): SubmissionChange => ({
    items: orgUnits.map(orgUnit => ({ module: "m", orgUnit, period: "2025" })),
    from: ["PENDING_APPROVAL"],
    to: "APPROVED",
});

/** A tracker that answers the queries of the store as DHIS2 does (`sw` and `in` filters, pages) and records the posts. */
function fakeTracker(entities: StoredEntity[], options: { canWrite?: boolean; postError?: unknown } = {}) {
    const state = {
        queries: [] as { filter: string; page: number; ouMode: string }[],
        posts: [] as { params: any; body: any }[],
        stageReads: 0,
    };
    const keyOf = (stored: StoredEntity) =>
        stored.attributes?.find(attribute => attribute.attribute === ids.keyAttribute)?.value ?? "";

    const api = {
        tracker: {
            trackedEntities: {
                get: (params: { filter: string; page: number; pageSize: number; ouMode: string }) => ({
                    getData: async () => {
                        state.queries.push({ filter: params.filter, page: params.page, ouMode: params.ouMode });
                        const [, operator, ...rest] = params.filter.split(":");
                        const value = rest.join(":");
                        const matches = entities.filter(stored =>
                            operator === "sw"
                                ? keyOf(stored).startsWith(value)
                                : value.split(";").includes(keyOf(stored))
                        );
                        const from = (params.page - 1) * params.pageSize;
                        return { instances: matches.slice(from, from + params.pageSize) };
                    },
                }),
            },
            post: (params: unknown, body: unknown) => ({
                getData: async () => {
                    state.posts.push({ params, body });
                    if (options.postError) throw options.postError;
                    return { status: "OK" };
                },
            }),
        },
        get: () => ({
            getData: async () => {
                state.stageReads += 1;
                return { access: { data: { write: options.canWrite ?? true } } };
            },
        }),
    };
    return { store: new ProgramSubmissionsStore(api as never), state };
}

describe("ProgramSubmissionsStore.read", () => {
    it("reads one module in pages of 500 among the accessible entities and takes one entity per key", async () => {
        const entities = [
            ...Array.from({ length: 501 }, (_unused, index) => entity(`id${index}`, `m|OU${index}|2025`, ["COMPLETE"])),
            entity("other", "n|OU0|2025", ["COMPLETE"]),
            // A second entity for the first key, with a longer history: it is the one the GLASS app picks too.
            entity("dup", "m|OU0|2025", ["COMPLETE", "PENDING_APPROVAL"]),
        ];
        const { store, state } = fakeTracker(entities);

        const read = await store.read("m");

        expect(state.queries).toEqual([
            { filter: `${ids.keyAttribute}:sw:m|`, page: 1, ouMode: "ACCESSIBLE" },
            { filter: `${ids.keyAttribute}:sw:m|`, page: 2, ouMode: "ACCESSIBLE" },
        ]);
        expect(read).toHaveLength(501);
        expect(read.find(submission => submission.orgUnit === "OU0")?.id).toBe("dup");
    });

    it("fails and names the entity when one cannot be read as a submission", async () => {
        const { store } = fakeTracker([entity("broken", "m|OU0|2025", ["DRAFT"])]);

        await expect(store.read("m")).rejects.toThrow(/Data submission broken/);
    });
});

describe("ProgramSubmissionsStore.check", () => {
    it("asks for the write access to the WHO stage before reading anything", async () => {
        const { store, state } = fakeTracker([entity("a", "m|FRA|2025", ["PENDING_APPROVAL"])], { canWrite: false });

        await expect(store.check(approve("FRA"), changedBy)).rejects.toThrow(StatusRefusedError);

        expect(state.queries).toEqual([]);
        expect(state.posts).toEqual([]);
    });

    it("refuses a submission that is no longer in the expected status, without writing", async () => {
        const { store, state } = fakeTracker([entity("a", "m|FRA|2025", ["PENDING_APPROVAL", "APPROVED"])]);

        await expect(store.check(approve("FRA"), changedBy)).rejects.toThrow(StatusConflictError);

        expect(state.posts).toEqual([]);
    });

    it("refuses a submission that has no entity", async () => {
        const { store } = fakeTracker([]);

        await expect(store.check(approve("FRA"), changedBy)).rejects.toThrow(/not found/);
    });

    it("asks for the selected keys 100 at a time", async () => {
        const orgUnits = Array.from({ length: 150 }, (_unused, index) => `OU${index}`);
        const { store, state } = fakeTracker(
            orgUnits.map(ou => entity(`id-${ou}`, `m|${ou}|2025`, ["PENDING_APPROVAL"]))
        );

        await store.check(approve(...orgUnits), changedBy);

        expect(state.queries.map(query => query.filter.split(":in:")[1]?.split(";").length)).toEqual([100, 50]);
    });
});

describe("ProgramSubmissionsStore.save", () => {
    it("posts the decision of the selected submissions only, in one all-or-nothing import", async () => {
        const { store, state } = fakeTracker([
            entity("fra", "m|FRA|2025", ["COMPLETE", "PENDING_APPROVAL"]),
            entity("deu", "m|DEU|2025", ["PENDING_APPROVAL"]),
        ]);

        await store.save(approve("FRA"), changedBy);

        expect(state.posts).toHaveLength(1);
        expect(state.posts[0]?.params).toEqual({ importStrategy: "CREATE", atomicMode: "ALL" });
        expect(state.posts[0]?.body.events).toHaveLength(1);
        expect(state.posts[0]?.body.events[0]).toMatchObject({
            programStage: ids.whoStage,
            enrollment: "enr-fra",
            trackedEntity: "fra",
            orgUnit: "FRA",
            status: "COMPLETED",
            dataValues: [
                { dataElement: ids.whoDecision, value: "APPROVED" },
                { dataElement: ids.decidedKey, value: "m|FRA|2025" },
                { dataElement: ids.previousStatus, value: "PENDING_APPROVAL" },
                { dataElement: ids.originalChangedBy, value: "ann (u1)" },
            ],
        });
    });

    it("writes only the entity the GLASS app would pick when a key has two", async () => {
        const { store, state } = fakeTracker([
            entity("zzz", "m|FRA|2025", ["COMPLETE", "PENDING_APPROVAL"]),
            entity("aaa", "m|FRA|2025", ["PENDING_APPROVAL"]),
        ]);

        await store.save(approve("FRA"), changedBy);

        expect(state.posts[0]?.body.events.map((event: { trackedEntity: string }) => event.trackedEntity)).toEqual([
            "zzz",
        ]);
    });

    it("writes nothing when a selected submission was changed by someone else", async () => {
        const { store, state } = fakeTracker([
            entity("fra", "m|FRA|2025", ["PENDING_APPROVAL"]),
            entity("deu", "m|DEU|2025", ["PENDING_APPROVAL", "REJECTED"]),
        ]);

        await expect(store.save(approve("FRA", "DEU"), changedBy)).rejects.toThrow(StatusConflictError);

        expect(state.posts).toEqual([]);
    });

    it("gives the reason DHIS2 reports when it refuses the import", async () => {
        const refusal = {
            message: "Request failed with status code 409",
            response: {
                data: { validationReport: { errorReports: [{ message: "E1095 no write access to the stage" }] } },
            },
        };
        const { store } = fakeTracker([entity("fra", "m|FRA|2025", ["PENDING_APPROVAL"])], { postError: refusal });

        await expect(store.save(approve("FRA"), changedBy)).rejects.toThrow(
            /nothing was changed: E1095 no write access/
        );
    });
});

describe("submissionsStoreSetting", () => {
    it("means the DataStore when missing, and refuses an unknown value", () => {
        expect(submissionsStoreSetting(undefined)).toBe("datastore");
        expect(submissionsStoreSetting("datastore")).toBe("datastore");
        expect(submissionsStoreSetting("program")).toBe("program");
        expect(() => submissionsStoreSetting("tracker")).toThrow(/Unknown dataSubmissionsStore "tracker"/);
    });
});
