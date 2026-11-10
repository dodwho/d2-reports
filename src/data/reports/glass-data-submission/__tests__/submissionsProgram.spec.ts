import {
    parseEntity,
    pickSubmission,
    ProgramSubmission,
    StoredEntity,
    submissionKey,
    submissionsProgramIds as ids,
    toWhoEvent,
} from "../submissionsProgram";

const key = "amcModule|FRA|2025";

type EventSpec = { stage: "country" | "who"; to: string; at: string; from?: string; by?: string };

function entity(id: string, events: EventSpec[], entityKey: string | null = key): StoredEntity {
    return {
        trackedEntity: id,
        attributes: entityKey ? [{ attribute: ids.keyAttribute, value: entityKey }] : [],
        enrollments: [
            {
                enrollment: `enr${id}`,
                program: ids.program,
                events: events.map(event => ({
                    programStage: event.stage === "who" ? ids.whoStage : ids.countryStage,
                    occurredAt: event.at,
                    dataValues: [
                        { dataElement: event.stage === "who" ? ids.whoDecision : ids.countryStatus, value: event.to },
                        ...(event.from ? [{ dataElement: ids.previousStatus, value: event.from }] : []),
                        ...(event.by ? [{ dataElement: ids.originalChangedBy, value: event.by }] : []),
                    ],
                })),
            },
        ],
    };
}

describe("the program ids (the same as in the GLASS app)", () => {
    it("are pinned", () => {
        expect(ids).toEqual({
            program: "tYrldPT7GdM",
            keyAttribute: "BnPCDGNd65z",
            countryStage: "cwfWfm0n6I3",
            whoStage: "jxQ1ORphos5",
            countryStatus: "VBr63uPhVGs",
            whoDecision: "YFEuB08kqGD",
            previousStatus: "SbqldKig1uJ",
            decidedKey: "ZCEMoKm6IKD",
            originalChangedBy: "MtsLg6HDKCg",
        });
    });
});

describe("parseEntity", () => {
    it("reads the key, the enrolment and the history from both stages, oldest first, status = latest event", () => {
        const { submission, problem } = parseEntity(
            entity("sub1", [
                {
                    stage: "who",
                    to: "APPROVED",
                    from: "PENDING_APPROVAL",
                    at: "2026-03-02T10:00:00.123",
                    by: "ann (u1)",
                },
                { stage: "country", to: "COMPLETE", at: "2026-03-01T09:00:00.000" },
                { stage: "country", to: "PENDING_APPROVAL", from: "COMPLETE", at: "2026-03-01T12:00:00.000" },
            ])
        );

        expect(problem).toBeUndefined();
        expect(submission).toEqual({
            id: "sub1",
            module: "amcModule",
            orgUnit: "FRA",
            period: "2025",
            enrollment: "enrsub1",
            status: "APPROVED",
            statusHistory: [
                { to: "COMPLETE", changedAt: "2026-03-01T09:00:00.000Z" },
                { to: "PENDING_APPROVAL", from: "COMPLETE", changedAt: "2026-03-01T12:00:00.000Z" },
                {
                    to: "APPROVED",
                    from: "PENDING_APPROVAL",
                    changedAt: "2026-03-02T10:00:00.123Z",
                    changedBy: { username: "ann", id: "u1" },
                },
            ],
        });
    });

    it.each([
        ["no key", entity("sub1", [{ stage: "country", to: "COMPLETE", at: "2026-03-01T09:00:00.000" }], null)],
        [
            "a key with four parts",
            entity("sub1", [{ stage: "country", to: "COMPLETE", at: "2026-03-01T09:00:00.000" }], "a|b|c|d"),
        ],
        ["no event", entity("sub1", [])],
        ["an unknown status", entity("sub1", [{ stage: "country", to: "DRAFT", at: "2026-03-01T09:00:00.000" }])],
    ])("names the entity instead of guessing when it has %s", (_name, stored) => {
        const { submission, problem } = parseEntity(stored);

        expect(submission).toBeUndefined();
        expect(problem).toContain("Data submission sub1");
    });
});

describe("pickSubmission", () => {
    const entry = (id: string, historyLength: number) =>
        ({ id, statusHistory: Array.from({ length: historyLength }) } as unknown as ProgramSubmission);

    it("takes the longest history, then the lowest id, as the GLASS app does", () => {
        expect(pickSubmission([entry("b", 2), entry("a", 1), entry("c", 2)])?.id).toBe("b");
        expect(pickSubmission([entry("b", 1), entry("a", 1)])?.id).toBe("a");
        expect(pickSubmission([])).toBeUndefined();
    });
});

describe("toWhoEvent", () => {
    const decided: ProgramSubmission = {
        id: "sub1",
        module: "amcModule",
        orgUnit: "FRA",
        period: "2025",
        enrollment: "enr1",
        status: "APPROVED",
        statusHistory: [
            { to: "PENDING_APPROVAL", changedAt: "2026-03-01T12:00:00.000Z" },
            {
                to: "APPROVED",
                from: "PENDING_APPROVAL",
                changedAt: "2026-03-02T10:00:00.123Z",
                changedBy: { id: "u1", username: "ann" },
            },
        ],
    };

    it("writes the last change as one completed WHO decision event of the entity's enrolment", () => {
        const event = toWhoEvent(decided);

        expect(event).toEqual({
            event: expect.stringMatching(/^[A-Za-z][A-Za-z0-9]{10}$/),
            program: ids.program,
            programStage: ids.whoStage,
            enrollment: "enr1",
            trackedEntity: "sub1",
            orgUnit: "FRA",
            occurredAt: "2026-03-02T10:00:00.123",
            status: "COMPLETED",
            dataValues: [
                { dataElement: ids.whoDecision, value: "APPROVED" },
                { dataElement: ids.decidedKey, value: key },
                { dataElement: ids.previousStatus, value: "PENDING_APPROVAL" },
                { dataElement: ids.originalChangedBy, value: "ann (u1)" },
            ],
        });
    });

    it("reads back as the same change", () => {
        const event = toWhoEvent(decided);
        const { submission } = parseEntity({
            trackedEntity: "sub1",
            attributes: [{ attribute: ids.keyAttribute, value: submissionKey(decided) }],
            enrollments: [{ enrollment: "enr1", program: ids.program, events: [event] }],
        });

        expect(submission?.statusHistory).toEqual([decided.statusHistory[1]]);
    });
});
