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

test("step keys the tool does not use are reported, not silently dropped", async (t) => {
    reviewsServer(t);
    const res = await create({}, [reviewer({ stepOrder: 1, groupreview: { enabled: true, type: "ALL" } }), approver({ stepOrder: 2 })]);
    assert.deepEqual(res.structuredContent.ignoredStepKeys, ["stepOrder", "groupreview"]);
    assert.match(res.content[0].text, /Ignored step key\(s\) this tool does not use: stepOrder, groupreview\./);
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
    assert.deepEqual(server.listCalls().map((c) => c.status), ["ACTIVE", "INACTIVE"], "both statuses are looked up");
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
