import { D2Api } from "../../../../types/d2-api";
import { ChangeSet } from "../../../../domain/reports/glass-enrolment/entities/ChangeSet";
import { EnrolmentD2Repository } from "../EnrolmentD2Repository";

/*
 * Replacing a focal point is a create import, then a delete import. If the create is refused, the delete must not
 * run: the country would be left with no focal point. A dry run still asks DHIS2 about every import.
 */

const details = { name: "New Person", email: "new@example.org", startDate: "2026-11-12" };
const replace = {
    statusChanges: [],
    contactChanges: [
        { countryId: "ou1", module: "AMR", eventId: "old1", before: { ...details, name: "Old Person" } },
        { countryId: "ou1", module: "AMR", eventId: "new1", after: details },
    ],
} as unknown as ChangeSet;

function repositoryWith(createErrors: string[]) {
    const repository = new EnrolmentD2Repository({} as D2Api);
    const sent: string[] = [];
    const internals = repository as unknown as Record<string, unknown>;
    internals["getProgramInfo"] = async () => ({ programId: "p1", programStageId: "s1" });
    internals["post"] = async (strategy: string, _type: string, items: unknown[]) => {
        if (items.length === 0) return { affected: 0, errors: [] };
        sent.push(strategy);
        return strategy === "CREATE" ? { affected: 0, errors: createErrors } : { affected: items.length, errors: [] };
    };
    return { repository, sent };
}

describe("EnrolmentD2Repository.apply", () => {
    it("does not delete the outgoing contact when the successor could not be created", async () => {
        const { repository, sent } = repositoryWith(["E1000 refused"]);

        const result = await repository.apply(replace, false);

        expect(sent).toEqual(["CREATE"]);
        expect(result.errors).toEqual(["E1000 refused"]);
    });

    it("runs the delete after a successful create", async () => {
        const { repository, sent } = repositoryWith([]);

        await repository.apply(replace, false);

        expect(sent).toEqual(["CREATE", "DELETE"]);
    });

    it("still validates every import in a dry run", async () => {
        const { repository, sent } = repositoryWith(["E1000 refused"]);

        await repository.apply(replace, true);

        expect(sent).toEqual(["CREATE", "DELETE"]);
    });
});
