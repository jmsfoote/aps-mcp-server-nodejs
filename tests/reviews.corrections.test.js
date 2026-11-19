// The compatibility pin and the two corrections for createReviewTool and getReviewsTool.
//
// This file uses nothing but the two tools and stubFetch, so it also runs unchanged against the previous
// version (ptp/main 7d3d75b). There the "pinned" tests pass and the "correction" tests fail — that run is
// the RED evidence in the PR body.
import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "./setup.mjs";
import { createReviewTool } from "../tools/create-review.js";
import { getReviewsTool } from "../tools/get-reviews.js";

const PROJECT = "b.aaaaaaaa-0000-4000-8000-000000000000";
const REVIEWS = `https://developer.api.autodesk.com/construction/reviews/v1/projects/${PROJECT}/reviews`;
const WORKFLOW = "2a1602c6-63a8-43b8-a407-d75aa7e683bd";
const FILE_V3 = "urn:adsk.wipprodanz:fs.file:vf.93BVtn43TR-9xPgShknJFg?version=3";

/** Autodesk's Reviews API for one project, reduced to what these tests need. It validates the two things
 * the live API was seen to validate on 2026-11-19: the create body's keys, and the status filter's case. */
function reviewsApi(t, reviews = []) {
    const stub = stubFetch(async (url, init = {}) => {
        const u = new URL(url);
        const method = init.method ?? "GET";
        if (`${u.origin}${u.pathname}` !== REVIEWS) throw new Error(`unexpected call ${method} ${url}`);
        if (method === "POST") {
            const body = JSON.parse(init.body);
            const allowed = ["name", "fileVersions", "workflowId", "notes", "workflowOptions"];
            if (Object.keys(body).some((k) => !allowed.includes(k))) {
                return { status: 400, body: { code: "ERR_BAD_INPUT", title: "The request has invalid header or body", detail: "data should NOT have additional properties" } };
            }
            return { status: 201, body: { id: "138cd1df-4576-4401-bcee-068b0b41d8e0", name: body.name, status: "OPEN", sequenceId: 5, workflowId: body.workflowId } };
        }
        const status = u.searchParams.get("filter[status]");
        if (status !== null && !["OPEN", "CLOSED", "VOID", "FAILED"].includes(status)) {
            return { status: 400, body: { code: "ERR_BAD_INPUT", title: "The request has invalid header or body", detail: "query.filter.status should be equal to one of the allowed values" } };
        }
        const results = reviews.filter((r) => status === null || r.status === status);
        return { status: 200, body: { results, pagination: { totalResults: results.length, offset: 0, limit: 50, nextUrl: "" } } };
    });
    t.after(() => stub.restore());
    return stub;
}
const review = (i, status) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Review ${i}`, status, sequenceId: i, workflowId: WORKFLOW });
const THREE = [review(1, "OPEN"), review(2, "OPEN"), review(3, "CLOSED")];

// ---------------------------------------------------------------------------
// Pinned
// ---------------------------------------------------------------------------

test("pinned: getReviewsTool with {projectId} alone lists the reviews in structuredContent.result.results", async (t) => {
    reviewsApi(t, THREE);
    const res = await getReviewsTool.callback({ projectId: PROJECT });
    assert.equal(res.structuredContent.result.results.length, 3);
    assert.match(res.content[0].text, /^Found 3 review\(s\)/);
});

test("pinned: status 'all' still means no status filter", async (t) => {
    const stub = reviewsApi(t, THREE);
    const res = await getReviewsTool.callback({ projectId: PROJECT, status: "all" });
    assert.equal(res.structuredContent.result.results.length, 3);
    assert.equal(new URL(stub.calls[0].url).searchParams.get("filter[status]"), null);
});

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

test("correction: the old inputs (documentVersionId, description) still start a review — sent as Autodesk's documented body", async (t) => {
    const stub = reviewsApi(t);
    const res = await createReviewTool.callback({ projectId: PROJECT, workflowId: WORKFLOW, name: "PA-001 Review", description: "Claim 1", documentVersionId: FILE_V3 });
    assert.deepEqual(stub.calls[0].body, { name: "PA-001 Review", fileVersions: [{ urn: FILE_V3 }], workflowId: WORKFLOW, notes: "Claim 1" });
    assert.equal(res.structuredContent.result.id, "138cd1df-4576-4401-bcee-068b0b41d8e0");
    assert.match(res.content[0].text, /^Created review "PA-001 Review" using workflow 2a1602c6-63a8-43b8-a407-d75aa7e683bd\. Review ID: 138cd1df-4576-4401-bcee-068b0b41d8e0/);
});

test("correction: the create body never carries documentVersionId or description (Autodesk rejects unknown keys with HTTP 400)", async (t) => {
    const stub = reviewsApi(t);
    await createReviewTool.callback({ projectId: PROJECT, workflowId: WORKFLOW, name: "N", documentVersionId: FILE_V3 });
    assert.deepEqual(Object.keys(stub.calls[0].body).sort(), ["fileVersions", "name", "workflowId"]);
});

for (const [given, sent, expected] of [["open", "OPEN", 2], ["closed", "CLOSED", 1], ["Open", "OPEN", 2]]) {
    test(`correction: status '${given}' is sent as ${sent} (the API rejects lower case with HTTP 400)`, async (t) => {
        const stub = reviewsApi(t, THREE);
        const res = await getReviewsTool.callback({ projectId: PROJECT, status: given });
        assert.equal(new URL(stub.calls[0].url).searchParams.get("filter[status]"), sent);
        assert.equal(res.structuredContent.result.results.length, expected);
    });
}
