// The compatibility pin and the two corrections for createReviewWorkflowTool.
//
// This file uses nothing but the tool, stubFetch and the MCP SDK, so it also runs unchanged against the
// previous version of the tool (ptp/main 7d3d75b). There, the "pinned" tests pass and the "correction" tests
// fail — that run is the RED evidence in the PR body.
import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stubFetch } from "./setup.mjs";
import { createReviewWorkflowTool } from "../tools/create-review-workflow.js";

const PROJECT = "b.aaaaaaaa-0000-4000-8000-000000000000";
const URL_WORKFLOWS = `https://developer.api.autodesk.com/construction/reviews/v1/projects/${PROJECT}/workflows`;

/** Answer the create with a 201 and record what was sent. */
function createStub(t) {
    const stub = stubFetch(async (url, init = {}) => {
        if (url === URL_WORKFLOWS && init.method === "POST") {
            return { status: 201, body: { id: "99999999-9999-4999-8999-999999999999", name: JSON.parse(init.body).name } };
        }
        throw new Error(`unexpected call ${init.method ?? "GET"} ${url}`);
    });
    t.after(() => stub.restore());
    return stub;
}
const sentBody = (stub) => stub.calls.find((c) => c.method === "POST")?.body;
const withoutDayType = (body) => JSON.stringify(body).replace(/"dueDateType":"[A-Z_]+"/g, '"dueDateType":"<DAY>"');

// The arguments mortgage-study-rag's acc_delivery.py sends (origin/main 669bf40, _run_wave_3_reviews +
// _resolve_workflow_candidates): projectId with the b. prefix, name, optional description, and steps as a
// JSON STRING of {name, role, candidates: [{type: "user", id}], timeAllowed, dayType}.
const CALLER_ARGS = {
    projectId: PROJECT,
    name: "Payment Application Review",
    description: "Monthly progress claim",
    steps: JSON.stringify([
        { name: "PM Review", role: "reviewer", candidates: [{ type: "user", id: "USERANN" }], timeAllowed: 5, dayType: "business_days" },
        { name: "Director Approval", role: "approver", candidates: [{ type: "user", id: "USERBOB" }, { type: "user", id: "USERCY" }], timeAllowed: 3, dayType: "calendar_days" },
    ]),
};
// The request body ptp/main 7d3d75b builds for those arguments, key order included, with the day type masked.
const LEGACY_BODY_DAY_MASKED =
    '{"name":"Payment Application Review","description":"Monthly progress claim","steps":[' +
    '{"name":"Initiator","type":"INITIATOR","candidates":{"companies":[],"roles":[],"users":[{"autodeskId":"USERANN"}]}},' +
    '{"name":"PM Review","type":"REVIEWER","duration":5,"dueDateType":"<DAY>","candidates":{"users":[{"autodeskId":"USERANN"}],"roles":[],"companies":[]}},' +
    '{"name":"Director Approval","type":"APPROVER","duration":3,"dueDateType":"<DAY>","candidates":{"users":[{"autodeskId":"USERBOB"},{"autodeskId":"USERCY"}],"roles":[],"companies":[]}}],' +
    '"copyFilesOptions":{"enabled":false,"allowOverride":false,"condition":"ANY","includeMarkups":false,"disableOverrideMarkupSetting":false}}';

// ---------------------------------------------------------------------------
// Pinned: the existing caller
// ---------------------------------------------------------------------------

test("pinned: the existing caller's exact arguments produce the same request body as ptp/main, apart from the day type", async (t) => {
    const stub = createStub(t);
    const res = await createReviewWorkflowTool.callback(CALLER_ARGS);
    assert.equal(stub.calls.length, 1, "one request: the POST");
    assert.equal(stub.calls[0].url, URL_WORKFLOWS);
    assert.equal(withoutDayType(sentBody(stub)), LEGACY_BODY_DAY_MASKED);
    // What acc_delivery.py reads back (_extract_created_result_id): structuredContent.result.id.
    assert.equal(res.structuredContent.result.id, "99999999-9999-4999-8999-999999999999");
    assert.match(res.content[0].text, /^Created review workflow "Payment Application Review" with 3 step\(s\) \(including initiator\)\. Total candidates across all steps: 4 user\(s\), 0 role\(s\), 0 company\(ies\)\. Workflow ID: 99999999-9999-4999-8999-999999999999/);
});

test("pinned: without a description the body carries an empty description, as before", async (t) => {
    const stub = createStub(t);
    const { description: _omitted, ...args } = CALLER_ARGS;
    await createReviewWorkflowTool.callback(args);
    assert.equal(withoutDayType(sentBody(stub)), LEGACY_BODY_DAY_MASKED.replace('"description":"Monthly progress claim"', '"description":""'));
});

test("pinned: the runbook's legacy shape ({userId} candidates, extra stepOrder key) builds the same steps", async (t) => {
    const stub = createStub(t);
    await createReviewWorkflowTool.callback({
        ...CALLER_ARGS,
        steps: JSON.stringify([
            { stepOrder: 1, name: "PM Review", role: "reviewer", candidates: [{ userId: "USERANN" }], timeAllowed: 5, dayType: "business_days" },
            { stepOrder: 2, name: "Director Approval", role: "approver", candidates: [{ userId: "USERBOB" }, { userId: "USERCY" }], timeAllowed: 3, dayType: "calendar_days" },
        ]),
    });
    assert.equal(withoutDayType(sentBody(stub)), LEGACY_BODY_DAY_MASKED);
});

test("pinned: an explicit initiatorUserId is the initiator; steps may then start with a role", async (t) => {
    const stub = createStub(t);
    await createReviewWorkflowTool.callback({
        projectId: PROJECT, name: "N", initiatorUserId: "USERZED",
        steps: JSON.stringify([{ name: "Sign", role: "approver", candidates: [{ type: "role", id: "542830447" }], timeAllowed: 2, dayType: "calendar_days" }]),
    });
    assert.deepEqual(sentBody(stub).steps[0], { name: "Initiator", type: "INITIATOR", candidates: { companies: [], roles: [], users: [{ autodeskId: "USERZED" }] } });
    assert.deepEqual(sentBody(stub).steps[1].candidates, { users: [], roles: [{ autodeskId: "542830447" }], companies: [] });
});

// ---------------------------------------------------------------------------
// Correction A7 — working days
// ---------------------------------------------------------------------------

test("correction A7: business_days is sent as WORKDAY (Autodesk refuses BUSINESS_DAY with HTTP 400)", async (t) => {
    const stub = createStub(t);
    await createReviewWorkflowTool.callback(CALLER_ARGS);
    assert.deepEqual(sentBody(stub).steps.map((s) => s.dueDateType), [undefined, "WORKDAY", "CALENDAR_DAY"]);
});

test("correction A7: a step with no dayType gets working days (WORKDAY), the tool's long-standing default meaning", async (t) => {
    const stub = createStub(t);
    await createReviewWorkflowTool.callback({
        projectId: PROJECT, name: "N",
        steps: JSON.stringify([{ name: "Sign", role: "approver", candidates: [{ type: "user", id: "USERANN" }], timeAllowed: 2 }]),
    });
    assert.equal(sentBody(stub).steps[1].dueDateType, "WORKDAY");
});

test("correction A7: no request this tool builds carries BUSINESS_DAY, whichever spelling of the day type is given", async (t) => {
    for (const dayType of ["business_days", "calendar_days", undefined]) {
        const stub = createStub(t);
        const step = { name: "Sign", role: "approver", candidates: [{ type: "user", id: "USERANN" }], timeAllowed: 2 };
        if (dayType) step.dayType = dayType;
        await createReviewWorkflowTool.callback({ projectId: PROJECT, name: "N", steps: JSON.stringify([step]) });
        assert.ok(!JSON.stringify(sentBody(stub)).includes("BUSINESS_DAY"), `dayType ${dayType}`);
        stub.restore();
    }
});

// ---------------------------------------------------------------------------
// Correction A9 — a refused input fails like a failure
// ---------------------------------------------------------------------------

const REFUSALS = [
    ["steps that are not JSON", { steps: "{not json" }, /^Invalid steps JSON: /],
    ["an empty steps array", { steps: "[]" }, /^Invalid steps JSON: expected a non-empty array of workflow steps\.$/],
    ["steps that are not an array", { steps: '{"name":"x"}' }, /^Invalid steps JSON: expected a non-empty array of workflow steps\.$/],
    ["no user in step 1 and no initiatorUserId",
        { steps: JSON.stringify([{ name: "Sign", role: "approver", candidates: [{ type: "role", id: "542830447" }], timeAllowed: 2 }]) },
        /^Cannot create workflow "N" — no user candidate found in step 1, and no `initiatorUserId` was supplied\. ACC's Reviews API requires a user as the workflow initiator\./],
    ["a step whose candidates are not an array",
        { initiatorUserId: "USERZED", steps: JSON.stringify([{ name: "Sign", role: "approver", candidates: "USERANN", timeAllowed: 2 }]) },
        /^Step "Sign" has invalid candidates\. Expected an array\.$/],
    ["a step with no candidates",
        { initiatorUserId: "USERZED", steps: JSON.stringify([{ name: "Sign", role: "approver", candidates: [], timeAllowed: 2 }]) },
        /^Step "Sign" has no candidates\. ACC requires at least one user, role, or company candidate per step\.$/],
];

for (const [label, overrides, expected] of REFUSALS) {
    test(`correction A9: ${label} — the call fails (throws) with the same text, and nothing is sent`, async (t) => {
        const stub = createStub(t);
        await assert.rejects(
            createReviewWorkflowTool.callback({ projectId: PROJECT, name: "N", ...overrides }),
            (e) => { assert.match(e.message, expected); return true; },
        );
        assert.equal(stub.calls.length, 0, "a refused input makes no request");
    });
}

/** The tool as server.js serves it, called the way an MCP client (acc_delivery.py's ClientSession) calls it. */
async function mcpCall(t, args) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { title, description, inputSchema, callback } = createReviewWorkflowTool;
    server.registerTool("createReviewWorkflowTool", { title, description, inputSchema }, callback);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    t.after(async () => { await client.close(); await server.close(); });
    return client.callTool({ name: "createReviewWorkflowTool", arguments: args });
}

test("correction A9, through the MCP server: a refusal reaches the caller with isError set, exactly like an Autodesk failure", async (t) => {
    const stub = stubFetch(async () => ({ status: 500, body: { detail: "boom" } }));
    t.after(() => stub.restore());

    const refused = await mcpCall(t, {
        projectId: PROJECT, name: "N", initiatorUserId: "USERZED",
        steps: JSON.stringify([{ name: "Sign", role: "approver", candidates: [], timeAllowed: 2 }]),
    });
    assert.equal(refused.isError, true, "a refused input must be flagged as an error");
    assert.match(refused.content[0].text, /^Step "Sign" has no candidates\./);
    assert.equal(refused.structuredContent, undefined);
    assert.equal(stub.calls.length, 0);

    const failed = await mcpCall(t, CALLER_ARGS);
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /^Reviews API POST .* failed \(500\): /);
    assert.equal(stub.calls.length, 1, "and the failed create was sent once only");
});

test("through the MCP server: a successful create is not an error and carries structuredContent.result.id", async (t) => {
    createStub(t);
    const ok = await mcpCall(t, CALLER_ARGS);
    assert.ok(!ok.isError);
    assert.equal(ok.structuredContent.result.id, "99999999-9999-4999-8999-999999999999");
});
