import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT, FOLDER_URN, workflowRecord, reviewsServer, storeAsAutodeskDoes } from "./reviews-fixtures.mjs";
import { createReviewWorkflowTool, buildWorkflowRequest, compareStoredWithRequested } from "../tools/create-review-workflow.js";

const user = (id) => ({ type: "user", id });
const reviewer = (extra = {}) => ({ name: "Check", role: "reviewer", candidates: [user("USERANN")], timeAllowed: 2, dayType: "calendar_days", ...extra });
const approver = (extra = {}) => ({ name: "Sign-off", role: "approver", candidates: [user("USERBOB")], timeAllowed: 2, dayType: "calendar_days", ...extra });
const args = (overrides = {}, steps = [reviewer(), approver()]) => ({ projectId: PROJECT, name: "ZZ Test", steps: JSON.stringify(steps), ...overrides });
const create = (overrides, steps) => createReviewWorkflowTool.callback(args(overrides, steps));
const posted = (server) => server.posts()[0]?.body;

/** The call is refused with this text and nothing at all is sent to Autodesk (not even a read). */
async function assertRefused(t, overrides, steps, expected) {
    const server = reviewsServer(t);
    await assert.rejects(create(overrides, steps), (e) => { assert.match(e.message, expected); return true; });
    assert.equal(server.calls.length, 0, "a refused input makes no request");
}
/** The same arguments with the fault removed are accepted (so the refusal is about that fault alone). */
async function assertAccepted(t, overrides, steps) {
    const server = reviewsServer(t);
    const res = await create(overrides, steps);
    assert.equal(server.posts().length, 1);
    assert.equal(res.structuredContent.created, true);
    return posted(server);
}

// ---------------------------------------------------------------------------
// Every setting in one request = the body Autodesk accepted live
// ---------------------------------------------------------------------------

test("every setting: the tool builds the request Autodesk stored in full on the sandbox (live write 3, 2026-11-19)", async (t) => {
    const server = reviewsServer(t);
    const res = await createReviewWorkflowTool.callback({
        projectId: PROJECT,
        name: "ZZ TEST all settings",
        description: "Every workflow setting in one request.",
        notes: "Test only. Safe to switch off.",
        initiators: [{ type: "company", id: "542830416" }],
        steps: JSON.stringify([
            { name: "Single reviewer, working days", role: "reviewer", candidates: [user("USERJAMES")], timeAllowed: 2, dayType: "business_days" },
            { name: "Both must sign", role: "reviewer", candidates: [user("USERJAMES"), user("USERSHARED")], timeAllowed: 2, dayType: "calendar_days", groupReview: { enabled: true, type: "ALL" } },
            { name: "Any one", role: "reviewer", candidates: [user("USERJAMES"), user("USERSHARED"), { type: "role", id: "542830447" }], timeAllowed: 2, dayType: "calendar_days", groupReview: { enabled: true, type: "MINIMUM", min: 1 } },
            { name: "Owner approval", role: "approver", candidates: [user("USERJAMES")], timeAllowed: 2, dayType: "business_days" },
        ]),
        copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN, condition: "ALL", includeMarkups: true, allowOverride: false, disableOverrideMarkupSetting: false },
        additionalApprovalStatusOptions: [{ label: "Approved with comments", value: "APPROVED" }],
        additionalOptions: { initiatorEditPermissions: ["APPROVERS", "CLOSED_REVIEW_TITLE"], approverEditPermissions: ["APPROVERS"] },
    });
    const users = (...ids) => ids.map((autodeskId) => ({ autodeskId }));
    // The raw body of live write 3 (ids replaced), which Autodesk answered 201 and stored without change.
    assert.deepEqual(posted(server), {
        name: "ZZ TEST all settings",
        description: "Every workflow setting in one request.",
        notes: "Test only. Safe to switch off.",
        steps: [
            { name: "Initiator", type: "INITIATOR", candidates: { users: [], roles: [], companies: [{ autodeskId: "542830416" }] } },
            { name: "Single reviewer, working days", type: "REVIEWER", duration: 2, dueDateType: "WORKDAY", candidates: { users: users("USERJAMES"), roles: [], companies: [] } },
            { name: "Both must sign", type: "REVIEWER", duration: 2, dueDateType: "CALENDAR_DAY", groupReview: { enabled: true, type: "ALL" }, candidates: { users: users("USERJAMES", "USERSHARED"), roles: [], companies: [] } },
            { name: "Any one", type: "REVIEWER", duration: 2, dueDateType: "CALENDAR_DAY", groupReview: { enabled: true, type: "MINIMUM", min: 1 }, candidates: { users: users("USERJAMES", "USERSHARED"), roles: [{ autodeskId: "542830447" }], companies: [] } },
            { name: "Owner approval", type: "APPROVER", duration: 2, dueDateType: "WORKDAY", candidates: { users: users("USERJAMES"), roles: [], companies: [] } },
        ],
        copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN, condition: "ALL", includeMarkups: true, allowOverride: false, disableOverrideMarkupSetting: false },
        additionalApprovalStatusOptions: [{ label: "Approved with comments", value: "APPROVED" }],
        additionalOptions: { initiatorEditPermissions: ["APPROVERS", "CLOSED_REVIEW_TITLE"], approverEditPermissions: ["APPROVERS"] },
    });
    assert.equal(server.calls.length, 1, "no lookup without skipIfExists: one POST and nothing else");
    assert.equal(res.structuredContent.created, true);
    assert.equal(res.structuredContent.verified, true);
    assert.deepEqual(res.structuredContent.differences, []);
    assert.match(res.content[0].text, /Checked against Autodesk's response: day types, durations, group review, candidates, copy settings and the other requested settings all match what was asked\./);
});

// ---------------------------------------------------------------------------
// Both directions of every switch
// ---------------------------------------------------------------------------

test("copy on approval OFF (not supplied, and enabled:false): the body is today's fixed copyFilesOptions, no folder", async (t) => {
    const fixed = { enabled: false, allowOverride: false, condition: "ANY", includeMarkups: false, disableOverrideMarkupSetting: false };
    assert.deepEqual((await assertAccepted(t, {})).copyFilesOptions, fixed);
    assert.deepEqual((await assertAccepted(t, { copyFilesOptions: { enabled: false } })).copyFilesOptions, fixed);
});

test("copy on approval ON: folder, condition, markups, override and the markup lock are all sent", async (t) => {
    const body = await assertAccepted(t, { copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN, condition: "ALL", includeMarkups: true, allowOverride: true, disableOverrideMarkupSetting: true } });
    assert.deepEqual(body.copyFilesOptions, { enabled: true, allowOverride: true, condition: "ALL", includeMarkups: true, disableOverrideMarkupSetting: true, folderUrn: FOLDER_URN });
    const defaults = await assertAccepted(t, { copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN } });
    assert.deepEqual(defaults.copyFilesOptions, { enabled: true, allowOverride: false, condition: "ANY", includeMarkups: false, disableOverrideMarkupSetting: false, folderUrn: FOLDER_URN });
});

test("group review OFF (not supplied, and enabled:false): the step carries no groupReview key", async (t) => {
    assert.ok(!("groupReview" in (await assertAccepted(t, {})).steps[1]));
    const off = await assertAccepted(t, {}, [reviewer({ groupReview: { enabled: false } }), approver()]);
    assert.ok(!("groupReview" in off.steps[1]));
});

test("group review ON: ALL (everyone must respond) and MINIMUM (at least N)", async (t) => {
    const two = [user("USERANN"), user("USERBOB")];
    const all = await assertAccepted(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "ALL" } }), approver()]);
    assert.deepEqual(all.steps[1].groupReview, { enabled: true, type: "ALL" });
    const min = await assertAccepted(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "minimum", min: 2 } }), approver()]);
    assert.deepEqual(min.steps[1].groupReview, { enabled: true, type: "MINIMUM", min: 2 });
});

test("initiators NOT supplied: today's rule — initiatorUserId, else the first user of step 1", async (t) => {
    assert.deepEqual((await assertAccepted(t, {})).steps[0].candidates, { companies: [], roles: [], users: [{ autodeskId: "USERANN" }] });
    assert.deepEqual((await assertAccepted(t, { initiatorUserId: "USERZED" })).steps[0].candidates, { companies: [], roles: [], users: [{ autodeskId: "USERZED" }] });
});

test("initiators supplied: a company alone, a role alone, and a mix of all three", async (t) => {
    const company = await assertAccepted(t, { initiators: [{ type: "company", id: "542830416" }] });
    assert.deepEqual(company.steps[0], { name: "Initiator", type: "INITIATOR", candidates: { companies: [{ autodeskId: "542830416" }], roles: [], users: [] } });
    const role = await assertAccepted(t, { initiators: [{ type: "role", id: 542830447 }] });
    assert.deepEqual(role.steps[0].candidates, { companies: [], roles: [{ autodeskId: "542830447" }], users: [] });
    const mix = await assertAccepted(t, { initiators: [{ type: "company", id: "1" }, { type: "role", id: "2" }, user("USERZED"), { userId: "USERLEGACY" }] });
    assert.deepEqual(mix.steps[0].candidates, { companies: [{ autodeskId: "1" }], roles: [{ autodeskId: "2" }], users: [{ autodeskId: "USERZED" }, { autodeskId: "USERLEGACY" }] });
    // The step-1 user is NOT silently added as an initiator when initiators is given.
    assert.ok(!JSON.stringify(company.steps[0]).includes("USERANN"));
});

test("optional settings are sent only when supplied: notes, extra statuses, attributes, attribute options, edit permissions", async (t) => {
    const bare = await assertAccepted(t, {});
    assert.deepEqual(Object.keys(bare), ["name", "description", "steps", "copyFilesOptions"]);

    const full = await assertAccepted(t, {
        notes: "Read the brief first.",
        additionalApprovalStatusOptions: [{ label: "Approved with comments", value: "APPROVED" }, { label: "Revise and resubmit", value: "REJECTED" }],
        attachedAttributes: [{ id: 10272, required: true }, { id: 10273 }],
        updateAttributesOptions: { enableAttachedAttributes: true, updateSourceAndCopiedFiles: false, allowApproverToUpdateRejectedFiles: false },
        additionalOptions: { initiatorEditPermissions: ["REVIEWER_ASSIGNMENTS_AND_DURATION", "APPROVERS", "CLOSED_REVIEW_TITLE", "START_OWN_REVIEW"], approverEditPermissions: ["APPROVERS"], allowInitiatorToEdit: true },
    });
    assert.equal(full.notes, "Read the brief first.");
    assert.deepEqual(full.additionalApprovalStatusOptions, [{ label: "Approved with comments", value: "APPROVED" }, { label: "Revise and resubmit", value: "REJECTED" }]);
    assert.deepEqual(full.attachedAttributes, [{ id: 10272, required: true }, { id: 10273 }]);
    assert.deepEqual(full.updateAttributesOptions, { enableAttachedAttributes: true, updateSourceAndCopiedFiles: false, allowApproverToUpdateRejectedFiles: false });
    assert.deepEqual(full.additionalOptions, { initiatorEditPermissions: ["REVIEWER_ASSIGNMENTS_AND_DURATION", "APPROVERS", "CLOSED_REVIEW_TITLE", "START_OWN_REVIEW"], approverEditPermissions: ["APPROVERS"], allowInitiatorToEdit: true });
});

test("day type spellings: business/working → WORKDAY, calendar → CALENDAR_DAY, Autodesk's own values pass", async (t) => {
    for (const [given, expected] of [["business_days", "WORKDAY"], ["working_days", "WORKDAY"], ["WORKDAY", "WORKDAY"], ["Business_Days", "WORKDAY"], ["calendar_days", "CALENDAR_DAY"], ["CALENDAR_DAY", "CALENDAR_DAY"]]) {
        const body = await assertAccepted(t, {}, [reviewer({ dayType: given }), approver({ day_type: given, dayType: undefined })]);
        assert.deepEqual(body.steps.slice(1).map((s) => s.dueDateType), [expected, expected], given);
    }
});

test("legacy step keys still work: step_name, time_allowed, day_type, upper-case role, default 5 days", async (t) => {
    const body = await assertAccepted(t, {}, [
        { step_name: "Check", role: "REVIEWER", candidates: [user("USERANN")], time_allowed: 4, day_type: "calendar_days" },
        { name: "Sign", role: "Approver", candidates: [user("USERBOB")] },
    ]);
    assert.deepEqual(body.steps[1], { name: "Check", type: "REVIEWER", duration: 4, dueDateType: "CALENDAR_DAY", candidates: { users: [{ autodeskId: "USERANN" }], roles: [], companies: [] } });
    assert.deepEqual(body.steps[2], { name: "Sign", type: "APPROVER", duration: 5, dueDateType: "WORKDAY", candidates: { users: [{ autodeskId: "USERBOB" }], roles: [], companies: [] } });
});

test("a one-step workflow (initiator + approver) is accepted; a digit-string timeAllowed is read as a number", async (t) => {
    const body = await assertAccepted(t, {}, [approver({ timeAllowed: "7" })]);
    assert.deepEqual(body.steps.map((s) => s.type), ["INITIATOR", "APPROVER"]);
    assert.equal(body.steps[1].duration, 7);
});

test("stepOrder (a column the runbook's example carries) is still accepted on a step, and reported as not used", async (t) => {
    const server = reviewsServer(t);
    const res = await create({}, [reviewer({ stepOrder: 1 }), approver({ stepOrder: 2 })]);
    assert.equal(server.posts().length, 1);
    assert.deepEqual(res.structuredContent.ignoredStepKeys, ["stepOrder"]);
    assert.match(res.content[0].text, /Ignored step key\(s\) this tool does not use: stepOrder\./);
    assert.ok(!("stepOrder" in posted(server).steps[1]), "it is not sent to Autodesk");
});

// ---------------------------------------------------------------------------
// A10 — the request is checked before it is sent, naming the field
// ---------------------------------------------------------------------------

test("A10 order: the last step must be an approver", async (t) => {
    await assertRefused(t, {}, [reviewer(), reviewer({ name: "Second" })], /The last step must be an approver .* The last step given is a reviewer\. Nothing was sent/);
    await assertRefused(t, {}, [reviewer()], /The last step must be an approver/);
});

test("A10 order: only the last step may be an approver", async (t) => {
    await assertRefused(t, {}, [approver({ name: "Early" }), reviewer(), approver()], /^Step 1 is an approver but is not the last step\. Only the last step may be an approver/);
    await assertRefused(t, {}, [reviewer(), approver({ name: "Early" }), approver()], /^Step 2 is an approver but is not the last step/);
    await assertAccepted(t, {}, [reviewer(), reviewer({ name: "Second" }), approver()]);
});

test("A10 role: a step is a reviewer or an approver, nothing else", async (t) => {
    await assertRefused(t, {}, [reviewer({ role: "initiator" }), approver()], /^Step 1 \("Check"\) has role "initiator"\. A step's role is "reviewer" or "approver"/);
});

test("A10 duration: 1 to 99 whole days", async (t) => {
    for (const bad of [100, -1, 2.5, "soon", 1000]) {
        await assertRefused(t, {}, [reviewer({ timeAllowed: bad }), approver()], /^Step 1 \("Check"\) timeAllowed is .*; Autodesk accepts a whole number of days from 1 to 99/);
    }
    await assertRefused(t, {}, [reviewer(), approver({ timeAllowed: 100 })], /^Step 2 \("Sign-off"\) timeAllowed is 100/);
    for (const good of [1, 99]) {
        assert.equal((await assertAccepted(t, {}, [reviewer({ timeAllowed: good }), approver()])).steps[1].duration, good);
    }
});

test("A10 lengths: name ≤ 255, description and notes ≤ 4096, step name ≤ 255", async (t) => {
    await assertRefused(t, { name: "n".repeat(256) }, undefined, /^Workflow name is 256 characters; the limit is 255/);
    await assertRefused(t, { description: "d".repeat(4097) }, undefined, /^description is 4097 characters; the limit is 4096/);
    await assertRefused(t, { notes: "x".repeat(4097) }, undefined, /^notes is 4097 characters; the limit is 4096/);
    await assertRefused(t, {}, [reviewer({ name: "s".repeat(256) }), approver()], /name is 256 characters; the limit is 255/);
    await assertAccepted(t, { name: "n".repeat(255), description: "d".repeat(4096), notes: "x".repeat(4096) }, [reviewer({ name: "s".repeat(255) }), approver()]);
});

test("A10 extra statuses: at most 50, labels unique (case-insensitive, built-ins included), each with a label", async (t) => {
    const status = (i) => ({ label: `Status ${i}`, value: "APPROVED" });
    await assertRefused(t, { additionalApprovalStatusOptions: Array.from({ length: 51 }, (_, i) => status(i)) }, undefined, /^additionalApprovalStatusOptions has 51 entries; the limit is 50/);
    await assertRefused(t, { additionalApprovalStatusOptions: [status(1), { label: "status 1", value: "REJECTED" }] }, undefined, /additionalApprovalStatusOptions\[1\]\.label "status 1" is used twice/);
    await assertRefused(t, { additionalApprovalStatusOptions: [{ label: "Approved", value: "APPROVED" }] }, undefined, /label "Approved" is used twice \(labels must be unique, and "Approved" \/ "Rejected" are built in\)/);
    await assertRefused(t, { additionalApprovalStatusOptions: [{ label: "  ", value: "APPROVED" }] }, undefined, /additionalApprovalStatusOptions\[0\] has no label/);
    await assertRefused(t, { additionalApprovalStatusOptions: [{ label: "l".repeat(256), value: "APPROVED" }] }, undefined, /label is 256 characters; the limit is 255/);
    assert.equal((await assertAccepted(t, { additionalApprovalStatusOptions: Array.from({ length: 50 }, (_, i) => status(i)) })).additionalApprovalStatusOptions.length, 50);
});

test("A10 group review: reviewer steps only", async (t) => {
    await assertRefused(t, {}, [reviewer(), approver({ candidates: [user("A"), user("B")], groupReview: { enabled: true, type: "ALL" } })],
        /^Step 2 \("Sign-off"\) is an APPROVER step: group review applies to reviewer steps only/);
    // Off on an approver is not group review at all, and is accepted.
    await assertAccepted(t, {}, [reviewer(), approver({ groupReview: { enabled: false } })]);
});

test("A10 group review: at most 30 candidates when everyone must respond", async (t) => {
    const people = (n) => Array.from({ length: n }, (_, i) => user(`U${i}`));
    await assertRefused(t, {}, [reviewer({ candidates: people(31), groupReview: { enabled: true, type: "ALL" } }), approver()],
        /^Step 1 \("Check"\) has 31 candidates: group review type ALL allows at most 30/);
    assert.equal((await assertAccepted(t, {}, [reviewer({ candidates: people(30), groupReview: { enabled: true, type: "ALL" } }), approver()])).steps[1].candidates.users.length, 30);
});

test("A10 group review: MINIMUM needs min 1–30; type is ALL or MINIMUM; no unknown keys; enabled is a boolean", async (t) => {
    const two = [user("A"), user("B")];
    for (const min of [0, 31, 1.5, undefined, "2"]) {
        await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "MINIMUM", min } }), approver()], /groupReview\.min must be a whole number from 1 to 30 when type is MINIMUM/);
    }
    await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "SOME" } }), approver()], /groupReview\.type must be "ALL" .* or "MINIMUM"/);
    await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true } }), approver()], /groupReview\.type must be "ALL"/);
    await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "ALL", minimum: 2 } }), approver()], /groupReview has unknown key\(s\) minimum/);
    await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: { enabled: "yes", type: "ALL" } }), approver()], /groupReview\.enabled must be true or false/);
    await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: "ALL" }), approver()], /groupReview must be an object/);
});

test("A10 candidates: every candidate has an id and a known type — none is silently dropped", async (t) => {
    await assertRefused(t, {}, [reviewer({ candidates: [user("USERANN"), { type: "user" }] }), approver()], /^Step 1 \("Check"\) candidate 2 has no id/);
    await assertRefused(t, {}, [reviewer({ candidates: [user("USERANN"), { type: "group", id: "g1" }] }), approver()], /^Step 1 \("Check"\) candidate 2 has type "group"\. A candidate type is "user", "role" or "company"/);
    await assertRefused(t, {}, [reviewer({ candidates: [user("USERANN"), "USERBOB"] }), approver()], /^Step 1 \("Check"\) candidate 2 has no id/);
});

test("A10 candidates: a role or company UUID is refused — the Reviews API takes the member-group id", async (t) => {
    const uuid = "b5c6ec1f-cf32-462c-b424-7e5a22fba07c";
    await assertRefused(t, { initiatorUserId: "USERZED" }, [reviewer({ candidates: [{ type: "role", id: uuid }] }), approver()], /candidate 1: "b5c6ec1f-cf32-462c-b424-7e5a22fba07c" is the role's UUID\. The Reviews API takes the role's member-group id .* member_group_id from getProjectRolesTool/);
    await assertRefused(t, { initiators: [{ type: "company", id: uuid }] }, undefined, /^initiators candidate 1: .* is the company's UUID.* member_group_id from accProjectCompanyListTool/);
    // A user id is never a UUID in practice, and is not subject to this check.
    await assertAccepted(t, { initiators: [{ type: "company", id: "542830416" }] });
});

test("A10 copy: switched on without a folder is refused before calling Autodesk; a non-folder URN too", async (t) => {
    await assertRefused(t, { copyFilesOptions: { enabled: true } }, undefined, /^copyFilesOptions\.enabled is true but no folderUrn was given/);
    await assertRefused(t, { copyFilesOptions: { enabled: true, folderUrn: "urn:adsk.wipprodanz:fs.file:vf.abc?version=1" } }, undefined, /is not a folder URN/);
    await assertRefused(t, { copyFilesOptions: { enabled: true, folderUrn: "4.2.2 Design Coordination" } }, undefined, /is not a folder URN/);
});

test("A10 day type: an unknown value is refused, not guessed", async (t) => {
    await assertRefused(t, {}, [reviewer({ dayType: "weekdays" }), approver()], /^Step 1 \("Check"\) has dayType "weekdays"\. Use "business_days" \(working days\) or "calendar_days"/);
});

test("A10 initiators: not together with initiatorUserId", async (t) => {
    await assertRefused(t, { initiators: [user("USERZED")], initiatorUserId: "USERZED" }, undefined, /^Pass either initiators or initiatorUserId, not both/);
});

test("an unknown or misspelt setting is refused instead of silently dropped (strict input schema)", async (t) => {
    const server = reviewsServer(t);
    await assert.rejects(create({ copyFileOptions: { enabled: true, folderUrn: FOLDER_URN } }), /Unrecognized key\(s\) in object: 'copyFileOptions'/);
    await assert.rejects(create({ copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN, includeMarkup: true } }), /Unrecognized key\(s\) in object: 'includeMarkup'/);
    await assert.rejects(create({ additionalOptions: { initiatorEditPermissions: ["EVERYTHING"] } }), /Invalid enum value/);
    await assert.rejects(create({ additionalApprovalStatusOptions: [{ label: "Maybe", value: "PENDING" }] }), /Invalid enum value/);
    await assert.rejects(create({ attachedAttributes: [{ id: "10272" }] }), /Expected number/);
    await assert.rejects(create({ copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN, condition: "SOME" } }), /Invalid enum value/);
    await assert.rejects(create({ projectId: `${PROJECT}/../x` }), /projectId must be the project UUID/);
    assert.equal(server.calls.length, 0);
});

test("buildWorkflowRequest is pure: it builds the body without any request", () => {
    const { body, ignoredStepKeys } = buildWorkflowRequest(args());
    assert.deepEqual(body.steps.map((s) => s.type), ["INITIATOR", "REVIEWER", "APPROVER"]);
    assert.deepEqual(ignoredStepKeys, []);
});

// ---------------------------------------------------------------------------
// A11 — never create a duplicate
// ---------------------------------------------------------------------------

test("A11 skipIfExists, name found (ACTIVE): nothing is created; the existing workflow is returned", async (t) => {
    const existing = workflowRecord(3, { name: "ZZ Test" });
    const server = reviewsServer(t, { workflows: [workflowRecord(1), existing] });
    const res = await create({ skipIfExists: true });
    assert.equal(server.posts().length, 0, "no create was sent");
    assert.equal(res.structuredContent.created, false);
    assert.equal(res.structuredContent.skipped, true);
    assert.deepEqual(res.structuredContent.result, existing);
    assert.match(res.content[0].text, new RegExp(`^Workflow "ZZ Test" already exists \\(id ${existing.id}, ACTIVE\\) — nothing was created\\.`));
});

test("A11 skipIfExists, name found among INACTIVE workflows (not in Autodesk's default list): still nothing is created", async (t) => {
    const existing = workflowRecord(3, { name: "ZZ Test", status: "INACTIVE" });
    const server = reviewsServer(t, { workflows: [workflowRecord(1), existing] });
    const res = await create({ skipIfExists: true });
    assert.equal(server.posts().length, 0);
    assert.equal(res.structuredContent.created, false);
    assert.equal(res.structuredContent.result.id, existing.id);
    assert.deepEqual(server.listCalls().map((c) => [c.status, c.limit]), [["ACTIVE", "50"], ["INACTIVE", "50"], ["ACTIVE", "1"]], "both statuses are looked up, then the active count once more");
    assert.match(res.content[0].text, /already exists \(id .*, INACTIVE\)/);
});

test("A11 skipIfExists, name found on a later page (120 active workflows): found, nothing created", async (t) => {
    const many = Array.from({ length: 120 }, (_, i) => workflowRecord(i));
    many[117] = workflowRecord(117, { name: "ZZ Test" });
    const server = reviewsServer(t, { workflows: many });
    const res = await create({ skipIfExists: true });
    assert.equal(server.posts().length, 0);
    assert.equal(res.structuredContent.result.id, many[117].id);
});

test("A11 skipIfExists, name not found: the workflow is created, once", async (t) => {
    const server = reviewsServer(t, { workflows: [workflowRecord(1), workflowRecord(2, { status: "INACTIVE" })] });
    const res = await create({ skipIfExists: true });
    assert.equal(server.posts().length, 1);
    assert.equal(res.structuredContent.created, true);
    assert.equal(res.structuredContent.result.name, "ZZ Test");
    assert.ok(server.gets().length >= 2, "looked up first");
    assert.ok(server.calls.findIndex((c) => c.method === "POST") === server.calls.length - 1, "the create is the last call, after the lookup");
});

test("A11 skipIfExists: an existing workflow that differs from what was asked is reported, not hidden", async (t) => {
    const existing = workflowRecord(3, { name: "ZZ Test" }); // calendar days, Ann then Bob, copy off
    reviewsServer(t, { workflows: [existing] });
    const res = await create({ skipIfExists: true, copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN } }, [reviewer({ dayType: "business_days" }), approver()]);
    assert.equal(res.structuredContent.created, false);
    const fields = res.structuredContent.differences.map((d) => d.field);
    assert.ok(fields.includes('steps[1] ("Check").dueDateType'));
    assert.ok(fields.includes("copyFilesOptions.enabled"));
    assert.ok(fields.includes("copyFilesOptions.folderUrn"));
    assert.match(res.content[0].text, /WARNING — the existing workflow differs from what was asked in \d+ place\(s\)/);
});

test("A11 skipIfExists: if the lookup cannot be completed and the name was not seen, nothing is created", async (t) => {
    for (const fault of [{ ignoreOffset: true }, { omitTotal: true }]) {
        const server = reviewsServer(t, { workflows: Array.from({ length: 60 }, (_, i) => workflowRecord(i)), ...fault });
        await assert.rejects(create({ skipIfExists: true }), (e) => {
            assert.match(e.message, /^Cannot confirm that no workflow named "ZZ Test" exists: the workflow listing could not be completed — INCOMPLETE: .* Nothing was created\./);
            return true;
        });
        assert.equal(server.posts().length, 0, JSON.stringify(fault));
        server.restore();
    }
});

test("A11 without skipIfExists: Autodesk's 409 is reported in plain words with the name; one POST, no retry", async (t) => {
    const server = reviewsServer(t, { workflows: [workflowRecord(3, { name: "ZZ Test" })] });
    await assert.rejects(create({}), (e) => {
        assert.match(e.message, /^Reviews API POST \/projects\/.*\/workflows failed \(409\): \{"code":"ERR_WORKFLOW_ALREADY_EXIST"/);
        assert.match(e.message, / — A workflow named "ZZ Test" already exists in this project \(Autodesk refuses a duplicate name\)\. Nothing was created\. Pass skipIfExists: true/);
        return true;
    });
    assert.equal(server.calls.length, 1);
});

// ---------------------------------------------------------------------------
// A12 — report what was stored, not what was asked
// ---------------------------------------------------------------------------

const richArgs = () => [{
    initiators: [{ type: "company", id: "542830416" }],
    copyFilesOptions: { enabled: true, folderUrn: FOLDER_URN, condition: "ALL", includeMarkups: true },
    additionalApprovalStatusOptions: [{ label: "Approved with comments", value: "APPROVED" }],
    notes: "n",
}, [
    reviewer({ dayType: "business_days", candidates: [user("USERANN"), user("USERBOB")], groupReview: { enabled: true, type: "ALL" } }),
    approver({ dayType: "business_days" }),
]];

/** Create with a stand-in Autodesk that alters what it stores; return the differences the tool reports. */
async function differencesWhen(t, alter) {
    const server = reviewsServer(t, { store: (body) => { const stored = storeAsAutodeskDoes(body); alter(stored); return stored; } });
    const res = await create(...richArgs());
    server.restore();
    return res;
}

test("A12: when Autodesk stores exactly what was asked, the output says so and differences is empty", async (t) => {
    const res = await differencesWhen(t, () => {});
    assert.deepEqual(res.structuredContent.differences, []);
    assert.equal(res.structuredContent.verified, true);
    assert.ok(!res.content[0].text.includes("WARNING"));
});

test("A12: Autodesk's own default edit permissions are not reported as a difference when none was asked for", async (t) => {
    const res = await differencesWhen(t, (stored) => { stored.additionalOptions.initiatorEditPermissions = ["CLOSED_REVIEW_TITLE", "START_OWN_REVIEW"]; });
    assert.deepEqual(res.structuredContent.differences, []);
});

const DROPPED = [
    ["the working-day setting (stored as calendar days)", (s) => { s.steps[1].dueDateType = "CALENDAR_DAY"; }, 'steps[1] ("Check").dueDateType', "WORKDAY", "CALENDAR_DAY"],
    ["group review (dropped)", (s) => { delete s.steps[1].groupReview; }, 'steps[1] ("Check").groupReview', { enabled: true, type: "ALL" }, "off"],
    ["group review (ALL stored as MINIMUM)", (s) => { s.steps[1].groupReview = { enabled: true, type: "MINIMUM", min: 1 }; }, 'steps[1] ("Check").groupReview', { enabled: true, type: "ALL" }, { enabled: true, type: "MINIMUM", min: 1 }],
    ["copy switched off", (s) => { s.copyFilesOptions.enabled = false; }, "copyFilesOptions.enabled", true, false],
    ["the copy folder (dropped)", (s) => { s.copyFilesOptions.folderUrn = null; }, "copyFilesOptions.folderUrn", FOLDER_URN, null],
    ["the copy condition (ALL stored as ANY)", (s) => { s.copyFilesOptions.condition = "ANY"; }, "copyFilesOptions.condition", "ALL", "ANY"],
    ["include markups (dropped)", (s) => { s.copyFilesOptions.includeMarkups = false; }, "copyFilesOptions.includeMarkups", true, false],
    ["a reviewer (one of two dropped)", (s) => { s.steps[1].candidates.users.pop(); }, 'steps[1] ("Check").candidates.users', ["USERANN", "USERBOB"], ["USERANN"]],
    ["the company initiator (dropped)", (s) => { s.steps[0].candidates.companies = []; }, 'steps[0] ("Initiator").candidates.companies', ["542830416"], []],
    ["the duration", (s) => { s.steps[2].duration = 5; }, 'steps[2] ("Sign-off").duration', 2, 5],
    ["a step (dropped)", (s) => { s.steps.splice(1, 1); }, "steps.length", 3, 2],
    ["the extra status (dropped)", (s) => { s.approvalStatusOptions = s.approvalStatusOptions.filter((o) => o.builtIn); }, "additionalApprovalStatusOptions", ["Approved with comments=APPROVED"], []],
    ["the notes (dropped)", (s) => { s.notes = null; }, "notes", "n", null],
];

for (const [label, alter, field, requested, stored] of DROPPED) {
    test(`A12: Autodesk stores something else for ${label} → a WARNING names the field, asked and stored`, async (t) => {
        const res = await differencesWhen(t, alter);
        const hit = res.structuredContent.differences.find((d) => d.field === field);
        assert.ok(hit, `expected a difference on ${field}; got ${JSON.stringify(res.structuredContent.differences)}`);
        assert.deepEqual(hit.requested, requested);
        assert.deepEqual(hit.stored, stored);
        assert.match(res.content[0].text, /WARNING — Autodesk's response differs from what was asked in \d+ place\(s\):/);
        assert.ok(res.content[0].text.includes(`  - ${field}: asked ${JSON.stringify(requested)}, stored ${JSON.stringify(stored)}`));
        assert.equal(res.structuredContent.created, true, "the workflow exists; the warning is how the caller learns it is wrong");
    });
}

test("A12: a candidate Autodesk stored without a name (an id it did not recognise) is flagged", async (t) => {
    const res = await differencesWhen(t, (s) => { delete s.steps[0].candidates.companies[0].name; });
    assert.deepEqual(res.structuredContent.differences, [{
        field: 'steps[0] ("Initiator").candidates.companies 542830416',
        requested: "a known member",
        stored: "stored with no name — Autodesk did not recognise this id",
    }]);
});

test("A12: requested edit permissions, attributes and attribute options are compared too", () => {
    const { body } = buildWorkflowRequest(args({
        additionalOptions: { initiatorEditPermissions: ["APPROVERS", "CLOSED_REVIEW_TITLE"], approverEditPermissions: ["APPROVERS"] },
        attachedAttributes: [{ id: 1, required: true }],
        updateAttributesOptions: { enableAttachedAttributes: true },
    }));
    const stored = storeAsAutodeskDoes(body);
    assert.deepEqual(compareStoredWithRequested(body, stored).differences, []);
    stored.additionalOptions.initiatorEditPermissions = ["CLOSED_REVIEW_TITLE"];
    stored.additionalOptions.approverEditPermissions = [];
    stored.attachedAttributes = [{ id: 1, required: false }];
    stored.updateAttributesOptions.enableAttachedAttributes = false;
    assert.deepEqual(compareStoredWithRequested(body, stored).differences.map((d) => d.field).sort(), [
        "additionalOptions.approverEditPermissions", "additionalOptions.initiatorEditPermissions", "attachedAttributes", "updateAttributesOptions.enableAttachedAttributes",
    ]);
});

test("A12: a response without steps cannot be checked — the output says NOT VERIFIED rather than claiming a match", async (t) => {
    const server = reviewsServer(t, { store: (body) => ({ id: "99999999-9999-4999-8999-999999999999", name: body.name }) });
    const res = await create({});
    assert.equal(server.posts().length, 1);
    assert.equal(res.structuredContent.verified, false);
    assert.match(res.content[0].text, /NOT VERIFIED: Autodesk's response did not include the workflow's steps/);
    assert.ok(!res.content[0].text.includes("all match"));
});

// ---------------------------------------------------------------------------
// A13 — a create is never retried
// ---------------------------------------------------------------------------

for (const status of [500, 503, 429]) {
    test(`A13: a create answered ${status} is sent exactly once and fails with the status in the text`, async (t) => {
        const server = reviewsServer(t, { createStatus: status });
        await assert.rejects(create({}), (e) => {
            assert.match(e.message, new RegExp(`^Reviews API POST .* failed \\(${status}\\): `));
            return true;
        });
        assert.equal(server.posts().length, 1);
        assert.equal(server.calls.length, 1);
    });
}

// ---------------------------------------------------------------------------
// Review round 1 (automated review of PR #14)
// ---------------------------------------------------------------------------

test("timeAllowed 0 is refused like any other out-of-range value; only a time that was not given defaults to 5", async (t) => {
    await assertRefused(t, {}, [reviewer({ timeAllowed: 0 }), approver()], /^Step 1 \("Check"\) timeAllowed is 0; Autodesk accepts a whole number of days from 1 to 99/);
    await assertRefused(t, {}, [reviewer({ timeAllowed: undefined, time_allowed: 0 }), approver()], /timeAllowed is 0/);
    for (const notGiven of [undefined, null, ""]) {
        const body = await assertAccepted(t, {}, [reviewer({ timeAllowed: notGiven }), approver()]);
        assert.equal(body.steps[1].duration, 5, `timeAllowed ${JSON.stringify(notGiven)}`);
    }
});

test("a candidate id must be text or a number: an object, array or boolean is refused, never sent as \"[object Object]\"", async (t) => {
    for (const bad of [{ value: "USERANN" }, ["USERANN"], true, "   "]) {
        await assertRefused(t, {}, [reviewer({ candidates: [user("USERBOB"), { type: "user", id: bad }] }), approver()], /^Step 1 \("Check"\) candidate 2 has no id/);
    }
    const body = await assertAccepted(t, {}, [reviewer({ candidates: [{ type: "user", id: "  USERANN  " }, { type: "role", id: 542830447 }] }), approver()]);
    assert.deepEqual(body.steps[1].candidates, { users: [{ autodeskId: "USERANN" }], roles: [{ autodeskId: "542830447" }], companies: [] });
});

test("initiator ids are cleaned the same way: a blank initiatorUserId counts as not given; ids are trimmed", async (t) => {
    const fallback = await assertAccepted(t, { initiatorUserId: "   " });
    assert.deepEqual(fallback.steps[0].candidates.users, [{ autodeskId: "USERANN" }], "falls back to the first user of step 1");
    const trimmed = await assertAccepted(t, { initiatorUserId: " USERZED " });
    assert.deepEqual(trimmed.steps[0].candidates.users, [{ autodeskId: "USERZED" }]);
    const inferred = await assertAccepted(t, {}, [reviewer({ candidates: [{ type: "user", id: " USERANN " }] }), approver()]);
    assert.deepEqual(inferred.steps[0].candidates.users, [{ autodeskId: "USERANN" }]);
    await assertRefused(t, { initiatorUserId: "  " }, [reviewer({ candidates: [{ type: "role", id: "542830447" }] }), approver()], /^Cannot create workflow "ZZ Test" — no user candidate found in step 1/);
});

test("a day type or role that only matches an inherited object property (\"constructor\", \"toString\") is refused", async (t) => {
    for (const odd of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
        await assertRefused(t, {}, [reviewer({ dayType: odd }), approver()], new RegExp(`^Step 1 \\("Check"\\) has dayType "${odd}"`));
        await assertRefused(t, {}, [reviewer({ role: odd }), approver()], new RegExp(`^Step 1 \\("Check"\\) has role "${odd}"`));
    }
});

test("a step name must be text", async (t) => {
    await assertRefused(t, {}, [reviewer({ name: 42 }), approver()], /^Step 1 name must be text \(got 42\)/);
    await assertRefused(t, {}, [reviewer({ name: { a: 1 } }), approver()], /^Step 1 name must be text/);
});

test("an extra status label is sent trimmed — the same text that was checked for length and uniqueness", async (t) => {
    const body = await assertAccepted(t, { additionalApprovalStatusOptions: [{ label: "  Approved with comments ", value: "APPROVED" }] });
    assert.deepEqual(body.additionalApprovalStatusOptions, [{ label: "Approved with comments", value: "APPROVED" }]);
    await assertRefused(t, { additionalApprovalStatusOptions: [{ label: "Hold", value: "REJECTED" }, { label: " hold ", value: "REJECTED" }] }, undefined, /label "hold" is used twice/);
});

test("A12: a step Autodesk stored under a different name is reported", async (t) => {
    const res = await differencesWhen(t, (s) => { s.steps[1].name = "Something else"; });
    assert.deepEqual(res.structuredContent.differences, [{ field: 'steps[1] ("Check").name', requested: "Check", stored: "Something else" }]);
});

/** A project where the name is free at lookup time but taken by the time the create is sent. */
function racingServer(t, { appearsInSecondLookup }) {
    const taken = workflowRecord(7, { name: "ZZ Test" });
    let created = false;
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const method = init.method ?? "GET";
        calls.push({ method, url: String(url) });
        if (method === "POST") {
            created = true;
            return new Response(JSON.stringify({ code: "ERR_WORKFLOW_ALREADY_EXIST", title: "Workflow name and project id conflict" }), { status: 409 });
        }
        const status = new URL(url).searchParams.get("filter[status]");
        const results = created && appearsInSecondLookup && status === "ACTIVE" ? [taken] : [];
        return new Response(JSON.stringify({ results, pagination: { totalResults: results.length, offset: 0, limit: 50, nextUrl: "" } }), { status: 200 });
    };
    t.after(() => { globalThis.fetch = original; });
    return { calls, taken };
}

test("A11 skipIfExists, name taken between the lookup and the create (409): looks again and returns the existing workflow; the POST is not re-sent", async (t) => {
    const server = racingServer(t, { appearsInSecondLookup: true });
    const res = await create({ skipIfExists: true });
    assert.equal(res.structuredContent.created, false);
    assert.equal(res.structuredContent.result.id, server.taken.id);
    assert.deepEqual(server.calls.map((c) => c.method), ["GET", "GET", "GET", "POST", "GET", "GET", "GET"], "lookup (active, inactive, active count), one POST, lookup again");
});

test("A11 skipIfExists, 409 but no workflow of exactly that name is listed: fails, saying Autodesk may match names loosely", async (t) => {
    const server = racingServer(t, { appearsInSecondLookup: false });
    await assert.rejects(create({ skipIfExists: true }), (e) => {
        assert.match(e.message, /failed \(409\): .* — Autodesk refuses the name "ZZ Test" as a duplicate, but no workflow with exactly that name is listed \(active or inactive\)\. Autodesk may be treating a name that differs only in letter case or spacing as the same\. Nothing was created\./);
        return true;
    });
    assert.equal(server.calls.filter((c) => c.method === "POST").length, 1);
});

// ---------------------------------------------------------------------------
// Review round 2 (fresh reviewer pass on PR #14)
// ---------------------------------------------------------------------------

test("a misspelt or unknown key on a step is refused before anything is sent — never dropped and reported as a match", async (t) => {
    const keys = (k) => new RegExp(`^Step 1 \\("Check"\\) has unknown key\\(s\\) ${k}\\. A step's keys are name, role, candidates, timeAllowed, dayType, groupReview .*Nothing was sent to Autodesk\\.$`);
    // The reviewer's three failing inputs: each used to create a workflow without the setting.
    await assertRefused(t, {}, [reviewer({ group_review: { enabled: true, type: "ALL" } }), approver()], keys("group_review"));
    await assertRefused(t, {}, [reviewer({ groupreview: { enabled: true, type: "ALL" } }), approver()], keys("groupreview"));
    await assertRefused(t, {}, [reviewer({ timeAlowed: 10 }), approver()], keys("timeAlowed"));
    await assertRefused(t, {}, [reviewer({ note: "x", Role: "approver" }), approver()], keys("note, Role"));
    await assertRefused(t, {}, [reviewer(), approver({ daytype: "calendar_days" })], /^Step 2 \("Sign-off"\) has unknown key\(s\) daytype\./);
    // stepOrder beside an unknown key does not excuse the unknown key.
    await assertRefused(t, {}, [reviewer({ stepOrder: 1, groupreview: { enabled: true, type: "ALL" } }), approver()], keys("groupreview"));
    // The same steps with the key spelt correctly are sent, with the setting.
    const body = await assertAccepted(t, {}, [reviewer({ candidates: [user("A"), user("B")], groupReview: { enabled: true, type: "ALL" }, timeAllowed: 10 }), approver()]);
    assert.deepEqual(body.steps[1].groupReview, { enabled: true, type: "ALL" });
    assert.equal(body.steps[1].duration, 10);
});

test("a misspelt or unknown key on a candidate is refused: a \"Type\" that is not read must not turn a company into a user", async (t) => {
    const company = { Type: "company", id: "542830416" };
    await assertRefused(t, {}, [reviewer({ candidates: [company] }), approver()], /^Step 1 \("Check"\) candidate 1 has unknown key\(s\) Type\. A candidate's keys are type and id \(or the legacy userId\)\. Nothing was sent to Autodesk\.$/);
    await assertRefused(t, {}, [reviewer(), approver({ candidates: [user("USERBOB"), { type: "user", id: "X", name: "Bob" }] })], /^Step 2 \("Sign-off"\) candidate 2 has unknown key\(s\) name\./);
    // In initiators the input schema refuses it (zod strips unknown keys unless the object is strict).
    const server = reviewsServer(t);
    await assert.rejects(create({ initiators: [company] }), /Unrecognized key\(s\) in object: 'Type'/);
    assert.equal(server.calls.length, 0);
    // buildWorkflowRequest called directly (no schema in front) refuses it as well.
    assert.throws(() => buildWorkflowRequest(args({ initiators: [company] })), /^Error: initiators candidate 1 has unknown key\(s\) Type\./);
});

test("an initiator given by id must say what it is: an id with no type is refused, not taken for a user", async (t) => {
    await assertRefused(t, { initiators: [{ id: "542830416" }] }, undefined, /^initiators candidate 1 has no type\. Say whether the id is a "user", a "role" or a "company".*Nothing was sent to Autodesk\.$/);
    // The legacy {userId} shape names a user by itself and still works; so does a step candidate without a type.
    const body = await assertAccepted(t, { initiators: [{ userId: "USERLEGACY" }] }, [reviewer({ candidates: [{ id: "USERANN" }] }), approver()]);
    assert.deepEqual(body.steps[0].candidates.users, [{ autodeskId: "USERLEGACY" }]);
    assert.deepEqual(body.steps[1].candidates.users, [{ autodeskId: "USERANN" }]);
});

test("a step name of 0 or false is refused as not text, not sent as an empty name", async (t) => {
    await assertRefused(t, {}, [reviewer({ name: 0 }), approver()], /^Step 1 name must be text \(got 0\)/);
    await assertRefused(t, {}, [reviewer({ name: false }), approver()], /^Step 1 name must be text \(got false\)/);
    await assertRefused(t, {}, [reviewer({ name: undefined, step_name: 0 }), approver()], /^Step 1 name must be text \(got 0\)/);
    // An empty name still falls back to the legacy step_name, as before.
    const body = await assertAccepted(t, {}, [reviewer({ name: "", step_name: "Legacy" }), approver()]);
    assert.equal(body.steps[1].name, "Legacy");
});

// ---------------------------------------------------------------------------
// Review round 3: a supplied value is never swapped for a default or dropped
// ---------------------------------------------------------------------------

test("a day type of false or 0 is refused, not swapped for the default (working days)", async (t) => {
    await assertRefused(t, {}, [reviewer({ dayType: false }), approver()], /^Step 1 \("Check"\) has dayType "false"\. Use "business_days" \(working days\) or "calendar_days"/);
    await assertRefused(t, {}, [reviewer({ dayType: 0 }), approver()], /^Step 1 \("Check"\) has dayType "0"\./);
    await assertRefused(t, {}, [reviewer({ dayType: undefined, day_type: 0 }), approver()], /^Step 1 \("Check"\) has dayType "0"\./);
    // Left out, null or empty is still "not given": the legacy day_type is read, then the default applies.
    const legacy = await assertAccepted(t, {}, [reviewer({ dayType: "", day_type: "calendar_days" }), approver()]);
    assert.equal(legacy.steps[1].dueDateType, "CALENDAR_DAY");
    const omitted = await assertAccepted(t, {}, [reviewer({ dayType: null }), approver({ dayType: undefined })]);
    assert.deepEqual(omitted.steps.slice(1).map((s) => s.dueDateType), ["WORKDAY", "WORKDAY"]);
});

test("a role of false or 0 is refused, not taken for a reviewer", async (t) => {
    await assertRefused(t, {}, [reviewer({ role: false }), approver()], /^Step 1 \("Check"\) has role "false"\. A step's role is "reviewer" or "approver"/);
    await assertRefused(t, {}, [reviewer({ role: 0 }), approver()], /^Step 1 \("Check"\) has role "0"\./);
    // Left out, null or empty is still "not given": the step is a reviewer step, as before.
    for (const blank of [undefined, null, ""]) {
        const body = await assertAccepted(t, {}, [reviewer({ role: blank }), approver()]);
        assert.equal(body.steps[1].type, "REVIEWER");
    }
});

test("a candidate that gives both id and userId: differing values are refused everywhere, and an initiator's id still needs its type", async (t) => {
    const differ = (at) => new RegExp(`^${at} gives both id and userId, and they differ\\. Give one of them.*Nothing was sent to Autodesk\\.$`);
    // The automated review's case: the group id would have been sent as a user because userId was present.
    await assertRefused(t, { initiators: [{ id: "542830416", userId: "USERANN" }] }, undefined, differ("initiators candidate 1"));
    await assertRefused(t, { initiators: [{ type: "company", id: "542830416", userId: "USERANN" }] }, undefined, differ("initiators candidate 1"));
    await assertRefused(t, {}, [reviewer({ candidates: [{ type: "user", id: "USERANN", userId: "USERBOB" }] }), approver()], differ('Step 1 \\("Check"\\) candidate 1'));
    // The same value twice is not a contradiction, but in initiators an id still has to say what it is.
    await assertRefused(t, { initiators: [{ id: "USERANN", userId: "USERANN" }] }, undefined, /^initiators candidate 1 has no type\. Say whether the id is a "user", a "role" or a "company"/);
    const body = await assertAccepted(t, { initiators: [{ type: "user", id: "USERANN", userId: " USERANN " }] }, [reviewer({ candidates: [{ id: "USERZED", userId: "USERZED" }] }), approver()]);
    assert.deepEqual(body.steps[0].candidates.users, [{ autodeskId: "USERANN" }]);
    assert.deepEqual(body.steps[1].candidates.users, [{ autodeskId: "USERZED" }]);
});

test("a step that gives a setting under both its name and its older name, with different values, is refused", async (t) => {
    const both = (a, b) => new RegExp(`^Step 1 \\("Check"\\) gives both ${a} and ${b}, and they differ\\. Give one of them \\(${b} is the older name\\)\\. Nothing was sent to Autodesk\\.$`);
    await assertRefused(t, {}, [reviewer({ timeAllowed: 2, time_allowed: 5 }), approver()], both("timeAllowed", "time_allowed"));
    await assertRefused(t, {}, [reviewer({ dayType: "business_days", day_type: "calendar_days" }), approver()], both("dayType", "day_type"));
    await assertRefused(t, {}, [reviewer({ name: "Check", step_name: "Verify" }), approver()], both("name", "step_name"));
    // The same value under both names is not a contradiction (a number and its text form are the same value).
    const body = await assertAccepted(t, {}, [reviewer({ name: "Check", step_name: "Check", timeAllowed: 3, time_allowed: "3", dayType: "calendar_days", day_type: "calendar_days" }), approver()]);
    assert.deepEqual([body.steps[1].name, body.steps[1].duration, body.steps[1].dueDateType], ["Check", 3, "CALENDAR_DAY"]);
});

// Reviewer notes T1 and T3 on the round-3 re-check, and the blank-userId inconsistency it listed.
test("group review ALL with a min beside it is refused: the min would be dropped and every reviewer required", async (t) => {
    const two = [user("USERANN"), user("USERBOB")];
    await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "ALL", min: 2 } }), approver()],
        /^Step 1 \("Check"\) groupReview has type "ALL" \(every assigned reviewer must respond\) and also min 2\. min applies to type "MINIMUM" only: drop it, or use "MINIMUM"\. Nothing was sent to Autodesk\.$/);
    await assertRefused(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "all", min: 0 } }), approver()], /groupReview has type "ALL" .* and also min 0\./);
    // A null min is "not given", and ALL on its own is unchanged.
    const body = await assertAccepted(t, {}, [reviewer({ candidates: two, groupReview: { enabled: true, type: "ALL", min: null } }), approver()]);
    assert.deepEqual(body.steps[1].groupReview, { enabled: true, type: "ALL" });
});

test("a blank or null id or userId beside a real one is not a contradiction: the entry is read as before", async (t) => {
    const body = await assertAccepted(t, { initiators: [{ id: "USERLEGACY", userId: " ", type: "user" }] }, [reviewer({ candidates: [{ id: "USERANN", userId: "" }, { id: null, userId: "USERZED" }] }), approver()]);
    assert.deepEqual(body.steps[0].candidates.users, [{ autodeskId: "USERLEGACY" }]);
    assert.deepEqual(body.steps[1].candidates.users, [{ autodeskId: "USERANN" }, { autodeskId: "USERZED" }]);
    // A blank id is still "no id" (as before round 3), not "they differ".
    await assertRefused(t, {}, [reviewer(), approver({ candidates: [{ id: " ", userId: "USERBOB" }] })], /^Step 2 \("Sign-off"\) candidate 1 has no id\./);
});

test("A11 skipIfExists: an existing workflow that is switched off is returned with a WARNING — it cannot be used until switched on in Forma", async (t) => {
    const existing = workflowRecord(3, { name: "ZZ Test", status: "INACTIVE" });
    const server = reviewsServer(t, { workflows: [existing] });
    const res = await create({ skipIfExists: true });
    assert.equal(server.posts().length, 0);
    assert.equal(res.structuredContent.created, false);
    assert.equal(res.structuredContent.result.status, "INACTIVE");
    assert.match(res.content[0].text, /\nWARNING: this workflow is INACTIVE \(switched off\)\. It cannot be used to start a review, and it cannot be switched on through this server: that is done by hand in Forma\.\n/);
});

test("A11 skipIfExists: an existing ACTIVE workflow carries no switched-off warning", async (t) => {
    reviewsServer(t, { workflows: [workflowRecord(3, { name: "ZZ Test" })] });
    const res = await create({ skipIfExists: true });
    assert.ok(!res.content[0].text.includes("WARNING"));
});

test("A12: a workflow stored under a different name or description, or a step stored as a different type, is reported", async (t) => {
    const name = await differencesWhen(t, (s) => { s.name = "ZZ Test (2)"; });
    assert.deepEqual(name.structuredContent.differences, [{ field: "name", requested: "ZZ Test", stored: "ZZ Test (2)" }]);
    const description = await differencesWhen(t, (s) => { s.description = "something else"; });
    assert.deepEqual(description.structuredContent.differences, [{ field: "description", requested: "", stored: "something else" }]);
    const type = await differencesWhen(t, (s) => { s.steps[1].type = "APPROVER"; });
    assert.deepEqual(type.structuredContent.differences, [{ field: 'steps[1] ("Check").type', requested: "REVIEWER", stored: "APPROVER" }]);
    for (const res of [name, description, type]) assert.match(res.content[0].text, /^WARNING/m);
});
