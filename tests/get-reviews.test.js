import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { stubFetch } from "./setup.mjs";
import { setReviewsRetrySleep } from "../tools/reviews-helpers.js";
import { getReviewsTool } from "../tools/get-reviews.js";

const PROJECT = "b.aaaaaaaa-0000-4000-8000-000000000000";
const REVIEWS = `https://developer.api.autodesk.com/construction/reviews/v1/projects/${PROJECT}/reviews`;
const WORKFLOW = "2a1602c6-63a8-43b8-a407-d75aa7e683bd";

function review(i, extra = {}) {
    return {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Review ${i}`, status: "OPEN", sequenceId: i,
        currentStepId: "Lane_r", currentStepDueDate: "2026-11-20T03:53:50.000Z",
        createdBy: { autodeskId: "USERBOT", name: "Service Bot" }, createdAt: "2026-11-19T03:53:50.000Z", updatedAt: "2026-11-19T03:53:50.000Z",
        finishedAt: null, archivedBy: {}, archived: false, archivedAt: null, workflowId: WORKFLOW,
        nextActionBy: { claimedBy: [], candidates: { roles: [], users: [{ autodeskId: "USERANN", name: "Ann" }], companies: [] } },
        approvedBy: {}, approvedAt: null,
        ...extra,
    };
}
const reviews = (n, extra) => Array.from({ length: n }, (_, i) => review(i + 1, extra));

/** In-memory GET …/reviews: honours limit, offset, filter[status] (upper case only, like the live API) and filter[archived]. */
function api(t, all = [], { ignoreOffset = false, omitTotal = false, status } = {}) {
    const previous = setReviewsRetrySleep(async () => {});
    const stub = stubFetch(async (url, init = {}) => {
        const u = new URL(url);
        if ((init.method ?? "GET") !== "GET" || `${u.origin}${u.pathname}` !== REVIEWS) throw new Error(`unexpected call ${init.method ?? "GET"} ${url}`);
        if (status) return { status, body: { detail: `stubbed ${status}` } };
        const wanted = u.searchParams.get("filter[status]");
        if (wanted !== null && !["OPEN", "CLOSED", "VOID", "FAILED"].includes(wanted)) {
            return { status: 400, body: { code: "ERR_BAD_INPUT", detail: "query.filter.status should be equal to one of the allowed values" } };
        }
        const archived = u.searchParams.get("filter[archived]") === "true";
        const limit = Number(u.searchParams.get("limit") ?? 50), offset = Number(u.searchParams.get("offset") ?? 0);
        const matching = all.filter((r) => (wanted === null || r.status === wanted) && Boolean(r.archived) === archived);
        const start = ignoreOffset ? 0 : offset;
        const results = matching.slice(start, start + limit);
        return { status: 200, body: { results, pagination: omitTotal ? { offset, limit, nextUrl: "" } : { totalResults: matching.length, offset, limit, nextUrl: "" } } };
    });
    t.after(() => { stub.restore(); setReviewsRetrySleep(previous); });
    return {
        ...stub,
        queries: () => stub.calls.map((c) => Object.fromEntries(new URL(c.url).searchParams.entries())),
        rawQuery: (i = 0) => stub.calls[i].url.split("?")[1],
    };
}
const list = (args = {}) => getReviewsTool.callback({ projectId: PROJECT, ...args });
const results = (res) => res.structuredContent.result.results;

for (const n of [0, 1, 50, 51, 170]) {
    test(`paging: ${n} reviews → ${n} results, complete`, async (t) => {
        const server = api(t, reviews(n));
        const res = await list();
        assert.equal(results(res).length, n);
        assert.equal(new Set(results(res).map((r) => r.id)).size, n);
        assert.deepEqual(res.structuredContent.result.pagination, { totalResults: n, offset: 0, limit: 50, nextUrl: "", pages: Math.max(1, Math.ceil(n / 50)), complete: true });
        assert.equal(server.calls.length, Math.max(1, Math.ceil(n / 50)));
        assert.ok(res.content[0].text.startsWith(`Found ${n} review(s)`));
        assert.ok(!res.content[0].text.includes("INCOMPLETE"));
    });
}

test("paging: a server that ignores offset, and one that reports no total → INCOMPLETE, never a partial list as whole", async (t) => {
    const repeated = api(t, reviews(170), { ignoreOffset: true });
    const a = await list();
    assert.equal(repeated.calls.length, 2);
    assert.equal(results(a).length, 50);
    assert.equal(a.structuredContent.result.pagination.complete, false);
    assert.equal(a.structuredContent.result.pagination.stoppedBecause, "repeated_page");
    assert.match(a.content[0].text, /^Found 50 review\(s\) — INCOMPLETE: /);
    repeated.restore();

    api(t, reviews(60), { omitTotal: true });
    const b = await list();
    assert.equal(results(b).length, 60);
    assert.equal(b.structuredContent.result.pagination.complete, false);
    assert.equal(b.structuredContent.result.pagination.stoppedBecause, "no_total");
});

test("status, each value: open / closed / void / failed in any case are sent upper-case; all and none send no filter", async (t) => {
    const all = [review(1), review(2), review(3, { status: "CLOSED" }), review(4, { status: "VOID" }), review(5, { status: "FAILED" })];
    const server = api(t, all);
    const count = async (status) => results(await list(status === undefined ? {} : { status })).length;
    assert.deepEqual(
        [await count("open"), await count("CLOSED"), await count("Void"), await count("failed"), await count("all"), await count("ALL"), await count(undefined)],
        [2, 1, 1, 1, 5, 5, 5],
    );
    assert.deepEqual(server.queries().map((q) => q["filter[status]"] ?? null), ["OPEN", "CLOSED", "VOID", "FAILED", null, null, null]);
    await assert.rejects(list({ status: "pending" }), /status "pending" is not one of open, closed, void, failed or all/);
    assert.equal(server.calls.length, 7, "a refused status makes no request");
});

test("archived: omitted lists only non-archived reviews; true lists only archived ones", async (t) => {
    const server = api(t, [review(1), review(2, { archived: true, status: "CLOSED" })]);
    assert.deepEqual(results(await list()).map((r) => r.sequenceId), [1]);
    assert.deepEqual(results(await list({ archived: true })).map((r) => r.sequenceId), [2]);
    assert.deepEqual(results(await list({ archived: false })).map((r) => r.sequenceId), [1]);
    assert.deepEqual(server.queries().map((q) => q["filter[archived]"] ?? null), [null, "true", "false"]);
});

test("every documented filter is sent under Autodesk's own name", async (t) => {
    const server = api(t, []);
    await list({
        status: "open", workflowId: WORKFLOW, name: "Stage 2 & 3", sequenceId: 12,
        nextActionByUser: "USERANN", nextActionByRole: "542830447", nextActionByCompany: "542830416",
        archived: true, archivedBy: "USERBOB", approvedBy: ["USERCY", "USERDEE"],
        createdAt: "2026-11-01..2026-11-30", updatedAt: "2026-11-01..2026-11-30", finishedAt: "2026-11-01T00:00:00Z..2026-11-30T23:59:59Z",
        approvedAt: "2026-11-01..2026-11-30", currentStepDueDate: "2026-11-19..2026-11-26", archivedAt: "2026-11-01..2026-11-30",
        sort: "createdAt desc",
    });
    assert.deepEqual(server.queries()[0], {
        limit: "50", offset: "0",
        "filter[status]": "OPEN", "filter[workflowId]": WORKFLOW, "filter[name]": "Stage 2 & 3", "filter[sequenceId]": "12",
        "filter[nextActionByUser]": "USERANN", "filter[nextActionByRole]": "542830447", "filter[nextActionByCompany]": "542830416",
        "filter[archived]": "true", "filter[archivedBy]": "USERBOB", "filter[approvedBy]": "USERCY,USERDEE",
        "filter[currentStepDueDate]": "2026-11-19..2026-11-26", "filter[createdAt]": "2026-11-01..2026-11-30", "filter[updatedAt]": "2026-11-01..2026-11-30",
        "filter[finishedAt]": "2026-11-01T00:00:00Z..2026-11-30T23:59:59Z", "filter[approvedAt]": "2026-11-01..2026-11-30", "filter[archivedAt]": "2026-11-01..2026-11-30",
        sort: "createdAt desc",
    });
    assert.ok(server.rawQuery().includes("filter[name]=Stage%202%20%26%203"), "values are URL-encoded; the bracket keys are sent as given");
});

test("with no filters only limit and offset are sent", async (t) => {
    const server = api(t, reviews(1));
    await list();
    assert.equal(server.rawQuery(), "limit=50&offset=0");
});

test("refused before sending: archivedBy / archivedAt without archived: true; a malformed date range; a bad sort", async (t) => {
    const server = api(t, []);
    await assert.rejects(list({ archivedBy: "USERBOB" }), /archivedBy only applies to archived reviews — pass archived: true/);
    await assert.rejects(list({ archivedAt: "2026-11-01..2026-11-30", archived: false }), /archivedAt only applies to archived reviews/);
    for (const bad of ["2026-11-01", "2026-11-01 to 2026-11-30", "last week", "2026-11-01..", "01/11/2026..30/11/2026"]) {
        await assert.rejects(list({ createdAt: bad }), /createdAt must be a range "start\.\.end" in ISO 8601/, bad);
    }
    await assert.rejects(list({ sort: "updatedAt" }), /sort must be one of name, status, sequenceId, currentStepDueDate, createdAt, finishedAt/);
    await assert.rejects(list({ sort: "name up" }), /sort must be one of/);
    assert.equal(server.calls.length, 0);
});

test("text output per review: number, name, id, status, workflow, creator, the waiting step and who acts next", async (t) => {
    api(t, [
        review(5, { name: "Stage 2 drawings" }),
        review(4, { status: "CLOSED", finishedAt: "2026-11-18T01:00:00.000Z", nextActionBy: { claimedBy: [], candidates: { roles: [], users: [], companies: [] } }, approvedBy: { autodeskId: "USERCY", name: "Cy" }, approvedAt: "2026-11-18T01:00:00.000Z" }),
        review(3, { nextActionBy: { claimedBy: [{ autodeskId: "USERANN", name: "Ann" }], candidates: { roles: [], users: [{ autodeskId: "USERANN", name: "Ann" }, { autodeskId: "USERBOB", name: "Bob" }], companies: [] } } }),
    ]);
    const res = await list();
    assert.equal(res.content[0].text, [
        "Found 3 review(s):",
        '- #5 "Stage 2 drawings" — id 00000000-0000-4000-8000-000000000005 — OPEN',
        `    workflow ${WORKFLOW} | created 2026-11-19 by Service Bot (USERBOT)`,
        "    waiting at step Lane_r (due 2026-11-20): users Ann (USERANN)",
        '- #4 "Review 4" — id 00000000-0000-4000-8000-000000000004 — CLOSED',
        `    workflow ${WORKFLOW} | created 2026-11-19 by Service Bot (USERBOT) | finished 2026-11-18`,
        "    final decision by Cy (USERCY) on 2026-11-18",
        '- #3 "Review 3" — id 00000000-0000-4000-8000-000000000003 — OPEN',
        `    workflow ${WORKFLOW} | created 2026-11-19 by Service Bot (USERBOT)`,
        "    waiting at step Lane_r (due 2026-11-20): claimed by Ann (USERANN)",
    ].join("\n"));
});

test("a 404 on the list keeps the module-off sentence", async (t) => {
    api(t, [], { status: 404 });
    await assert.rejects(list(), /returned 404\. This usually means the Reviews module is not activated on this project\./);
});

test("input schema: UUID project id (b. optional); workflowId a UUID; approvedBy 1–10 ids; sequenceId a positive whole number", () => {
    const schema = z.object(getReviewsTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT }));
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT.slice(2), workflowId: WORKFLOW, approvedBy: ["A"], sequenceId: 3 }));
    assert.throws(() => schema.parse({ projectId: `${PROJECT}?x=1` }));
    assert.throws(() => schema.parse({ projectId: PROJECT, workflowId: "wf-1" }));
    assert.throws(() => schema.parse({ projectId: PROJECT, approvedBy: [] }));
    assert.throws(() => schema.parse({ projectId: PROJECT, approvedBy: Array.from({ length: 11 }, (_, i) => `U${i}`) }));
    assert.throws(() => schema.parse({ projectId: PROJECT, sequenceId: 0 }));
    assert.throws(() => schema.parse({ projectId: PROJECT, sequenceId: 1.5 }));
});
