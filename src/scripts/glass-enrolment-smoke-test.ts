/**
 * End-to-end check of the GLASS enrolment report's write paths against a real DHIS2.
 *
 * Every action the report offers is run through the same repository and use cases the UI uses —
 * enrol, focal point add/edit/replace, un-enrol, re-enrol, revert, merge, placeholder cleanup and
 * program assignment — and the result is read back from DHIS2 and checked. Everything created is
 * deleted at the end, including the history records.
 *
 * It refuses to run unless the server calls itself PREPROD, and it only touches one country and
 * module that must start with nothing enrolled.
 *
 *   GLASS_URL=https://portal-uat.who.int/dhis2-indiv GLASS_TOKEN=... yarn glass-enrolment-smoke-test
 */
import _ from "lodash";
import { D2Api } from "../types/d2-api";
import { EnrolmentD2Repository } from "../data/reports/glass-enrolment/EnrolmentD2Repository";
import { HISTORY_NAMESPACE } from "../data/common/entities/GlassEnrolment";
import { generateUid } from "../utils/uid";
import { User } from "../domain/common/entities/User";
import { ApplyChangeUseCase, revertChangesOf } from "../domain/reports/glass-enrolment/usecases/EnrolmentUseCases";
import {
    ChangeSet,
    emptyDetails,
    indexCells,
    planAddContact,
    planDeletePlaceholders,
    planEditContact,
    planEnrol,
    planMerge,
    planReplaceContact,
    planUnenrol,
} from "../domain/reports/glass-enrolment/entities/ChangeSet";
import { ContactDetails, EnrolmentCell, buildCells, keyOf } from "../domain/reports/glass-enrolment/entities/Enrolment";
import { HistoryAction, previousContacts } from "../domain/reports/glass-enrolment/entities/History";

const COUNTRY_CODE = process.env.GLASS_TEST_COUNTRY ?? "AIA";
const MODULE = process.env.GLASS_TEST_MODULE ?? "EGASP";
const BLOCKED_CODE = "GIB";

async function main() {
    const baseUrl = required("GLASS_URL");
    const api = tokenApi(baseUrl, required("GLASS_TOKEN"));

    const info = await api.get<{ systemName: string }>("/system/info").getData();
    if (!/PREPROD/i.test(info.systemName)) {
        throw new Error(`Refusing to run: "${info.systemName}" is not a PREPROD instance.`);
    }
    const me = await api.get<User>("/me", { fields: "id,username" }).getData();
    log(`Target: ${info.systemName} as ${me.username}`);

    const repository = new EnrolmentD2Repository(api);
    const useCase = new ApplyChangeUseCase(repository);
    const modules = await repository.getModules();
    const moduleNames = modules.map(module => module.name);

    const createdTrackedEntities = new Set<string>();
    const createdHistory: string[] = [];
    let countryId = "";

    const read = async (): Promise<EnrolmentCell> => {
        const snapshot = await new EnrolmentD2Repository(api).getSnapshot([MODULE]);
        const country = snapshot.countries.find(c => c.code === COUNTRY_CODE);
        if (!country) throw new Error(`No country with code ${COUNTRY_CODE}`);
        countryId = country.id;
        const cells = buildCells(snapshot.countries, [MODULE], snapshot.enrolments, snapshot.assignedOrgUnitIds);
        return indexCells(cells)[keyOf({ countryId, module: MODULE })] as EnrolmentCell;
    };

    const run = async (action: HistoryAction, changes: ChangeSet, extra: { revertOf?: string } = {}) => {
        const dry = await repository.apply(changes, true);
        check(_.isEmpty(dry.errors), `${action}: DHIS2 validates the change (${dry.errors.join("; ")})`);

        changes.statusChanges
            .filter(c => c.from === "NONE")
            .forEach(c => createdTrackedEntities.add(c.trackedEntityId));
        const before = new Set((await repository.getHistory()).map(record => record.id));
        const result = await useCase.execute({
            action,
            changes,
            countryNames: {},
            user: me,
            newId: generateUid,
            ...extra,
        });
        createdHistory.push(...(await repository.getHistory()).map(r => r.id).filter(id => !before.has(id)));

        check(_.isEmpty(result.errors), `${action}: applied (${result.errors.join("; ")})`);
        return result;
    };

    try {
        // --- reads ---------------------------------------------------------------------------
        const [access, geometries] = await Promise.all([repository.getAccess(modules), repository.getGeometries()]);
        check(Object.keys(access).length === modules.length, "user coverage computed for every module");
        check(geometries.length > 200, `country shapes load (${geometries.length})`);

        let cell = await read();
        check(cell.status === "not-enrolled", `${COUNTRY_CODE}/${MODULE} starts with nothing enrolled`);

        const blocked = (await repository.getSnapshot(moduleNames)).countries.find(c => c.code === BLOCKED_CODE);
        if (blocked) {
            const blockedCells = indexCells(
                buildCells([blocked], [MODULE], [], (await repository.getSnapshot([MODULE])).assignedOrgUnitIds)
            );
            const plan = planEnrol([{ countryId: blocked.id, module: MODULE }], blockedCells, today(), generateUid);
            check(plan.lines[0]?.reason === "blocked", `${BLOCKED_CODE} is skipped as not in the program`);
        }

        // --- enrol ---------------------------------------------------------------------------
        await run(
            "enrol",
            planEnrol([{ countryId, module: MODULE }], indexCells([cell]), "2026-01-15", generateUid).changes
        );
        cell = await read();
        check(cell.status === "enrolled-no-contact", "enrol: pair is active");
        check(cell.enrolledAt === "2026-01-15", "enrol: chosen enrolment date kept");
        const firstEnrolment = cell.enrolments[0]?.enrollmentId;

        // --- focal points --------------------------------------------------------------------
        const full: ContactDetails = {
            firstName: "Smoke",
            familyName: "Test",
            function: "Focal point",
            email: "smoke.test@example.org",
            telephone: "+41 22 000 0000",
            institution: "Test institute",
            address: "1 Test street",
            city: "Geneva",
            zipCode: "1211",
            language: "English",
            startDate: "2026-01-20",
        };
        await run("contact-add", planAddContact(cell, full, generateUid));
        cell = await read();
        const added = cell.contacts[0];
        check(cell.status === "enrolled" && Boolean(added), "contact-add: focal point present");
        check(
            _.isEqual(_.omit(added, ["id", "enrollmentId", "trackedEntityId", "updatedAt"]), full),
            "contact-add: all ten fields round-trip"
        );

        await run("contact-edit", planEditContact(added!, cell, { ...full, telephone: "+41 22 111 1111" }));
        cell = await read();
        check(cell.contacts[0]?.telephone === "+41 22 111 1111", "contact-edit: change saved");
        check(cell.contacts[0]?.address === "1 Test street", "contact-edit: untouched fields kept");

        await run(
            "contact-replace",
            planReplaceContact(
                cell.contacts[0]!,
                cell,
                { ...full, firstName: "Successor", email: "next@example.org", startDate: "2026-02-01" },
                generateUid
            )
        );
        cell = await read();
        check(
            cell.contacts.length === 1 && cell.contacts[0]?.firstName === "Successor",
            "contact-replace: successor current"
        );
        check(
            previousContacts(await repository.getHistory()).some(
                c => c.countryId === countryId && c.firstName === "Smoke"
            ),
            "contact-replace: outgoing person listed as previous"
        );

        // --- un-enrol, re-enrol, revert ------------------------------------------------------
        await run("unenrol", planUnenrol([{ countryId, module: MODULE }], indexCells([cell])).changes);
        cell = await read();
        check(cell.status === "inactive", "unenrol: pair inactive");
        check(cell.contacts[0]?.firstName === "Successor", "unenrol: focal point kept");

        await run(
            "enrol",
            planEnrol([{ countryId, module: MODULE }], indexCells([cell]), today(), generateUid).changes
        );
        cell = await read();
        check(cell.status === "enrolled", "re-enrol: pair active again");
        check(
            cell.enrolments.length === 1 && cell.enrolments[0]?.enrollmentId === firstEnrolment,
            "re-enrol: revived the same enrolment instead of creating another"
        );

        const reEnrolRecord = _.maxBy(
            (await repository.getHistory()).filter(r => r.action === "enrol" && r.status === "applied"),
            r => r.at
        )!;
        await run("revert", revertChangesOf(reEnrolRecord, generateUid), { revertOf: reEnrolRecord.id });
        cell = await read();
        check(cell.status === "inactive", "revert: re-enrolment undone");

        // --- merge -----------------------------------------------------------------------------
        await run(
            "enrol",
            planEnrol([{ countryId, module: MODULE }], indexCells([cell]), today(), generateUid).changes
        );
        cell = await read();
        const duplicate = {
            countryId,
            module: MODULE,
            trackedEntityId: generateUid(),
            enrollmentId: generateUid(),
            enrolledAt: "2026-03-01",
            occurredAt: "2026-03-01",
            from: "NONE" as const,
            to: "ACTIVE" as const,
        };
        // The report itself refuses to create a second enrolment for an enrolled pair, so the
        // duplicate is written straight through the repository, as a stray manual one would be.
        const refused = await useCase.execute({
            action: "enrol",
            changes: { statusChanges: [duplicate], contactChanges: [] },
            countryNames: {},
            user: me,
            newId: generateUid,
        });
        check(
            refused.conflicts?.[0]?.reason === "already-enrolled" && refused.affected === 0,
            "stale plan: a second enrolment of an enrolled pair is refused, nothing written"
        );
        createdTrackedEntities.add(duplicate.trackedEntityId);
        const direct = await repository.apply({ statusChanges: [duplicate], contactChanges: [] }, false);
        check(_.isEmpty(direct.errors), "merge: duplicate written for the test");
        await run("contact-add", {
            statusChanges: [],
            contactChanges: [
                {
                    countryId,
                    module: MODULE,
                    trackedEntityId: duplicate.trackedEntityId,
                    enrollmentId: duplicate.enrollmentId,
                    eventId: generateUid(),
                    after: { ...full, firstName: "OnDuplicate", email: "dup@example.org" },
                },
            ],
        });
        cell = await read();
        check(_.uniqBy(cell.enrolments, e => e.trackedEntityId).length === 2, "merge: duplicate set up");

        await run("merge", planMerge(cell.enrolments, generateUid));
        cell = await read();
        check(cell.enrolments.filter(e => e.status === "ACTIVE").length === 1, "merge: one enrolment left active");
        check(
            cell.contacts.some(c => c.firstName === "OnDuplicate"),
            "merge: duplicate's focal point copied across"
        );

        // --- placeholders --------------------------------------------------------------------
        await run("contact-add", planAddContact(cell, emptyDetails("2026-04-01"), generateUid));
        cell = await read();
        check(_.sumBy(cell.enrolments, e => e.placeholderIds.length) === 1, "placeholder: empty entry recognised");
        await run("placeholders-delete", planDeletePlaceholders([cell]));
        cell = await read();
        check(_.sumBy(cell.enrolments, e => e.placeholderIds.length) === 0, "placeholder: empty entry deleted");

        // --- program assignment (metadata) ---------------------------------------------------
        const { canEditProgram } = await repository.getSnapshot([MODULE]);
        if (blocked && !canEditProgram) {
            log(`  --  assign: skipped, this account may not edit the enrolment program's metadata`);
        } else if (blocked) {
            const assigned = await repository.assignToProgram([blocked.id]);
            check(
                _.isEmpty(assigned.errors),
                `assign: ${BLOCKED_CODE} added to the program (${assigned.errors.join("; ")})`
            );
            const after = await new EnrolmentD2Repository(api).getSnapshot([MODULE]);
            check(after.assignedOrgUnitIds.has(blocked.id), "assign: DHIS2 reports it assigned");
            check(after.assignedOrgUnitIds.size > 100, "assign: the program's other org units are intact");

            await api.delete(`/programs/${await programId(api)}/organisationUnits/${blocked.id}`).getData();
            const restored = await new EnrolmentD2Repository(api).getSnapshot([MODULE]);
            check(!restored.assignedOrgUnitIds.has(blocked.id), "assign: undone");
        }

        log("\nAll checks passed.");
    } finally {
        // --- cleanup ------------------------------------------------------------------------
        // Every step runs whatever happened before it, and a failing step is reported rather
        // than thrown, so cleanup never hides the error that stopped the checks.
        const attempt = async (label: string, step: () => Promise<unknown>) => {
            try {
                await step();
            } catch (error) {
                log(`  cleanup failed — ${label}: ${String((error as Error)?.message ?? error)}`);
            }
        };

        const trackedEntities = [...createdTrackedEntities].map(trackedEntity => ({ trackedEntity }));
        if (!_.isEmpty(trackedEntities)) {
            await attempt("tracked entities", () =>
                api.tracker.post({ importStrategy: "DELETE" }, { trackedEntities } as never).getData()
            );
        }
        for (const key of _.uniq(createdHistory)) {
            await attempt(`history ${key}`, () => api.delete(`/dataStore/${HISTORY_NAMESPACE}/${key}`).getData());
        }
        await attempt("final state", async () => {
            const leftover = countryId ? (await read()).status : "unknown";
            log(
                `Cleanup: ${trackedEntities.length} tracked entities and ${
                    _.uniq(createdHistory).length
                } history records deleted; pair now ${leftover}.`
            );
        });
    }
}

async function programId(api: D2Api): Promise<string> {
    const general = await api.dataStore("glass").get<{ enrolmentProgram?: string }>("general").getData();
    return general?.enrolmentProgram ?? "oo0bqS0AqMI";
}

function tokenApi(baseUrl: string, token: string): D2Api {
    const api = new D2Api({ baseUrl, auth: { username: "_", password: "_" } });
    [api.baseConnection, api.apiConnection].forEach(connection => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const target = connection as any;
        const request = target.request.bind(target);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target.request = (options: any) =>
            request({ ...options, headers: { ...options.headers, Authorization: `ApiToken ${token}` } });
    });
    return api;
}

function check(condition: boolean, description: string) {
    if (!condition) throw new Error(`FAILED: ${description}`);
    log(`  ok  ${description}`);
}

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Set ${name}`);
    return value;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function log(message: string) {
    // eslint-disable-next-line no-console
    console.log(message);
}

main().catch(error => {
    log(String(error?.message ?? error));
    process.exit(1);
});
