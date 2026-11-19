import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { BASE, PROJECT, FOLDER_URN, workflowRecord, reviewsServer } from "./reviews-fixtures.mjs";
import { getReviewWorkflowsTool } from "../tools/get-review-workflows.js";
import { getReviewWorkflowTool } from "../tools/get-review-workflow.js";

const active = (n, from = 0) => Array.from({ length: n }, (_, i) => workflowRecord(from + i));
const inactive = (n, from = 1000) => Array.from({ length: n }, (_, i) => workflowRecord(from + i, { status: "INACTIVE" }));

// ---------------------------------------------------------------------------
// getReviewWorkflowsTool
// ---------------------------------------------------------------------------

test("existing caller: {projectId} alone still works and returns result.results + result.pagination.totalResults", async (t) => {
    const server = reviewsServer(t, { workflows: [...active(7), ...inactive(2)] });
    const res = await getReviewWorkflowsTool.callback({ projectId: PROJECT });
    const { results, pagination } = res.structuredContent.result;
    assert.equal(results.length, 7, "default = Autodesk's default: active only");
    assert.equal(pagination.totalResults, 7);
    assert.equal(pagination.complete, true);
    assert.deepEqual(pagination, { totalResults: 7, offset: 0, limit: 50, nextUrl: "", pages: 1, complete: true });
    assert.ok(results.every((w) => typeof w.name === "string"), "each row keeps its name where acc_delivery.py reads it");
    assert.deepEqual(server.listCalls(), [{ status: null, limit: "50", offset: "0", sort: null, initiator: null }], "no status filter is sent when none was asked for");
    assert.match(res.content[0].text, /^Found 7 review workflow\(s\):\n- "Workflow 0" — id /);
});

for (const n of [0, 1, 50, 51, 170]) {
    test(`returns all of them: ${n} workflows → ${n} results, complete`, async (t) => {
        const server = reviewsServer(t, { workflows: active(n) });
        const res = await getReviewWorkflowsTool.callback({ projectId: PROJECT });
        const { results, pagination } = res.structuredContent.result;
        assert.equal(results.length, n);
        assert.equal(new Set(results.map((w) => w.id)).size, n);
        assert.equal(pagination.totalResults, n);
        assert.equal(pagination.complete, true);
        assert.equal(server.gets().length, Math.max(1, Math.ceil(n / 50)));
        assert.ok(res.content[0].text.startsWith(`Found ${n} review workflow(s)`));
        assert.ok(!res.content[0].text.includes("INCOMPLETE"));
    });
}

test("status filter, each value: active, inactive, all, and none", async (t) => {
    const server = reviewsServer(t, { workflows: [...active(3), ...inactive(2)] });
    const count = async (args) => (await getReviewWorkflowsTool.callback({ projectId: PROJECT, ...args })).structuredContent.result;

    const a = await count({ status: "active" });
    assert.deepEqual([a.results.length, a.results.every((w) => w.status === "ACTIVE")], [3, true]);
    const i = await count({ status: "inactive" });
    assert.deepEqual([i.results.length, i.results.every((w) => w.status === "INACTIVE")], [2, true]);
    const all = await count({ status: "all" });
    assert.equal(all.results.length, 5);
    assert.equal(all.pagination.totalResults, 5);
    assert.equal(all.pagination.complete, true);
    const none = await count({});
    assert.equal(none.results.length, 3);

    assert.deepEqual(server.listCalls().map((c) => c.status), ["ACTIVE", "INACTIVE", "ACTIVE", "INACTIVE", null]);
});

test("status all across pages: 120 active + 60 inactive → 180, complete", async (t) => {
    reviewsServer(t, { workflows: [...active(120), ...inactive(60)] });
    const res = await getReviewWorkflowsTool.callback({ projectId: PROJECT, status: "all" });
    assert.equal(res.structuredContent.result.results.length, 180);
    assert.equal(res.structuredContent.result.pagination.pages, 5);
    assert.equal(res.structuredContent.result.pagination.complete, true);
});

test("a server that ignores offset: INCOMPLETE in the text, complete=false, the real total kept for the caller", async (t) => {
    const server = reviewsServer(t, { workflows: active(170), ignoreOffset: true });
    const res = await getReviewWorkflowsTool.callback({ projectId: PROJECT });
    const { results, pagination } = res.structuredContent.result;
    assert.equal(server.gets().length, 2, "no endless loop");
    assert.equal(results.length, 50);
    assert.equal(pagination.complete, false);
    assert.equal(pagination.stoppedBecause, "repeated_page");
    assert.equal(pagination.totalResults, 170, "acc_delivery.py compares this with the number listed and stops");
    assert.match(res.content[0].text, /^Found 50 review workflow\(s\) — INCOMPLETE: /);
});

test("a missing totalResults: every page is read but the listing is INCOMPLETE", async (t) => {
    reviewsServer(t, { workflows: active(60), omitTotal: true });
    const res = await getReviewWorkflowsTool.callback({ projectId: PROJECT });
    const { results, pagination } = res.structuredContent.result;
    assert.equal(results.length, 60);
    assert.equal(pagination.complete, false);
    assert.equal(pagination.stoppedBecause, "no_total");
    assert.equal(pagination.totalResults, null);
    assert.match(res.content[0].text, /INCOMPLETE/);
});

test("status all: an incomplete half makes the whole listing incomplete", async (t) => {
    reviewsServer(t, { workflows: [...active(2), ...inactive(2)], omitTotal: true });
    const res = await getReviewWorkflowsTool.callback({ projectId: PROJECT, status: "all" });
    assert.equal(res.structuredContent.result.pagination.complete, false);
    assert.equal(res.structuredContent.result.pagination.totalResults, null);
});

test("404: the module-off sentence reaches the caller word for word", async (t) => {
    reviewsServer(t, { listStatus: 404 });
    await assert.rejects(getReviewWorkflowsTool.callback({ projectId: PROJECT }), (e) => {
        assert.equal(
            e.message,
            `Reviews API GET /projects/${PROJECT}/workflows?limit=50&offset=0 returned 404. ` +
            "This usually means the Reviews module is not activated on this project. " +
            "Enable it in ACC Admin > Project > Modules > Reviews, then retry.",
        );
        assert.ok(e.message.includes("Reviews module is not activated"));
        return true;
    });
});

test("text output lists, per workflow: name, id, status, steps (type, who, day type, group review) and the copy destination", async (t) => {
    const rich = workflowRecord(1, {
        name: "Arch — Stage 2",
        steps: [
            { name: "Initiator", type: "INITIATOR", id: "Lane_i", candidates: { companies: [{ name: "Consultant Co", autodeskId: "542830416" }], roles: [], users: [] } },
            { name: "Both sign", type: "REVIEWER", duration: 3, dueDateType: "WORKDAY", groupReview: { enabled: true, type: "ALL" }, id: "Lane_r", candidates: { companies: [], roles: [], users: [{ name: "Ann", autodeskId: "USERANN" }, { name: "Bob", autodeskId: "USERBOB" }] } },
            { name: "Owner", type: "APPROVER", duration: 5, dueDateType: "CALENDAR_DAY", id: "Lane_a", candidates: { companies: [], roles: [], users: [{ name: "Cy", autodeskId: "USERCY" }] } },
        ],
        copyFilesOptions: { enabled: true, allowOverride: false, condition: "ALL", folderUrn: FOLDER_URN, includeMarkups: true, disableOverrideMarkupSetting: false },
    });
    reviewsServer(t, { workflows: [rich] });
    const res = await getReviewWorkflowsTool.callback({ projectId: PROJECT });
    assert.equal(res.content[0].text, [
        "Found 1 review workflow(s):",
        `- "Arch — Stage 2" — id ${rich.id} — ACTIVE`,
        '    INITIATOR "Initiator" [Lane_i]: companies Consultant Co (542830416)',
        '    REVIEWER "Both sign" [Lane_r]: users Ann (USERANN), Bob (USERBOB) — 3 working day(s) — group review: ALL assigned reviewers must respond',
        '    APPROVER "Owner" [Lane_a]: users Cy (USERCY) — 5 calendar day(s)',
        `    copy on approval: ON → folder ${FOLDER_URN} (only when ALL files are approved; with markups; the submitter may not change the folder)`,
    ].join("\n"));
});

test("sort is validated and passed through; not available with status all", async (t) => {
    const server = reviewsServer(t, { workflows: active(2) });
    await getReviewWorkflowsTool.callback({ projectId: PROJECT, sort: "name desc" });
    await getReviewWorkflowsTool.callback({ projectId: PROJECT, sort: "updatedAt" });
    assert.deepEqual(server.listCalls().map((c) => c.sort), ["name desc", "updatedAt"]);
    await assert.rejects(getReviewWorkflowsTool.callback({ projectId: PROJECT, sort: "createdAt" }), /sort must be one of name, status, updatedAt/);
    await assert.rejects(getReviewWorkflowsTool.callback({ projectId: PROJECT, sort: "name asc" }), /sort must be one of/);
    await assert.rejects(getReviewWorkflowsTool.callback({ projectId: PROJECT, sort: "name", status: "all" }), /not available with status "all"/);
    assert.equal(server.gets().length, 2, "a refused sort makes no request");
});

test("initiatorOnly sends filter[initiator]=true and cannot be combined with status", async (t) => {
    const server = reviewsServer(t, { workflows: active(1) });
    await getReviewWorkflowsTool.callback({ projectId: PROJECT, initiatorOnly: true });
    assert.deepEqual(server.listCalls(), [{ status: null, limit: "50", offset: "0", sort: null, initiator: "true" }]);
    await assert.rejects(getReviewWorkflowsTool.callback({ projectId: PROJECT, initiatorOnly: true, status: "active" }), /cannot be combined with status/);
});

test("input schema: projectId is a UUID with or without b.; status is one of three", () => {
    const schema = z.object(getReviewWorkflowsTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT }));
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT.slice(2), status: "all" }));
    assert.throws(() => schema.parse({ projectId: `${PROJECT}/../x` }));
    assert.throws(() => schema.parse({ projectId: PROJECT, status: "ACTIVE" }));
    assert.throws(() => schema.parse({}));
});

// ---------------------------------------------------------------------------
// getReviewWorkflowTool (one workflow)
// ---------------------------------------------------------------------------

test("one workflow by id: the full record in structuredContent.result and the same text block", async (t) => {
    const wf = workflowRecord(5);
    const server = reviewsServer(t, { workflows: [workflowRecord(4), wf] });
    const res = await getReviewWorkflowTool.callback({ projectId: PROJECT, workflowId: wf.id });
    assert.deepEqual(res.structuredContent.result, wf);
    assert.equal(server.calls[0].url, `${BASE}/projects/${PROJECT}/workflows/${wf.id}`);
    assert.match(res.content[0].text, new RegExp(`^- "Workflow 5" — id ${wf.id} — ACTIVE\\n {4}INITIATOR`));
    assert.match(res.content[0].text, /copy on approval: OFF$/);
});

test("one workflow by id, unknown id: says the id was not found — NOT that the Reviews module is off", async (t) => {
    reviewsServer(t, { workflows: [] });
    const id = "12345678-1234-4234-8234-123456789012";
    await assert.rejects(getReviewWorkflowTool.callback({ projectId: PROJECT, workflowId: id }), (e) => {
        assert.match(e.message, new RegExp(`returned 404\\. No workflow with id ${id} was found in this project`));
        assert.ok(!e.message.includes("Reviews module is not activated"));
        return true;
    });
});

test("one workflow: workflowId must be a UUID (nothing that could alter the path)", () => {
    const schema = z.object(getReviewWorkflowTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT, workflowId: "12345678-1234-4234-8234-123456789012" }));
    for (const hostile of ["", "abc", "../reviews", "12345678-1234-4234-8234-123456789012/progress", "12345678-1234-4234-8234-123456789012?x=1"]) {
        assert.throws(() => schema.parse({ projectId: PROJECT, workflowId: hostile }), undefined, `must reject ${JSON.stringify(hostile)}`);
    }
});
