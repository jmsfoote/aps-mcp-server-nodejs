import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { stubFetch } from "./setup.mjs";
import { setReviewsRetrySleep } from "../tools/reviews-helpers.js";
import { getReviewTool } from "../tools/get-review.js";
import { getReviewProgressTool } from "../tools/get-review-progress.js";
import { getReviewVersionsTool } from "../tools/get-review-versions.js";
import { getReviewWorkflowSnapshotTool } from "../tools/get-review-workflow-snapshot.js";
import { getVersionApprovalStatusesTool } from "../tools/get-version-approval-statuses.js";

const BASE = "https://developer.api.autodesk.com/construction/reviews/v1";
const PROJECT = "b.aaaaaaaa-0000-4000-8000-000000000000";
const REVIEW = "138cd1df-4576-4401-bcee-068b0b41d8e0";
const WORKFLOW = "2a1602c6-63a8-43b8-a407-d75aa7e683bd";
const FILE_V3 = "urn:adsk.wipprodanz:fs.file:vf.93BVtn43TR-9xPgShknJFg?version=3";
const FOLDER = "urn:adsk.wipprodanz:fs.folder:co.TESTfolder000000000000";

/**
 * Stub fetch with fixed answers per path (after …/projects/{PROJECT}). A value is a JSON body (200), a
 * { __status, body } pair, or a function (url) => either. List answers given as arrays are paged by limit/offset.
 */
function api(t, routes) {
    const previous = setReviewsRetrySleep(async () => {});
    const stub = stubFetch(async (url, init = {}) => {
        if ((init.method ?? "GET") !== "GET") throw new Error(`a read tool sent ${init.method} ${url}`);
        const prefix = `${BASE}/projects/${PROJECT}`;
        const [plain, query = ""] = url.split("?");
        // The approval-statuses path embeds an encoded URN, which itself contains "%3F"; split on the first raw "?".
        const path = plain.startsWith(prefix) ? plain.slice(prefix.length) : null;
        if (path === null || !(path in routes)) return { status: 404, body: { detail: "not found" } };
        let answer = routes[path];
        if (typeof answer === "function") answer = answer(new URLSearchParams(query));
        if (Array.isArray(answer)) {
            const q = new URLSearchParams(query);
            const limit = Number(q.get("limit") ?? 50), offset = Number(q.get("offset") ?? 0);
            return { status: 200, body: { results: answer.slice(offset, offset + limit), pagination: { totalResults: answer.length, offset, limit, nextUrl: "" } } };
        }
        if (answer && answer.__status) return { status: answer.__status, body: answer.body ?? {} };
        return { status: 200, body: answer };
    });
    t.after(() => { stub.restore(); setReviewsRetrySleep(previous); });
    return stub;
}

const REVIEW_RECORD = {
    id: REVIEW, name: "Stage 2 drawings", status: "OPEN", sequenceId: 5, currentStepId: "Lane_r", currentStepDueDate: "2026-11-20T03:53:50.000Z",
    createdBy: { autodeskId: "USERBOT", name: "Service Bot" }, createdAt: "2026-11-19T03:53:50.000Z", updatedAt: "2026-11-19T03:53:50.000Z",
    finishedAt: null, archivedBy: {}, archived: false, archivedAt: null, workflowId: WORKFLOW,
    nextActionBy: { claimedBy: [], candidates: { roles: [], users: [{ autodeskId: "USERANN", name: "Ann" }], companies: [] } },
    approvedBy: {}, approvedAt: null,
};

// ---------------------------------------------------------------------------
// getReviewTool
// ---------------------------------------------------------------------------

test("one review by id: the record and its text block", async (t) => {
    const stub = api(t, { [`/reviews/${REVIEW}`]: REVIEW_RECORD });
    const res = await getReviewTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(stub.calls[0].url, `${BASE}/projects/${PROJECT}/reviews/${REVIEW}`);
    assert.deepEqual(res.structuredContent.result, REVIEW_RECORD);
    assert.equal(res.content[0].text, [
        `- #5 "Stage 2 drawings" — id ${REVIEW} — OPEN`,
        `    workflow ${WORKFLOW} | created 2026-11-19 by Service Bot (USERBOT)`,
        "    waiting at step Lane_r (due 2026-11-20): users Ann (USERANN)",
    ].join("\n"));
});

// ---------------------------------------------------------------------------
// getReviewProgressTool
// ---------------------------------------------------------------------------

const PROGRESS = [
    { stepId: "Lane_r", stepName: "Reviewer", claimedBy: {}, actionBy: {}, candidates: { roles: [], users: [{ autodeskId: "USERANN", name: "Ann" }], companies: [] }, endTime: null, notes: "", status: "UNCLAIMED" },
    { stepId: "Lane_i", stepName: "Initiator", claimedBy: { autodeskId: "USERBOT", name: "Service Bot" }, actionBy: {}, candidates: { roles: [], users: [], companies: [] }, endTime: "2026-11-19T03:53:50.986Z", notes: "", status: "SUBMITTED" },
];

test("a review's progress: each step's state, who claimed or acted, when, and any note", async (t) => {
    const done = { stepId: "Lane_a", stepName: "Approver", claimedBy: { autodeskId: "USERCY", name: "Cy" }, actionBy: { autodeskId: "USERCY", name: "Cy" }, candidates: {}, endTime: "2026-11-19T05:00:00.000Z", notes: "Fine by me", status: "SUBMITTED" };
    api(t, { [`/reviews/${REVIEW}/progress`]: [done, ...PROGRESS] });
    const res = await getReviewProgressTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(res.content[0].text, [
        `Review ${REVIEW}: 3 progress row(s):`,
        '- Approver [Lane_a]: SUBMITTED by Cy (USERCY) at 2026-11-19T05:00:00.000Z — note: "Fine by me"',
        "- Reviewer [Lane_r]: UNCLAIMED open to users Ann (USERANN)",
        "- Initiator [Lane_i]: SUBMITTED claimed by Service Bot (USERBOT) at 2026-11-19T03:53:50.986Z",
    ].join("\n"));
    assert.equal(res.structuredContent.result.results.length, 3);
    assert.deepEqual(res.structuredContent.result.pagination, { totalResults: 3, offset: 0, limit: 50, nextUrl: "", pages: 1, complete: true });
});

test("a review's progress pages past 50 rows; rows without ids that happen to be identical are all kept", async (t) => {
    const row = (i) => ({ stepId: `Lane_${i % 3}`, stepName: `Step ${i % 3}`, claimedBy: {}, actionBy: { autodeskId: "USERANN", name: "Ann" }, candidates: {}, endTime: `2026-11-19T05:00:${String(i % 60).padStart(2, "0")}.000Z`, notes: "", status: "SUBMITTED" });
    const many = Array.from({ length: 120 }, (_, i) => row(i));
    many[7] = { ...many[6] }; // two identical rows are both real
    const stub = api(t, { [`/reviews/${REVIEW}/progress`]: many });
    const res = await getReviewProgressTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(res.structuredContent.result.results.length, 120);
    assert.equal(res.structuredContent.result.pagination.complete, true);
    assert.equal(stub.calls.length, 3);
});

test("a review's progress: a server that ignores offset is caught even though rows carry no id", async (t) => {
    const many = Array.from({ length: 120 }, (_, i) => ({ stepId: `Lane_${i}`, stepName: `Step ${i}`, status: "SUBMITTED" }));
    const stub = api(t, { [`/reviews/${REVIEW}/progress`]: () => ({ results: many.slice(0, 50), pagination: { totalResults: 120, offset: 0, limit: 50, nextUrl: "" } }) });
    const res = await getReviewProgressTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(stub.calls.length, 2, "stops at the repeated page");
    assert.equal(res.structuredContent.result.results.length, 50);
    assert.equal(res.structuredContent.result.pagination.complete, false);
    assert.equal(res.structuredContent.result.pagination.stoppedBecause, "repeated_page");
    assert.match(res.content[0].text, /INCOMPLETE/);
});

// ---------------------------------------------------------------------------
// getReviewVersionsTool
// ---------------------------------------------------------------------------

const PENDING_FILE = { urn: FILE_V3, name: "Sandbox.docx", itemUrn: "urn:adsk.wipprodanz:dm.lineage:93BVtn43TR-9xPgShknJFg", approveStatus: null, reviewContent: { name: "Sandbox.docx", customAttributes: [] } };
const APPROVED_FILE = {
    urn: "urn:adsk.wipprodanz:fs.file:vf.iJji1LYXR5y_zxzdgkM4qw?version=1", name: "A2200.pdf", itemUrn: "urn:adsk.wipprodanz:dm.lineage:iJji1LYXR5y_zxzdgkM4qw",
    approveStatus: { id: "s-1", label: "Approved w/ comments", value: "APPROVED" }, reviewContent: { name: "A2200.pdf", customAttributes: [] },
    copiedFileVersionUrn: "urn:adsk.wipprodanz:fs.file:vf.2oMMkWKiRcet6uBvwJrnoA?version=1",
};

test("a review's files: approval status and where the approved copy went; a file with no decision says so", async (t) => {
    api(t, { [`/reviews/${REVIEW}/versions`]: [APPROVED_FILE, PENDING_FILE] });
    const res = await getReviewVersionsTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(res.content[0].text, [
        `Review ${REVIEW}: 2 file version(s):`,
        `- A2200.pdf — ${APPROVED_FILE.urn}`,
        `    approval: "Approved w/ comments" (APPROVED) | copied to ${APPROVED_FILE.copiedFileVersionUrn}`,
        `- Sandbox.docx — ${FILE_V3}`,
        "    approval: no decision yet | no copy made",
    ].join("\n"));
    assert.deepEqual(res.structuredContent.result.results, [APPROVED_FILE, PENDING_FILE]);
    assert.equal(res.structuredContent.result.pagination.complete, true);
});

test("a review's files: approveStatusLabels are sent as repeated filter[approveStatus] keys, URL-encoded; none sent when omitted", async (t) => {
    const stub = api(t, { [`/reviews/${REVIEW}/versions`]: [APPROVED_FILE] });
    await getReviewVersionsTool.callback({ projectId: PROJECT, reviewId: REVIEW, approveStatusLabels: ["Approved", "Approved w/ comments"] });
    assert.equal(stub.calls[0].url, `${BASE}/projects/${PROJECT}/reviews/${REVIEW}/versions?limit=50&offset=0&filter[approveStatus]=Approved&filter[approveStatus]=Approved%20w%2F%20comments`);
    await getReviewVersionsTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(stub.calls[1].url, `${BASE}/projects/${PROJECT}/reviews/${REVIEW}/versions?limit=50&offset=0`);
});

test("a review's files page past 50 (up to 1000 files can be in one review)", async (t) => {
    const many = Array.from({ length: 170 }, (_, i) => ({ ...PENDING_FILE, urn: `urn:adsk.wipprodanz:fs.file:vf.FILE${i}?version=1`, name: `f${i}.pdf` }));
    const stub = api(t, { [`/reviews/${REVIEW}/versions`]: many });
    const res = await getReviewVersionsTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(res.structuredContent.result.results.length, 170);
    assert.equal(stub.calls.length, 4);
});

// ---------------------------------------------------------------------------
// getReviewWorkflowSnapshotTool
// ---------------------------------------------------------------------------

test("the workflow a review was started with: steps, candidates and the copy folder in force for that review", async (t) => {
    const snapshot = {
        name: "Design review", description: "", notes: "", id: WORKFLOW, approvalStatusOptions: [],
        steps: [
            { name: "Initiator", type: "INITIATOR", id: "Lane_i", candidates: { companies: [], roles: [], users: [{ name: "Service Bot", autodeskId: "USERBOT" }] } },
            { name: "Reviewer", type: "REVIEWER", id: "Lane_r", duration: 1, dueDateType: "CALENDAR_DAY", candidates: { companies: [], roles: [], users: [{ name: "Ann", autodeskId: "USERANN" }] } },
            { name: "Approver", type: "APPROVER", id: "Lane_a", candidates: { companies: [], roles: [], users: [{ name: "Cy", autodeskId: "USERCY" }] } },
        ],
        copyFilesOptions: { enabled: true, allowOverride: true, condition: "ANY", folderUrn: FOLDER, includeMarkups: false, disableOverrideMarkupSetting: false },
        attachedAttributes: [], updateAttributesOptions: {}, additionalOptions: {},
    };
    const stub = api(t, { [`/reviews/${REVIEW}/workflow`]: snapshot });
    const res = await getReviewWorkflowSnapshotTool.callback({ projectId: PROJECT, reviewId: REVIEW });
    assert.equal(stub.calls[0].url, `${BASE}/projects/${PROJECT}/reviews/${REVIEW}/workflow`);
    assert.deepEqual(res.structuredContent.result, snapshot);
    assert.equal(res.content[0].text, [
        `Workflow snapshot for review ${REVIEW}:`,
        `- "Design review" — id ${WORKFLOW} — snapshot at review start`,
        '    INITIATOR "Initiator" [Lane_i]: users Service Bot (USERBOT)',
        '    REVIEWER "Reviewer" [Lane_r]: users Ann (USERANN) — 1 calendar day(s) — group review: off (one reviewer acts)',
        '    APPROVER "Approver" [Lane_a]: users Cy (USERCY) — time allowed not reported',
        `    copy on approval: ON → folder ${FOLDER} (when ANY file is approved; without markups; the submitter may change the folder)`,
    ].join("\n"));
});

// ---------------------------------------------------------------------------
// getVersionApprovalStatusesTool
// ---------------------------------------------------------------------------

test("a file version's approval statuses: one row per review it has been in; the URN is URL-encoded into the path", async (t) => {
    const rows = [
        { approvalStatus: { id: "s-0", label: "In review", value: "IN_REVIEW" }, review: { id: REVIEW, sequenceId: 5, status: "OPEN" } },
        { approvalStatus: { id: "s-1", label: "Rejected", value: "REJECTED" }, review: { id: "00000000-0000-4000-8000-000000000002", sequenceId: 2, status: "CLOSED" } },
    ];
    const encoded = "urn%3Aadsk.wipprodanz%3Afs.file%3Avf.93BVtn43TR-9xPgShknJFg%3Fversion%3D3";
    const stub = api(t, { [`/versions/${encoded}/approval-statuses`]: rows });
    const res = await getVersionApprovalStatusesTool.callback({ projectId: PROJECT, versionUrn: FILE_V3 });
    assert.equal(stub.calls[0].url, `${BASE}/projects/${PROJECT}/versions/${encoded}/approval-statuses?limit=50&offset=0`);
    assert.equal(res.content[0].text, [
        `File version ${FILE_V3}: 2 approval status(es):`,
        `- "In review" (IN_REVIEW) — review #5 (OPEN) id ${REVIEW}`,
        '- "Rejected" (REJECTED) — review #2 (CLOSED) id 00000000-0000-4000-8000-000000000002',
    ].join("\n"));
    assert.equal(res.structuredContent.result.pagination.complete, true);
});

test("a file version never in a review: no rows, complete", async (t) => {
    const encoded = encodeURIComponent(FILE_V3);
    api(t, { [`/versions/${encoded}/approval-statuses`]: [] });
    const res = await getVersionApprovalStatusesTool.callback({ projectId: PROJECT, versionUrn: FILE_V3 });
    assert.equal(res.content[0].text, `File version ${FILE_V3}: 0 approval status(es)`);
    assert.equal(res.structuredContent.result.pagination.complete, true);
});

// ---------------------------------------------------------------------------
// Shared: 404 wording, id shapes, read-only
// ---------------------------------------------------------------------------

const BY_REVIEW = [
    ["getReviewTool", getReviewTool, "review"],
    ["getReviewProgressTool", getReviewProgressTool, "review"],
    ["getReviewVersionsTool", getReviewVersionsTool, "review"],
    ["getReviewWorkflowSnapshotTool", getReviewWorkflowSnapshotTool, "review"],
];

for (const [name, tool] of BY_REVIEW) {
    test(`${name}: an unknown review id says the review was not found — not that the Reviews module is off`, async (t) => {
        api(t, {});
        await assert.rejects(tool.callback({ projectId: PROJECT, reviewId: REVIEW }), (e) => {
            assert.match(e.message, new RegExp(`returned 404\\. No review with id ${REVIEW} was found in this project`));
            assert.ok(!e.message.includes("Reviews module is not activated"));
            return true;
        });
    });

    test(`${name}: reviewId must be a UUID (the number shown in Forma, or anything path-altering, is rejected)`, () => {
        const schema = z.object(tool.inputSchema);
        assert.doesNotThrow(() => schema.parse({ projectId: PROJECT, reviewId: REVIEW }));
        for (const bad of ["5", "", `${REVIEW}/progress`, `../workflows/${REVIEW}`, `${REVIEW}?x=1`]) {
            assert.throws(() => schema.parse({ projectId: PROJECT, reviewId: bad }), undefined, `must reject ${JSON.stringify(bad)}`);
        }
        assert.throws(() => schema.parse({ projectId: `${PROJECT}#`, reviewId: REVIEW }));
    });
}

test("getVersionApprovalStatusesTool: an unknown file version has its own 404 sentence; versionUrn must be a file-version URN", async (t) => {
    api(t, {});
    await assert.rejects(getVersionApprovalStatusesTool.callback({ projectId: PROJECT, versionUrn: FILE_V3 }), (e) => {
        assert.match(e.message, /returned 404\. No file version urn:adsk\.wipprodanz:fs\.file:vf\.93BVtn43TR-9xPgShknJFg\?version=3 was found in this project/);
        assert.ok(!e.message.includes("Reviews module is not activated"));
        return true;
    });
    const schema = z.object(getVersionApprovalStatusesTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT, versionUrn: FILE_V3 }));
    for (const bad of ["urn:adsk.wipprodanz:dm.lineage:93BVtn43TR-9xPgShknJFg", "urn:adsk.wipprodanz:fs.file:vf.93BVtn43TR-9xPgShknJFg", FOLDER, "Sandbox.docx", `${FILE_V3}/../../reviews`]) {
        assert.throws(() => schema.parse({ projectId: PROJECT, versionUrn: bad }), undefined, `must reject ${JSON.stringify(bad)}`);
    }
});

test("a failure other than 404 keeps Autodesk's status and text (a read is retried on 5xx first)", async (t) => {
    const stub = api(t, { [`/reviews/${REVIEW}`]: { __status: 403, body: { detail: "no access" } }, [`/reviews/${REVIEW}/progress`]: { __status: 500, body: { detail: "boom" } } });
    await assert.rejects(getReviewTool.callback({ projectId: PROJECT, reviewId: REVIEW }), /failed \(403\): .*no access/);
    assert.equal(stub.calls.length, 1);
    await assert.rejects(getReviewProgressTool.callback({ projectId: PROJECT, reviewId: REVIEW }), /failed \(500\)/);
    assert.equal(stub.calls.length, 1 + 3, "the 500 was retried twice before failing");
});
