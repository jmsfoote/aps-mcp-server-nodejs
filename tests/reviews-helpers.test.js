import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { stubFetch } from "./setup.mjs";
import {
    reviewsApiCall, fetchAllReviewsPages, setReviewsRetrySleep, reviewsProjectId, reviewsQuery, notFoundById,
    incompleteNote, mergedPagination, formatWorkflow, REVIEWS_PAGE_SIZE, REVIEWS_READ_RETRY_DELAYS_MS,
} from "../tools/reviews-helpers.js";

const BASE = "https://developer.api.autodesk.com/construction/reviews/v1";
const PROJECT = "b.aaaaaaaa-0000-4000-8000-000000000000";

/** No real waiting between read retries; records the waits asked for. */
function noSleep(t) {
    const waits = [];
    const previous = setReviewsRetrySleep(async (ms) => { waits.push(ms); });
    t.after(() => setReviewsRetrySleep(previous));
    return waits;
}

/** A paged in-memory list endpoint for fetchAllReviewsPages. */
function pagedSource(rows, { reportTotal = true, ignoreOffset = false, total = rows.length } = {}) {
    const calls = [];
    const fetchPage = async (offset, limit) => {
        calls.push({ offset, limit });
        const start = ignoreOffset ? 0 : offset;
        const results = rows.slice(start, start + limit);
        return reportTotal ? { results, pagination: { totalResults: total, offset, limit, nextUrl: "" } } : { results };
    };
    return { fetchPage, calls };
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `wf-${i}`, name: `Workflow ${i}` }));

// ---------------------------------------------------------------------------
// reviewsApiCall
// ---------------------------------------------------------------------------

test("404 on the list path: the sentence mortgage-study-rag matches on is unchanged, word for word", async (t) => {
    const stub = stubFetch(async () => ({ status: 404, body: { detail: "not found" } }));
    t.after(() => stub.restore());
    await assert.rejects(reviewsApiCall("GET", `/projects/${PROJECT}/workflows`), (e) => {
        assert.equal(
            e.message,
            `Reviews API GET /projects/${PROJECT}/workflows returned 404. ` +
            "This usually means the Reviews module is not activated on this project. " +
            "Enable it in ACC Admin > Project > Modules > Reviews, then retry.",
        );
        assert.equal(e.status, 404);
        return true;
    });
});

test("404 with notFoundMessage: a by-id read gets its own sentence, without the module-off marker", async (t) => {
    const stub = stubFetch(async () => ({ status: 404, body: {} }));
    t.after(() => stub.restore());
    const path = `/projects/${PROJECT}/workflows/11111111-1111-4111-8111-111111111111`;
    const message = notFoundById("GET", path, "workflow", "11111111-1111-4111-8111-111111111111");
    await assert.rejects(reviewsApiCall("GET", path, null, { notFoundMessage: message }), (e) => {
        assert.equal(e.message, message);
        assert.ok(!e.message.includes("Reviews module is not activated"), "by-id 404 must not carry the list call's marker");
        assert.match(e.message, /returned 404/);
        return true;
    });
});

test("a non-404 failure keeps the 'failed (status): body' text and carries status + response text", async (t) => {
    const stub = stubFetch(async () => ({ status: 400, body: { code: "ERR_BAD_INPUT", detail: "query.limit should be <= 50" } }));
    t.after(() => stub.restore());
    await assert.rejects(reviewsApiCall("GET", `/projects/${PROJECT}/workflows?limit=51`), (e) => {
        assert.equal(e.message, `Reviews API GET /projects/${PROJECT}/workflows?limit=51 failed (400): {"code":"ERR_BAD_INPUT","detail":"query.limit should be <= 50"}`);
        assert.equal(e.status, 400);
        assert.match(e.responseText, /ERR_BAD_INPUT/);
        return true;
    });
    assert.equal(stub.calls.length, 1, "a 400 is not retried");
});

test("request shape: bearer token, JSON content type, region header, body only when given", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: { ok: true } }));
    t.after(() => stub.restore());
    await reviewsApiCall("GET", `/projects/${PROJECT}/workflows`);
    await reviewsApiCall("POST", `/projects/${PROJECT}/workflows`, { name: "x" });
    assert.equal(stub.calls[0].url, `${BASE}/projects/${PROJECT}/workflows`);
    assert.equal(stub.calls[0].headers.Authorization, "Bearer test-bearer-token");
    assert.equal(stub.calls[0].headers["Content-Type"], "application/json");
    assert.ok(stub.calls[0].headers["x-ads-region"]);
    assert.equal(stub.calls[0].body, undefined);
    assert.deepEqual(stub.calls[1].body, { name: "x" });
});

test("a GET is retried on 5xx and on 429, then succeeds", async (t) => {
    const waits = noSleep(t);
    const statuses = [503, 429, 200];
    const stub = stubFetch(async () => {
        const status = statuses.shift();
        return { status, body: status === 200 ? { results: [] } : { detail: "busy" } };
    });
    t.after(() => stub.restore());
    const res = await reviewsApiCall("GET", `/projects/${PROJECT}/workflows`);
    assert.deepEqual(res, { results: [] });
    assert.equal(stub.calls.length, 3);
    assert.deepEqual(waits, REVIEWS_READ_RETRY_DELAYS_MS);
});

test("a GET that keeps failing stops after the retries and reports the last status", async (t) => {
    noSleep(t);
    const stub = stubFetch(async () => ({ status: 500, body: { detail: "boom" } }));
    t.after(() => stub.restore());
    await assert.rejects(reviewsApiCall("GET", `/projects/${PROJECT}/workflows`), /failed \(500\)/);
    assert.equal(stub.calls.length, 1 + REVIEWS_READ_RETRY_DELAYS_MS.length);
});

test("a POST is sent exactly once, whatever the failure (500, 503, 429): a create is never retried", async (t) => {
    const waits = noSleep(t);
    for (const status of [500, 503, 429]) {
        const stub = stubFetch(async () => ({ status, body: { detail: "busy" } }));
        await assert.rejects(reviewsApiCall("POST", `/projects/${PROJECT}/workflows`, { name: "x" }), new RegExp(`failed \\(${status}\\)`));
        assert.equal(stub.calls.length, 1, `POST answered ${status} must not be re-sent`);
        stub.restore();
    }
    assert.deepEqual(waits, []);
});

test("204 resolves to an empty object", async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 204 });
    t.after(() => { globalThis.fetch = original; });
    assert.deepEqual(await reviewsApiCall("GET", `/projects/${PROJECT}/workflows`), {});
});

// ---------------------------------------------------------------------------
// reviewsProjectId / reviewsQuery
// ---------------------------------------------------------------------------

test("projectId: a UUID with or without the b. prefix; nothing that could alter the path", () => {
    const schema = z.object({ projectId: reviewsProjectId() });
    const uuid = "36b58e78-22dc-43a5-a261-7a3253bfb2e0";
    assert.doesNotThrow(() => schema.parse({ projectId: uuid }));
    assert.doesNotThrow(() => schema.parse({ projectId: `b.${uuid}` }));
    for (const hostile of ["", "b.", `b.${uuid}/../../x`, `${uuid}#`, `${uuid}?x=1`, `../${uuid}`, `b.${uuid} `, "not-a-uuid", `c.${uuid}`]) {
        assert.throws(() => schema.parse({ projectId: hostile }), undefined, `must reject ${JSON.stringify(hostile)}`);
    }
});

test("reviewsQuery: keys as given (bracket form), values encoded, empty values skipped", () => {
    assert.equal(reviewsQuery([]), "");
    assert.equal(reviewsQuery([["limit", 50], ["offset", 0]]), "?limit=50&offset=0");
    assert.equal(reviewsQuery([["filter[status]", "ACTIVE"], ["sort", "name desc"], ["x", undefined], ["y", ""], ["z", null]]), "?filter[status]=ACTIVE&sort=name%20desc");
    assert.equal(reviewsQuery([["filter[name]", "a&b=c"]]), "?filter[name]=a%26b%3Dc");
});

// ---------------------------------------------------------------------------
// fetchAllReviewsPages
// ---------------------------------------------------------------------------

for (const n of [0, 1, 50, 51, 170]) {
    test(`paging: ${n} rows are all returned, complete, in order`, async () => {
        const { fetchPage, calls } = pagedSource(rows(n));
        const listing = await fetchAllReviewsPages(fetchPage);
        assert.equal(listing.results.length, n);
        assert.deepEqual(listing.results.map((r) => r.id), rows(n).map((r) => r.id));
        assert.equal(listing.complete, true);
        assert.equal(listing.stoppedBecause, undefined);
        assert.equal(listing.totalResults, n);
        assert.equal(listing.pages, Math.max(1, Math.ceil(n / REVIEWS_PAGE_SIZE)));
        assert.deepEqual(calls, Array.from({ length: listing.pages }, (_, i) => ({ offset: i * REVIEWS_PAGE_SIZE, limit: REVIEWS_PAGE_SIZE })));
    });
}

test("paging: a server that ignores offset is detected on the repeated page — INCOMPLETE, no endless loop", async () => {
    const { fetchPage, calls } = pagedSource(rows(170), { ignoreOffset: true });
    const listing = await fetchAllReviewsPages(fetchPage);
    assert.equal(calls.length, 2, "stops at the first page that adds nothing new");
    assert.equal(listing.results.length, 50);
    assert.equal(listing.complete, false);
    assert.equal(listing.stoppedBecause, "repeated_page");
    assert.equal(listing.totalResults, 170);
    assert.match(incompleteNote(listing), /INCOMPLETE: stopped after 2 page\(s\) \(the server repeated a page.*Autodesk reports 170 in total, 50 listed/);
});

test("paging: a total that never arrives — every page is read, but the listing is INCOMPLETE (cannot be confirmed whole)", async () => {
    for (const n of [0, 7, 120]) {
        const { fetchPage } = pagedSource(rows(n), { reportTotal: false });
        const listing = await fetchAllReviewsPages(fetchPage);
        assert.equal(listing.results.length, n, `${n} rows still collected`);
        assert.equal(listing.complete, false);
        assert.equal(listing.stoppedBecause, "no_total");
        assert.equal(listing.totalResults, null);
        assert.match(incompleteNote(listing), /INCOMPLETE.*Autodesk reported no total.*Autodesk reports no total/);
    }
});

test("paging: the page cap stops the loop and reports INCOMPLETE", async () => {
    const { fetchPage, calls } = pagedSource(rows(500));
    const listing = await fetchAllReviewsPages(fetchPage, { maxPages: 3 });
    assert.equal(calls.length, 3);
    assert.equal(listing.results.length, 150);
    assert.equal(listing.complete, false);
    assert.equal(listing.stoppedBecause, "max_pages");
});

test("paging: pages that run out before the reported total — INCOMPLETE, not reported as whole", async () => {
    const { fetchPage } = pagedSource(rows(60), { total: 170 });
    const listing = await fetchAllReviewsPages(fetchPage);
    assert.equal(listing.results.length, 60);
    assert.equal(listing.complete, false);
    assert.equal(listing.stoppedBecause, "ended_before_total");
});

test("paging: a complete listing has no incomplete note; mergedPagination keeps Autodesk's keys and adds ours", async () => {
    const { fetchPage } = pagedSource(rows(51));
    const listing = await fetchAllReviewsPages(fetchPage);
    assert.equal(incompleteNote(listing), "");
    assert.deepEqual(mergedPagination(listing), { totalResults: 51, offset: 0, limit: 50, nextUrl: "", pages: 2, complete: true });
    const cut = await fetchAllReviewsPages(pagedSource(rows(170), { ignoreOffset: true }).fetchPage);
    assert.deepEqual(mergedPagination(cut), { totalResults: 170, offset: 0, limit: 50, nextUrl: "", pages: 2, complete: false, stoppedBecause: "repeated_page" });
});

// ---------------------------------------------------------------------------
// formatWorkflow
// ---------------------------------------------------------------------------

test("formatWorkflow: name, id, status, each step (type, who, day type, group review) and the copy destination", () => {
    const text = formatWorkflow({
        name: "Arch review", id: "wf-1", status: "ACTIVE",
        steps: [
            { name: "Initiator", type: "INITIATOR", id: "Lane_a", candidates: { users: [], roles: [], companies: [{ autodeskId: "542830416", name: "PTP Group" }] } },
            { name: "Architect", type: "REVIEWER", id: "Lane_b", duration: 2, dueDateType: "WORKDAY", candidates: { users: [{ autodeskId: "U1", name: "Ann" }], roles: [], companies: [] } },
            { name: "Both sign", type: "REVIEWER", id: "Lane_c", duration: 3, dueDateType: "CALENDAR_DAY", groupReview: { enabled: true, type: "ALL" }, candidates: { users: [{ autodeskId: "U1", name: "Ann" }, { autodeskId: "U2", name: "Bob" }], roles: [{ autodeskId: "77", name: "Doc Manager" }], companies: [] } },
            { name: "Any one", type: "REVIEWER", id: "Lane_d", duration: 1, dueDateType: "CALENDAR_DAY", groupReview: { enabled: true, type: "MINIMUM", min: 1 }, candidates: { users: [{ autodeskId: "U1", name: "Ann" }], roles: [], companies: [] } },
            { name: "Owner", type: "APPROVER", id: "Lane_e", duration: 5, dueDateType: "WORKDAY", candidates: { users: [{ autodeskId: "U3", name: "Cy" }], roles: [], companies: [] } },
        ],
        copyFilesOptions: { enabled: true, folderUrn: "urn:adsk.wipprodanz:fs.folder:co.X", condition: "ALL", includeMarkups: true, allowOverride: false, disableOverrideMarkupSetting: false },
        approvalStatusOptions: [{ label: "Approved", value: "APPROVED", builtIn: true }, { label: "Approved with comments", value: "APPROVED", builtIn: false }],
    });
    assert.equal(text, [
        '- "Arch review" — id wf-1 — ACTIVE',
        '    INITIATOR "Initiator" [Lane_a]: companies PTP Group (542830416)',
        '    REVIEWER "Architect" [Lane_b]: users Ann (U1) — 2 working day(s) — group review: off (one reviewer acts)',
        '    REVIEWER "Both sign" [Lane_c]: users Ann (U1), Bob (U2); roles Doc Manager (77) — 3 calendar day(s) — group review: ALL assigned reviewers must respond',
        '    REVIEWER "Any one" [Lane_d]: users Ann (U1) — 1 calendar day(s) — group review: at least 1 must respond',
        '    APPROVER "Owner" [Lane_e]: users Cy (U3) — 5 working day(s)',
        "    copy on approval: ON → folder urn:adsk.wipprodanz:fs.folder:co.X (only when ALL files are approved; with markups; the submitter may not change the folder)",
        '    extra approval statuses: "Approved with comments" (APPROVED)',
    ].join("\n"));
});

test("formatWorkflow: copy off, and a sparse record does not throw", () => {
    assert.match(formatWorkflow({ name: "n", id: "i", status: "INACTIVE", steps: [], copyFilesOptions: { enabled: false } }), /INACTIVE\n {4}copy on approval: OFF$/);
    assert.doesNotThrow(() => formatWorkflow({}));
    assert.doesNotThrow(() => formatWorkflow(undefined));
});
