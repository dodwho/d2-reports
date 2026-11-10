/**
 * End-to-end check of the Submission Report's program store against a real DHIS2.
 *
 * Four test submissions (period "ZZTEST") are created in the submissions program, each waiting for one decision, and
 * approve, reject, reopen and accept are run through `ProgramSubmissionsStore` (the code the report uses): check, save,
 * then a read back from DHIS2. A stale request and a request for a submission that does not exist are checked to write
 * nothing. Everything created is deleted at the end. The report's own actions are not run: they copy data and notify
 * the country's users.
 *
 * It refuses to run unless the server calls itself PREPROD.
 *
 *   GLASS_URL=https://portal-uat.who.int/dhis2-indiv GLASS_TOKEN=... yarn glass-submissions-program-smoke-test
 */
import _ from "lodash";
import { D2Api } from "../types/d2-api";
import { generateUid } from "../utils/uid";
import { ProgramSubmissionsStore } from "../data/reports/glass-data-submission/programSubmissionsStore";
import { submissionKey, submissionsProgramIds as ids } from "../data/reports/glass-data-submission/submissionsProgram";
import { SubmissionChange } from "../data/reports/glass-data-submission/submissionsStore";
import { Status } from "../domain/reports/glass-data-submission/entities/GLASSDataSubmissionItem";
import { StatusConflictError, StatusRefusedError } from "../domain/reports/glass-data-submission/entities/StatusChange";

/** The submissions program's tracked entity type (the GLASS app's `dataSubmissionsProgramIds.trackedEntityType`). */
const TRACKED_ENTITY_TYPE = "Z9UxMI2luNS";
const TEST_PERIOD = "ZZTEST";

type TestSubmission = { name: string; trackedEntity: string; waiting: Status; change: SubmissionChange };

async function main() {
    const baseUrl = required("GLASS_URL");
    const api = tokenApi(baseUrl, required("GLASS_TOKEN"));

    const info = await api.get<{ systemName: string }>("/system/info").getData();
    if (!/PREPROD/i.test(info.systemName)) {
        throw new Error(`Refusing to run: "${info.systemName}" is not a PREPROD instance.`);
    }
    const me = await api.get<{ id: string; username: string }>("/me", { fields: "id,username" }).getData();
    log(`Target: ${info.systemName} as ${me.username}`);

    const store = new ProgramSubmissionsStore(api);
    const modules = (await api.dataStore("glass").get<{ id: string; name: string }[]>("modules").getData()) ?? [];
    const moduleId = modules.find(module => module.name === "AMC")?.id;
    check(!!moduleId, "the AMC module is in glass/modules");

    // --- read: the whole module, as the list does ------------------------------------------------
    const started = Date.now();
    const stored = await store.read(moduleId as string);
    log(`  AMC: ${stored.length} submissions read in ${Date.now() - started} ms`);
    check(stored.length > 0, "the AMC module has submissions in the program");
    const orgUnit = stored[0]?.orgUnit as string;

    const submission = (name: string, waiting: Status, from: Status[], to: Status): TestSubmission => ({
        name,
        trackedEntity: generateUid(),
        waiting,
        change: {
            items: [{ module: moduleId as string, orgUnit, period: `${TEST_PERIOD}${name}` }],
            from,
            to,
        },
    });
    const tests = [
        submission("approve", "PENDING_APPROVAL", ["PENDING_APPROVAL"], "APPROVED"),
        submission("reject", "PENDING_APPROVAL", ["PENDING_APPROVAL"], "REJECTED"),
        submission("reopen", "PENDING_APPROVAL", ["PENDING_APPROVAL"], "NOT_COMPLETED"),
        submission("accept", "PENDING_UPDATE_APPROVAL", ["PENDING_UPDATE_APPROVAL"], "UPDATE_REQUEST_ACCEPTED"),
    ];
    const keyOf = (test: TestSubmission) => submissionKey(test.change.items[0] as never);

    try {
        await create(api, orgUnit, tests);
        const read = async (test: TestSubmission) => {
            const found = (await store.read(moduleId as string)).filter(s => s.id === test.trackedEntity);
            check(found.length === 1, `${test.name}: the submission is read back once`);
            return found[0];
        };

        for (const test of tests) {
            check((await read(test))?.status === test.waiting, `${test.name}: starts ${test.waiting}`);
        }

        // --- a decision changes only the selected submission ---------------------------------------
        const [approve, reject, reopen, accept] = tests as [
            TestSubmission,
            TestSubmission,
            TestSubmission,
            TestSubmission
        ];
        await store.check(approve.change, me);
        await store.save(approve.change, me);
        const approved = await read(approve);
        check(approved?.status === "APPROVED", "approve: the submission is APPROVED");
        const lastChange = _.last(approved?.statusHistory);
        check(
            lastChange?.from === "PENDING_APPROVAL" && lastChange.changedBy?.username === me.username,
            "approve: the history keeps the previous status and who changed it"
        );
        check((await read(reject))?.status === "PENDING_APPROVAL", "approve: another submission is not touched");

        const events = await rawEvents(api, keyOf(approve));
        const whoEvents = events.filter(event => event.programStage === ids.whoStage);
        check(whoEvents.length === 1, "approve: one event on the WHO decision stage");
        const value = (dataElement: string) =>
            whoEvents[0]?.dataValues?.find(dataValue => dataValue.dataElement === dataElement)?.value;
        check(value(ids.whoDecision) === "APPROVED", "approve: the event holds the decision");
        check(value(ids.decidedKey) === keyOf(approve), "approve: the event holds the key it decided");
        check(value(ids.previousStatus) === "PENDING_APPROVAL", "approve: the event holds the previous status");

        // --- a stale request is refused and writes nothing -----------------------------------------
        const eventsBefore = (await rawEvents(api, keyOf(approve))).length;
        await expectRefused(() => store.check(approve.change, me), StatusConflictError, "approve again: check refuses");
        await expectRefused(() => store.save(approve.change, me), StatusConflictError, "approve again: save refuses");
        check((await rawEvents(api, keyOf(approve))).length === eventsBefore, "approve again: nothing was written");

        const missing: SubmissionChange = {
            items: [{ module: moduleId as string, orgUnit, period: `${TEST_PERIOD}missing` }],
            from: ["PENDING_APPROVAL"],
            to: "APPROVED",
        };
        await expectRefused(() => store.check(missing, me), StatusConflictError, "unknown submission: check refuses");

        // --- the other decisions ---------------------------------------------------------------------
        for (const test of [reject, reopen, accept]) {
            await store.check(test.change, me);
            await store.save(test.change, me);
            check((await read(test))?.status === test.change.to, `${test.name}: the submission is ${test.change.to}`);
        }
        check((await read(approve))?.status === "APPROVED", "the first decision is still APPROVED");

        log("\nAll checks passed.");
    } finally {
        // A failed clean-up is reported but must not hide the error that got us here.
        await remove(api, tests).then(
            () => log("Test submissions deleted."),
            error => log(`Could not delete the test submissions (period ${TEST_PERIOD}*): ${error?.message ?? error}`)
        );
    }
}

/** Four tracked entities, each with a COMPLETE and then a waiting status on the country stage, as the GLASS app writes. */
async function create(api: D2Api, orgUnit: string, tests: TestSubmission[]) {
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString().replace(/Z$/, "");
    const countryEvent = (status: Status, occurredAt: string, from?: Status) => ({
        event: generateUid(),
        program: ids.program,
        programStage: ids.countryStage,
        orgUnit,
        occurredAt,
        status: "COMPLETED",
        dataValues: _.compact([
            { dataElement: ids.countryStatus, value: status },
            from ? { dataElement: ids.previousStatus, value: from } : undefined,
        ]),
    });

    const trackedEntities = tests.map(test => ({
        trackedEntity: test.trackedEntity,
        trackedEntityType: TRACKED_ENTITY_TYPE,
        orgUnit,
        attributes: [{ attribute: ids.keyAttribute, value: submissionKey(test.change.items[0] as never) }],
        enrollments: [
            {
                enrollment: generateUid(),
                trackedEntity: test.trackedEntity,
                program: ids.program,
                orgUnit,
                enrolledAt: at(120),
                occurredAt: at(120),
                status: "ACTIVE",
                events: [countryEvent("COMPLETE", at(90)), countryEvent(test.waiting, at(60), "COMPLETE")],
            },
        ],
    }));

    const report = await api.tracker
        .post({ importStrategy: "CREATE", atomicMode: "ALL" }, { trackedEntities } as never)
        .getData();
    check(report.status !== "ERROR", `${tests.length} test submissions created (${report.status})`);
}

async function remove(api: D2Api, tests: TestSubmission[]) {
    await api.tracker
        .post({ importStrategy: "DELETE" }, {
            trackedEntities: tests.map(test => ({ trackedEntity: test.trackedEntity })),
        } as never)
        .getData();
}

type RawEvent = { programStage?: string; dataValues?: { dataElement?: string; value?: string }[] };

async function rawEvents(api: D2Api, key: string): Promise<RawEvent[]> {
    const response = await api.tracker.trackedEntities
        .get({
            program: ids.program,
            ouMode: "ACCESSIBLE",
            filter: `${ids.keyAttribute}:eq:${key}`,
            fields: {
                trackedEntity: true,
                enrollments: { events: { programStage: true, dataValues: { dataElement: true, value: true } } },
            } as const,
        })
        .getData();
    return response.instances.flatMap(
        entity => entity.enrollments?.flatMap(enrollment => enrollment.events ?? []) ?? []
    );
}

async function expectRefused(
    action: () => Promise<void>,
    error: typeof StatusConflictError | typeof StatusRefusedError,
    description: string
) {
    const refused = await action().then(
        () => false,
        thrown => thrown instanceof error
    );
    check(refused, description);
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

function log(message: string) {
    // eslint-disable-next-line no-console
    console.log(message);
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
