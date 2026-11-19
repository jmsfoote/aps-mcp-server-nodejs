import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stubFetch } from "./setup.mjs";
import { setReviewsRetrySleep } from "../tools/reviews-helpers.js";
import { createReviewTool, buildReviewRequest, MAX_FILE_VERSIONS } from "../tools/create-review.js";

const PROJECT = "b.aaaaaaaa-0000-4000-8000-000000000000";
const REVIEWS = `https://developer.api.autodesk.com/construction/reviews/v1/projects/${PROJECT}/reviews`;
const WORKFLOW = "2a1602c6-63a8-43b8-a407-d75aa7e683bd";
const FOLDER = "urn:adsk.wipprodanz:fs.folder:co.TESTfolder000000000000";
const file = (i, version = 1) => `urn:adsk.wipprodanz:fs.file:vf.TESTfile${String(i).padStart(4, "0")}?version=${version}`;

// The review record Autodesk returned for the live test review of 2026-11-19 (names and ids replaced).
const STORED = {
    id: "138cd1df-4576-4401-bcee-068b0b41d8e0", name: "PA-001 Review", status: "OPEN", sequenceId: 5,
    currentStepId: "Lane_r", currentStepDueDate: "2026-11-20T03:53:50.000Z",
    createdBy: { autodeskId: "USERBOT", name: "Service Bot" }, createdAt: "2026-11-19T03:53:50.000Z", updatedAt: "2026-11-19T03:53:50.000Z",
    finishedAt: null, archivedBy: {}, archived: false, archivedAt: null, workflowId: WORKFLOW,
    nextActionBy: { claimedBy: [], candidates: { roles: [], users: [{ autodeskId: "USERANN", name: "Ann" }], companies: [] } },
    approvedBy: {}, approvedAt: null,
};

function api(t, { status = 201, body = STORED } = {}) {
    const previous = setReviewsRetrySleep(async () => {});
    const stub = stubFetch(async (url, init = {}) => {
        if (url === REVIEWS && init.method === "POST") return { status, body };
        throw new Error(`unexpected call ${init.method ?? "GET"} ${url}`);
    });
    t.after(() => { stub.restore(); setReviewsRetrySleep(previous); });
    return stub;
}
const args = (overrides = {}) => ({ projectId: PROJECT, workflowId: WORKFLOW, name: "PA-001 Review", fileVersionUrns: [file(1)], ...overrides });
async function assertRefused(t, overrides, expected) {
    const stub = api(t);
    await assert.rejects(createReviewTool.callback(args(overrides)), (e) => { assert.match(e.message, expected); return true; });
    assert.equal(stub.calls.length, 0, "a refused input makes no request");
    stub.restore();
}

test("the documented body: several file versions, notes, and both per-review overrides", async (t) => {
    const stub = api(t);
    const res = await createReviewTool.callback(args({
        fileVersionUrns: [file(1), file(2, 4), file(3)],
        notes: "Three drawings for stage 2.",
        workflowOptions: {
            copyFilesOptions: { folderUrn: FOLDER },
            steps: [
                { id: "Lane_r", candidates: [{ type: "user", id: "USERANN" }, { type: "role", id: "542830447" }, { type: "company", id: 542830416 }] },
                { id: "Lane_a", candidates: [{ userId: "USERBOB" }] },
            ],
        },
    }));
    assert.deepEqual(stub.calls[0].body, {
        name: "PA-001 Review",
        fileVersions: [{ urn: file(1) }, { urn: file(2, 4) }, { urn: file(3) }],
        workflowId: WORKFLOW,
        notes: "Three drawings for stage 2.",
        workflowOptions: {
            copyFilesOptions: { folderUrn: FOLDER },
            steps: [
                { id: "Lane_r", candidates: { users: [{ autodeskId: "USERANN" }], roles: [{ autodeskId: "542830447" }], companies: [{ autodeskId: "542830416" }] } },
                { id: "Lane_a", candidates: { users: [{ autodeskId: "USERBOB" }], roles: [], companies: [] } },
            ],
        },
    });
    assert.equal(stub.calls.length, 1);
    assert.deepEqual(res.structuredContent.result, STORED);
    assert.equal(res.content[0].text, [
        `Created review "PA-001 Review" using workflow ${WORKFLOW}. Review ID: ${STORED.id}`,
        "3 file version(s) sent.",
        `- #5 "PA-001 Review" — id ${STORED.id} — OPEN`,
        `    workflow ${WORKFLOW} | created 2026-11-19 by Service Bot (USERBOT)`,
        "    waiting at step Lane_r (due 2026-11-20): users Ann (USERANN)",
    ].join("\n"));
});

test("the smallest body: one file, no notes, no overrides — exactly the three required keys (the live-proven minimum plus nothing)", async (t) => {
    const stub = api(t);
    await createReviewTool.callback(args());
    assert.deepEqual(stub.calls[0].body, { name: "PA-001 Review", fileVersions: [{ urn: file(1) }], workflowId: WORKFLOW });
});

test("each override on its own: only the copy folder; only a step", async (t) => {
    const stub = api(t);
    await createReviewTool.callback(args({ workflowOptions: { copyFilesOptions: { folderUrn: FOLDER } } }));
    assert.deepEqual(stub.calls[0].body.workflowOptions, { copyFilesOptions: { folderUrn: FOLDER } });
    await createReviewTool.callback(args({ workflowOptions: { steps: [{ id: "Lane_r", candidates: [{ type: "user", id: "USERANN" }] }] } }));
    assert.deepEqual(stub.calls[1].body.workflowOptions, { steps: [{ id: "Lane_r", candidates: { users: [{ autodeskId: "USERANN" }], roles: [], companies: [] } }] });
    await createReviewTool.callback(args({ workflowOptions: {} }));
    assert.ok(!("workflowOptions" in stub.calls[2].body), "empty overrides send no workflowOptions key");
});

test("compatibility: documentVersionId → one file version; description → notes; notes equal to description is fine", async (t) => {
    const stub = api(t);
    const { fileVersionUrns: _drop, ...base } = args();
    await createReviewTool.callback({ ...base, documentVersionId: file(9, 2), description: "Old-style text" });
    assert.deepEqual(stub.calls[0].body, { name: "PA-001 Review", fileVersions: [{ urn: file(9, 2) }], workflowId: WORKFLOW, notes: "Old-style text" });
    await createReviewTool.callback(args({ notes: "same", description: "same" }));
    assert.equal(stub.calls[1].body.notes, "same");
    await createReviewTool.callback({ ...base, documentVersionId: file(9, 2), description: "" });
    assert.ok(!("notes" in stub.calls[2].body), "an empty description sends no notes key");
});

test("refused before sending: no file; both file inputs; both texts with different content", async (t) => {
    await assertRefused(t, { fileVersionUrns: undefined }, /^No file was given: pass fileVersionUrns/);
    await assertRefused(t, { fileVersionUrns: [] }, /^No file was given/);
    await assertRefused(t, { documentVersionId: file(2) }, /^Pass fileVersionUrns or documentVersionId, not both/);
    await assertRefused(t, { notes: "a", description: "b" }, /^Pass notes or description, not both with different text/);
});

test("refused before sending: a URN that is not a file version (lineage id, folder, missing version), and a duplicate", async (t) => {
    await assertRefused(t, { fileVersionUrns: ["urn:adsk.wipprodanz:dm.lineage:93BVtn43TR-9xPgShknJFg"] }, /^File 1: "urn:adsk\.wipprodanz:dm\.lineage:.*" is not a file-version URN\. Expected "urn:adsk\.…:fs\.file:vf\.…\?version=N"/);
    await assertRefused(t, { fileVersionUrns: [file(1), "urn:adsk.wipprodanz:fs.file:vf.TESTfile0002"] }, /^File 2: .* is not a file-version URN/);
    await assertRefused(t, { fileVersionUrns: [FOLDER] }, /is not a file-version URN/);
    await assertRefused(t, { fileVersionUrns: ["Sandbox.docx"] }, /is not a file-version URN/);
    await assertRefused(t, { fileVersionUrns: [file(1), file(2), file(1)] }, /^File 3: .* is listed twice/);
});

test("refused before sending: more than 1000 file versions; exactly 1000 is accepted", async (t) => {
    const many = (n) => Array.from({ length: n }, (_, i) => file(i));
    await assertRefused(t, { fileVersionUrns: many(MAX_FILE_VERSIONS + 1) }, /^1001 file versions were given; one review takes at most 1000/);
    const stub = api(t);
    await createReviewTool.callback(args({ fileVersionUrns: many(MAX_FILE_VERSIONS) }));
    assert.equal(stub.calls[0].body.fileVersions.length, 1000);
});

test("refused before sending: name over 255, notes over 4096; the limits themselves are accepted", async (t) => {
    await assertRefused(t, { name: "n".repeat(256) }, /^Review name is 256 characters; the limit is 255/);
    await assertRefused(t, { notes: "x".repeat(4097) }, /^notes is 4097 characters; the limit is 4096/);
    await assertRefused(t, { description: "x".repeat(4097) }, /^notes is 4097 characters/);
    const stub = api(t);
    await createReviewTool.callback(args({ name: "n".repeat(255), notes: "x".repeat(4096) }));
    assert.equal(stub.calls.length, 1);
});

test("refused before sending: an override folder that is not a folder URN; a step listed twice; a bad step candidate", async (t) => {
    await assertRefused(t, { workflowOptions: { copyFilesOptions: { folderUrn: file(1) } } }, /^workflowOptions\.copyFilesOptions\.folderUrn .* is not a folder URN/);
    const one = [{ type: "user", id: "USERANN" }];
    await assertRefused(t, { workflowOptions: { steps: [{ id: "Lane_r", candidates: one }, { id: "Lane_r", candidates: one }] } }, /^workflowOptions\.steps\[1\]: step id "Lane_r" is listed twice/);
    await assertRefused(t, { workflowOptions: { steps: [{ id: "Lane_r", candidates: [{ type: "role", id: "b5c6ec1f-cf32-462c-b424-7e5a22fba07c" }] }] } }, /^workflowOptions\.steps\[0\] \("Lane_r"\) candidate 1: .* is the role's UUID/);
    await assertRefused(t, { workflowOptions: { steps: [{ id: "Lane_r", candidates: [{ type: "group", id: "g" }] }] } }, /Invalid enum value/);
});

test("an unknown or misspelt input is refused, not dropped (strict schema); ids must be UUID-shaped", async (t) => {
    const stub = api(t);
    await assert.rejects(createReviewTool.callback(args({ fileVersions: [file(1)] })), /Unrecognized key\(s\) in object: 'fileVersions'/);
    await assert.rejects(createReviewTool.callback(args({ workflowOptions: { copyFilesOption: { folderUrn: FOLDER } } })), /Unrecognized key\(s\) in object: 'copyFilesOption'/);
    await assert.rejects(createReviewTool.callback(args({ workflowOptions: { steps: [{ id: "Lane_r", candidate: [] }] } })), /candidates|Unrecognized key/);
    await assert.rejects(createReviewTool.callback(args({ workflowId: "not-a-uuid" })), /workflowId must be a UUID/);
    await assert.rejects(createReviewTool.callback(args({ projectId: `${PROJECT}/../x` })), /projectId must be the project UUID/);
    assert.equal(stub.calls.length, 0);
});

for (const status of [500, 503, 429]) {
    test(`a create answered ${status} is sent exactly once (never retried) and fails with the status in the text`, async (t) => {
        const stub = api(t, { status, body: { detail: "busy" } });
        await assert.rejects(createReviewTool.callback(args()), (e) => { assert.match(e.message, new RegExp(`^Reviews API POST .*/reviews failed \\(${status}\\): `)); return true; });
        assert.equal(stub.calls.length, 1);
    });
}

test("Autodesk's 400 and 403 reach the caller as failures carrying Autodesk's own text", async (t) => {
    const bad = api(t, { status: 400, body: { code: "ERR_BAD_INPUT", detail: "data should NOT have additional properties" } });
    await assert.rejects(createReviewTool.callback(args()), /failed \(400\): .*data should NOT have additional properties/);
    bad.restore();
    api(t, { status: 403, body: { detail: "not an initiator" } });
    await assert.rejects(createReviewTool.callback(args()), /failed \(403\): .*not an initiator/);
});

test("a review Autodesk reports as anything but OPEN carries a WARNING", async (t) => {
    api(t, { body: { ...STORED, status: "FAILED" } });
    const res = await createReviewTool.callback(args());
    assert.match(res.content[0].text, /WARNING — Autodesk reports this review's status as FAILED, not OPEN\./);
    api(t);
    assert.ok(!(await createReviewTool.callback(args())).content[0].text.includes("WARNING"));
});

test("through the MCP server: a refusal and an Autodesk failure both arrive with isError set; success carries result.id", async (t) => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { title, description, inputSchema, callback } = createReviewTool;
    server.registerTool("createReviewTool", { title, description, inputSchema }, callback);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    t.after(async () => { await client.close(); await server.close(); });

    const ok = api(t);
    const refused = await client.callTool({ name: "createReviewTool", arguments: args({ fileVersionUrns: ["Sandbox.docx"] }) });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /^File 1: "Sandbox\.docx" is not a file-version URN/);
    assert.equal(ok.calls.length, 0);
    const created = await client.callTool({ name: "createReviewTool", arguments: args() });
    assert.ok(!created.isError);
    assert.equal(created.structuredContent.result.id, STORED.id);
    ok.restore();

    api(t, { status: 500, body: { detail: "boom" } });
    const failed = await client.callTool({ name: "createReviewTool", arguments: args() });
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /failed \(500\)/);
});

test("buildReviewRequest is pure: it builds the body without any request", () => {
    assert.deepEqual(buildReviewRequest({ workflowId: WORKFLOW, name: "N", fileVersionUrns: [file(1)] }), { name: "N", fileVersions: [{ urn: file(1) }], workflowId: WORKFLOW });
});

// Review round 2 of the workflows PR: the same candidate rules apply to a review's per-step candidates.
test("per-review step candidates: a misspelt key is refused, and an id must state its type (the legacy userId still names a user)", async (t) => {
    const stub = api(t);
    const steps = (candidates) => ({ workflowOptions: { steps: [{ id: "Lane_r", candidates }] } });
    await assert.rejects(createReviewTool.callback(args(steps([{ Type: "company", id: "542830416" }]))), /Unrecognized key\(s\) in object: 'Type'/);
    assert.equal(stub.calls.length, 0);
    stub.restore();
    await assertRefused(t, steps([{ id: "542830416" }]), /^workflowOptions\.steps\[0\] \("Lane_r"\) candidate 1 has no type\. Say whether the id is a "user", a "role" or a "company"/);
    const ok = api(t);
    await createReviewTool.callback(args(steps([{ userId: "USERBOB" }, { type: "company", id: "542830416" }])));
    assert.deepEqual(ok.calls[0].body.workflowOptions.steps[0].candidates, { users: [{ autodeskId: "USERBOB" }], roles: [], companies: [{ autodeskId: "542830416" }] });
});
