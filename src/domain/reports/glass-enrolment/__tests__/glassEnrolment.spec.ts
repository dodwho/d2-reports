import {
    Contact,
    Country,
    Enrolment,
    EnrolmentStatus,
    GlassModule,
    administeredModules,
    buildCells,
    hasDetails,
    contactsShownFor,
    isStale,
    keyOf,
} from "../entities/Enrolment";
import {
    ChangeSet,
    contactProblems,
    detailsOf,
    emptyDetails,
    findConflicts,
    indexCells,
    invertChangeSet,
    planAddContact,
    planDeletePlaceholders,
    planEnrol,
    planMerge,
    planRemoveContact,
    planReplaceContact,
    planUnenrol,
} from "../entities/ChangeSet";
import { HistoryRecord, canRevert, laterConflicts, previousContacts } from "../entities/History";
import { historyKey } from "../usecases/EnrolmentUseCases";

const idGenerator = () => {
    let n = 0;
    return () => `new${++n}`;
};

const country = (id: string): Country => ({ id, name: id, code: id, region: "EUR" });

function contact(id: string, overrides: Partial<Contact> = {}): Contact {
    return {
        ...emptyDetails("2024-01-01"),
        id,
        enrollmentId: "en",
        trackedEntityId: "te",
        updatedAt: "2025-01-01T00:00:00.000",
        firstName: "First",
        familyName: id,
        email: `${id}@who.int`,
        ...overrides,
    };
}

function enrolment(id: string, status: EnrolmentStatus, overrides: Partial<Enrolment> = {}): Enrolment {
    return {
        trackedEntityId: `te-${id}`,
        enrollmentId: id,
        countryId: "ESP",
        module: "AMC",
        status,
        enrolledAt: "2024-01-01",
        occurredAt: "2024-01-01",
        contacts: [],
        placeholderIds: [],
        ...overrides,
    };
}

function cellsFor(enrolments: Enrolment[], assigned = ["ESP", "FRA"]) {
    return indexCells(buildCells([country("ESP"), country("FRA")], ["AMC"], enrolments, new Set(assigned)));
}

const esp = { countryId: "ESP", module: "AMC" };
const fra = { countryId: "FRA", module: "AMC" };

describe("buildCells", () => {
    it("classifies every pair, including the ones with nothing", () => {
        const cells = buildCells(
            [country("ESP"), country("FRA"), country("GIB"), country("DEU")],
            ["AMC"],
            [
                enrolment("a", "ACTIVE", { contacts: [contact("c1")] }),
                enrolment("b", "COMPLETED", { countryId: "FRA" }),
                enrolment("c", "ACTIVE", { countryId: "DEU" }),
            ],
            new Set(["ESP", "FRA", "DEU"])
        );

        const status = (id: string) => cells.find(cell => cell.country.id === id)?.status;
        expect(status("ESP")).toBe("enrolled");
        expect(status("FRA")).toBe("inactive");
        expect(status("GIB")).toBe("blocked");
        expect(status("DEU")).toBe("enrolled-no-contact");
    });

    it("counts a pair as enrolled when any one of its duplicates is active", () => {
        const cells = cellsFor([enrolment("a", "CANCELLED"), enrolment("b", "ACTIVE")]);
        expect(cells[keyOf(esp)]?.status).toBe("enrolled-no-contact");
    });
});

describe("contactsShownFor", () => {
    it("uses active enrolments only, as GLASS does", () => {
        const shown = contactsShownFor([
            enrolment("a", "ACTIVE", { contacts: [contact("current")] }),
            enrolment("b", "CANCELLED", { contacts: [contact("old")] }),
        ]);
        expect(shown.map(c => c.id)).toEqual(["current"]);
    });

    it("falls back to the latest enrolment when none is active", () => {
        const shown = contactsShownFor([
            enrolment("a", "CANCELLED", { enrolledAt: "2020-01-01", contacts: [contact("older")] }),
            enrolment("b", "CANCELLED", { enrolledAt: "2023-01-01", contacts: [contact("newer")] }),
        ]);
        expect(shown.map(c => c.id)).toEqual(["newer"]);
    });
});

describe("planEnrol", () => {
    it("creates a new enrolment where none exists", () => {
        const plan = planEnrol([esp], cellsFor([]), "2026-09-30", idGenerator());

        expect(plan.lines).toEqual([{ ...esp, outcome: "create" }]);
        expect(plan.changes.statusChanges).toEqual([
            expect.objectContaining({ from: "NONE", to: "ACTIVE", enrolledAt: "2026-09-30", enrollmentId: "new2" }),
        ]);
    });

    it("revives the latest inactive enrolment instead of creating a duplicate", () => {
        const plan = planEnrol(
            [esp],
            cellsFor([
                enrolment("old", "CANCELLED", { enrolledAt: "2019-01-01" }),
                enrolment("recent", "COMPLETED", { enrolledAt: "2024-01-01" }),
            ]),
            "2026-09-30",
            idGenerator()
        );

        expect(plan.lines[0]?.outcome).toBe("revive");
        expect(plan.changes.statusChanges).toEqual([
            expect.objectContaining({ enrollmentId: "recent", from: "COMPLETED", to: "ACTIVE" }),
        ]);
    });

    it("skips pairs already enrolled and pairs whose org unit is not in the program", () => {
        const plan = planEnrol([esp, fra], cellsFor([enrolment("a", "ACTIVE")], ["ESP"]), "2026-09-30", idGenerator());

        expect(plan.lines.map(line => line.reason)).toEqual(["already-enrolled", "blocked"]);
        expect(plan.changes.statusChanges).toEqual([]);
    });
});

describe("planUnenrol", () => {
    it("cancels every active enrolment and deletes nothing", () => {
        const plan = planUnenrol(
            [esp, fra],
            cellsFor([enrolment("a", "ACTIVE"), enrolment("b", "ACTIVE"), enrolment("c", "CANCELLED")])
        );

        expect(plan.lines.map(line => line.outcome)).toEqual(["cancel", "skip"]);
        expect(plan.changes.statusChanges.map(change => [change.enrollmentId, change.to])).toEqual([
            ["a", "CANCELLED"],
            ["b", "CANCELLED"],
        ]);
    });
});

describe("planMerge", () => {
    it("keeps the oldest active enrolment and copies across only contacts it lacks", () => {
        const changes = planMerge(
            [
                enrolment("newest", "ACTIVE", {
                    enrolledAt: "2024-01-01",
                    contacts: [contact("same", { email: "A@who.int" }), contact("extra")],
                }),
                enrolment("oldest-inactive", "CANCELLED", { enrolledAt: "2019-01-01" }),
                enrolment("oldest-active", "ACTIVE", {
                    enrolledAt: "2020-01-01",
                    contacts: [contact("kept", { email: "a@who.int" })],
                }),
            ],
            idGenerator()
        );

        expect(changes.statusChanges.map(change => change.enrollmentId)).toEqual(["newest"]);
        expect(changes.contactChanges).toEqual([
            expect.objectContaining({
                enrollmentId: "oldest-active",
                after: expect.objectContaining({ familyName: "extra" }),
            }),
        ]);
    });

    it("does nothing for a pair with a single tracked entity", () => {
        expect(planMerge([enrolment("a", "ACTIVE")], idGenerator())).toEqual({ statusChanges: [], contactChanges: [] });
    });
});

describe("contact plans", () => {
    const cell = cellsFor([enrolment("a", "ACTIVE", { contacts: [contact("c1", { enrollmentId: "a" })] })])[
        keyOf(esp)
    ]!;
    const existing = cell.contacts[0]!;

    it("attaches a new contact to the active enrolment", () => {
        const changes = planAddContact(cell, detailsOf(contact("n")), idGenerator());
        expect(changes.contactChanges).toEqual([expect.objectContaining({ enrollmentId: "a", eventId: "new1" })]);
    });

    it("records the outgoing person's details when replacing", () => {
        const changes = planReplaceContact(existing, cell, detailsOf(contact("successor")), idGenerator());

        expect(changes.contactChanges).toEqual([
            expect.objectContaining({ eventId: "c1", before: expect.objectContaining({ familyName: "c1" }) }),
            expect.objectContaining({ eventId: "new1", after: expect.objectContaining({ familyName: "successor" }) }),
        ]);
        expect(changes.contactChanges[0]?.after).toBeUndefined();
    });

    it("reports what stops a form being saved", () => {
        const isValid = (email: string) => email.includes("@");
        expect(contactProblems(emptyDetails("bad"), isValid)).toEqual(["name-or-email-required", "invalid-date"]);
        expect(contactProblems({ ...emptyDetails("2024-01-01"), email: "nope" }, isValid)).toEqual(["invalid-email"]);
    });

    it("targets only empty events when cleaning placeholders", () => {
        const withPlaceholders = cellsFor([enrolment("a", "ACTIVE", { placeholderIds: ["p1", "p2"] })]);
        expect(
            planDeletePlaceholders(Object.values(withPlaceholders) as never).contactChanges.map(c => c.eventId)
        ).toEqual(["p1", "p2"]);
    });
});

describe("invertChangeSet", () => {
    it("cancels, rather than deletes, an enrolment the original created", () => {
        const created = planEnrol([esp], cellsFor([]), "2026-09-30", idGenerator()).changes;
        expect(invertChangeSet(created, idGenerator()).statusChanges).toEqual([
            expect.objectContaining({ from: "ACTIVE", to: "CANCELLED" }),
        ]);
    });

    it("restores the previous status of a revived or cancelled enrolment", () => {
        const revived = planEnrol([esp], cellsFor([enrolment("a", "COMPLETED")]), "2026-09-30", idGenerator()).changes;
        expect(invertChangeSet(revived, idGenerator()).statusChanges[0]).toEqual(
            expect.objectContaining({ from: "ACTIVE", to: "COMPLETED" })
        );
    });

    it("mirrors contact edits and recreates removed contacts under a new id", () => {
        const cell = cellsFor([enrolment("a", "ACTIVE", { contacts: [contact("c1")] })])[keyOf(esp)]!;
        const removal = planRemoveContact(cell.contacts[0]!, cell);

        const inverse = invertChangeSet(removal, idGenerator());
        expect(inverse.contactChanges).toEqual([
            expect.objectContaining({ eventId: "new1", after: expect.objectContaining({ familyName: "c1" }) }),
        ]);
        expect(inverse.contactChanges[0]?.before).toBeUndefined();

        // Undoing the undo removes the recreated contact again.
        expect(invertChangeSet(inverse, idGenerator()).contactChanges[0]).toEqual(
            expect.objectContaining({ eventId: "new1", before: expect.objectContaining({ familyName: "c1" }) })
        );
    });
});

describe("history", () => {
    const record = (
        id: string,
        at: string,
        changes: ChangeSet,
        overrides: Partial<HistoryRecord> = {}
    ): HistoryRecord => ({
        id,
        at,
        by: "admin",
        action: "contact-remove",
        status: "applied",
        errors: [],
        changes,
        assignedCountryIds: [],
        countryNames: {},
        ...overrides,
    });

    const cell = cellsFor([enrolment("a", "ACTIVE", { contacts: [contact("c1")] })])[keyOf(esp)]!;
    const removal = planRemoveContact(cell.contacts[0]!, cell);

    it("lists removed contacts as previous until the removal is reverted", () => {
        const removed = record("r1", "2026-01-01", removal);
        expect(previousContacts([removed]).map(c => c.familyName)).toEqual(["c1"]);

        const undone = record("r2", "2026-02-01", invertChangeSet(removal, idGenerator()), {
            action: "revert",
            revertOf: "r1",
        });
        expect(previousContacts([removed, undone])).toEqual([]);
        expect(canRevert(removed, [removed, undone])).toBe(false);
    });

    it("never offers to revert failed records or metadata changes", () => {
        const failed = record("f", "2026-01-01", removal, { status: "failed" });
        const assign = record("m", "2026-01-01", removal, { action: "assign-program" });
        expect(canRevert(failed, [failed])).toBe(false);
        expect(canRevert(assign, [assign])).toBe(false);
    });

    it("warns about later changes to the same items", () => {
        const first = record("r1", "2026-01-01", removal);
        const later = record("r2", "2026-03-01", removal);
        const earlier = record("r0", "2025-01-01", removal);
        expect(laterConflicts(first, [earlier, first, later]).map(r => r.id)).toEqual(["r2"]);
    });
});

describe("historyKey", () => {
    it("is free of the dots DHIS2 would cut a datastore key at, and sorts by time", () => {
        const earlier = historyKey("2026-09-30T13:51:18.123Z", "abc");
        const later = historyKey("2026-09-30T13:51:18.456Z", "abc");

        expect(earlier).toBe("20260930T135118123Z-abc");
        expect(earlier).not.toMatch(/[.:]/);
        expect(earlier < later).toBe(true);
    });
});

describe("isStale", () => {
    it("flags contacts not updated for two years", () => {
        const now = new Date("2026-09-30");
        expect(isStale(contact("a", { updatedAt: "2024-09-01T00:00:00" }), now)).toBe(true);
        expect(isStale(contact("b", { updatedAt: "2025-09-01T00:00:00" }), now)).toBe(false);
    });
});

describe("administeredModules", () => {
    const group = (id: string, name: string) => ({ id, name });
    const amc: GlassModule = {
        id: "amc",
        name: "AMC",
        userGroups: {
            readAccess: [group("g-admin", "AMR-AMC admin"), group("g-vis", "AMR-AMC data visualizer")],
            captureAccess: [group("g-admin", "AMR-AMC admin"), group("g-cap", "AMR-AMC data capture")],
            approveAccess: [group("g-admin", "AMR-AMC admin"), group("g-cap", "AMR-AMC data capture")],
        },
    };

    it("counts only members of a module's own admin group", () => {
        expect(administeredModules([amc], new Set(["g-admin"]))).toEqual([amc]);
    });

    it("does not treat data capture staff as administrators, though they can approve", () => {
        expect(administeredModules([amc], new Set(["g-cap", "g-vis"]))).toEqual([]);
    });
});

describe("hasDetails", () => {
    it("treats an entry holding only an address or a language as real, so it is never deleted", () => {
        expect(hasDetails({ ...emptyDetails("2024-01-01"), address: "1 Main street" })).toBe(true);
        expect(hasDetails({ ...emptyDetails("2024-01-01"), language: "French" })).toBe(true);
        expect(hasDetails(emptyDetails("2024-01-01"))).toBe(false);
    });

    it("still asks the form for a name or an email", () => {
        const isValid = (email: string) => email.includes("@");
        expect(contactProblems({ ...emptyDetails("2024-01-01"), institution: "MoH" }, isValid)).toEqual([
            "name-or-email-required",
        ]);
    });
});

describe("findConflicts", () => {
    const planned = cellsFor([enrolment("a", "CANCELLED", { contacts: [contact("c1", { enrollmentId: "a" })] })]);

    it("finds nothing when DHIS2 still matches what was planned from", () => {
        const revive = planEnrol([esp], planned, "2026-09-30", idGenerator()).changes;
        expect(findConflicts(revive, [enrolment("a", "CANCELLED")])).toEqual([]);
    });

    it("refuses a revival someone else already made", () => {
        const revive = planEnrol([esp], planned, "2026-09-30", idGenerator()).changes;
        expect(findConflicts(revive, [enrolment("a", "ACTIVE")])).toEqual([{ ...esp, reason: "status-changed" }]);
    });

    it("refuses a new enrolment when someone else has enrolled the pair meanwhile", () => {
        const create = planEnrol([esp], cellsFor([]), "2026-09-30", idGenerator()).changes;
        expect(findConflicts(create, [enrolment("other", "ACTIVE")])).toEqual([{ ...esp, reason: "already-enrolled" }]);
    });

    it("refuses to overwrite or remove a contact edited or deleted by someone else", () => {
        const cell = planned[keyOf(esp)]!;
        const removal = planRemoveContact(cell.contacts[0]!, cell);

        const edited = [enrolment("a", "CANCELLED", { contacts: [contact("c1", { telephone: "+1 555" })] })];
        expect(findConflicts(removal, edited)).toEqual([{ ...esp, reason: "contact-changed" }]);
        expect(findConflicts(removal, [enrolment("a", "CANCELLED")])).toEqual([{ ...esp, reason: "contact-removed" }]);
        expect(findConflicts(removal, [enrolment("a", "CANCELLED", { contacts: [contact("c1")] })])).toEqual([]);
    });

    it("accepts deleting a placeholder that is still empty, not one someone has since filled in", () => {
        const changes = planDeletePlaceholders([
            cellsFor([enrolment("a", "ACTIVE", { placeholderIds: ["p1"] })])[keyOf(esp)]!,
        ]);

        expect(findConflicts(changes, [enrolment("a", "ACTIVE", { placeholderIds: ["p1"] })])).toEqual([]);
        expect(findConflicts(changes, [enrolment("a", "ACTIVE", { contacts: [contact("p1")] })])).toEqual([
            { ...esp, reason: "contact-changed" },
        ]);
    });
});
