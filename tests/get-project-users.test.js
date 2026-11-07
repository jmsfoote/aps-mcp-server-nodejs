import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { adminClient } from "../utils.js";
import { getProjectUsersTool, fetchAllProjectUsers, PROJECT_USERS_PAGE_SIZE } from "../tools/get-project-users.js";

const PROJECT = "aaaaaaaa-0000-0000-0000-000000000000";
const ROLE_A = "11111111-1111-4111-8111-111111111111";
const ROLE_B = "22222222-2222-4222-8222-222222222222";

function member(i, extra = {}) {
    return {
        id: `user-${i}`, autodeskId: `ADSK${i}`, email: `m${i}@example.test`, name: `Member ${i}`, status: "active",
        companyName: "Example Co", roleIds: [ROLE_A], roles: [{ id: ROLE_A, name: "Architect" }], ...extra,
    };
}

/** Stub adminClient.getProjectUsers with a paged in-memory roster (or a custom responder); restore in t.after. */
function patchClient(t, { members = [], totalResults = members.length, reportTotal = true, respond } = {}) {
    const original = adminClient.getProjectUsers;
    const calls = [];
    adminClient.getProjectUsers = async (projectId, args) => {
        calls.push([projectId, args]);
        if (respond) return respond(projectId, args, calls.length);
        const { offset = 0, limit } = args;
        const page = members.slice(offset, offset + limit);
        return reportTotal ? { pagination: { limit, offset, totalResults }, results: page } : { results: page };
    };
    t.after(() => { adminClient.getProjectUsers = original; });
    return calls;
}

test("input schema: projectId required; filterRoleIds optional, non-empty, UUIDs only", () => {
    const schema = z.object(getProjectUsersTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT }));
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT, filterRoleIds: [ROLE_A, ROLE_B] }));
    assert.throws(() => schema.parse({}));
    assert.throws(() => schema.parse({ projectId: "" }));
    assert.throws(() => schema.parse({ projectId: PROJECT, filterRoleIds: [] }));
    assert.throws(() => schema.parse({ projectId: PROJECT, filterRoleIds: ["Architect"] }));
});

test("single page: one call at offset 0 with the maximum page size and the configured region", async (t) => {
    const calls = patchClient(t, { members: [member(1), member(2)] });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.deepEqual(calls, [[PROJECT, { region: "AUS", limit: PROJECT_USERS_PAGE_SIZE, offset: 0 }]]);
    assert.equal(res.structuredContent.result.results.length, 2);
    assert.deepEqual(res.structuredContent.result.pagination, { totalResults: 2, pageSize: PROJECT_USERS_PAGE_SIZE, pages: 1, complete: true });
});

test("text output carries member id, autodeskId, status, company and roles (name + id)", async (t) => {
    patchClient(t, { members: [member(1)] });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.equal(res.content[0].text, [
        "Found 1 users:",
        "- Member 1 (m1@example.test) — active, Example Co",
        `    id: user-1 | autodeskId: ADSK1 | roles: Architect (${ROLE_A})`,
    ].join("\n"));
});

test("multi-page: offsets advance by the page size until totalResults is reached; results merge in order", async (t) => {
    const members = Array.from({ length: 437 }, (_, i) => member(i + 1));
    const calls = patchClient(t, { members });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.deepEqual(calls.map(([, a]) => a.offset), [0, 200, 400]);
    assert.equal(res.structuredContent.result.results.length, 437);
    assert.equal(res.structuredContent.result.results[436].id, "user-437");
    assert.deepEqual(res.structuredContent.result.pagination, { totalResults: 437, pageSize: 200, pages: 3, complete: true });
    assert.match(res.content[0].text, /^Found 437 users:\n/);
});

test("exact multiple of the page size: no extra empty-page request", async (t) => {
    const calls = patchClient(t, { members: Array.from({ length: 400 }, (_, i) => member(i + 1)) });
    await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.deepEqual(calls.map(([, a]) => a.offset), [0, 200]);
});

test("no totalResults in the response: a full page fetches the next, a short page ends the listing", async (t) => {
    const calls = patchClient(t, { members: Array.from({ length: 201 }, (_, i) => member(i + 1)), reportTotal: false });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.deepEqual(calls.map(([, a]) => a.offset), [0, 200]);
    assert.equal(res.structuredContent.result.results.length, 201);
    assert.equal(res.structuredContent.result.pagination.complete, true);
});

test("filterRoleIds is passed through on every page and the header names the roles", async (t) => {
    const calls = patchClient(t, { members: Array.from({ length: 250 }, (_, i) => member(i + 1)) });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT, filterRoleIds: [ROLE_A, ROLE_B] });
    assert.equal(calls.length, 2);
    for (const [, args] of calls) assert.deepEqual(args.filterRoleIds, [ROLE_A, ROLE_B]);
    assert.match(res.content[0].text, new RegExp(`^250 member\\(s\\) hold role\\(s\\) ${ROLE_A}, ${ROLE_B}:\n`));
});

test("filterRoleIds with no holders: the text says the role is not active and names the rejection", async (t) => {
    const calls = patchClient(t, { members: [] });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT, filterRoleIds: [ROLE_B] });
    assert.equal(calls.length, 1);
    assert.equal(res.content[0].text,
        `No project member holds role(s) ${ROLE_B} — not active in this project; folder-permission grants to it `
        + "will be rejected (HTTP 400 ERR_PERMISSION_RESOURCE_NOT_EXIST_OR_NOT_ACTIVE)");
    assert.deepEqual(res.structuredContent.result.results, []);
    assert.deepEqual(res.structuredContent.result.pagination, { totalResults: 0, pageSize: 200, pages: 1, complete: true });
});

test("a server that ignores offset: the repeated page stops the loop and the result is flagged INCOMPLETE", async (t) => {
    const page = Array.from({ length: 200 }, (_, i) => member(i + 1));
    const calls = patchClient(t, { respond: () => ({ pagination: { totalResults: 437 }, results: page }) });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.equal(calls.length, 2);
    assert.equal(res.structuredContent.result.results.length, 200);
    assert.equal(res.structuredContent.result.pagination.complete, false);
    assert.match(res.content[0].text, /^Found 200 users — INCOMPLETE: stopped after 2 page\(s\) \(the server repeated a page\); API reports 437 in total:\n/);
});

test("page cap: fetchAllProjectUsers stops at maxPages and reports why", async () => {
    let requests = 0;
    const out = await fetchAllProjectUsers(async (offset) => {
        requests += 1;
        return { pagination: { totalResults: 10_000 }, results: [{ id: `u${offset}` }, { id: `u${offset + 1}` }] };
    }, { pageSize: 2, maxPages: 3 });
    assert.equal(requests, 3);
    assert.equal(out.results.length, 6);
    assert.equal(out.complete, false);
    assert.equal(out.stoppedBecause, "max_pages");
    assert.equal(out.totalResults, 10_000);
});

test("overlapping pages are de-duplicated by member id", async () => {
    const pages = [[member(1), member(2)], [member(2), member(3)], []];
    const out = await fetchAllProjectUsers(async () => ({ results: pages.shift() }), { pageSize: 2 });
    assert.deepEqual(out.results.map(u => u.id), ["user-1", "user-2", "user-3"]);
    assert.equal(out.complete, true);
});

test("legacy bare-array response is still accepted", async (t) => {
    patchClient(t, { respond: () => [member(1), member(2)] });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.equal(res.structuredContent.result.results.length, 2);
    assert.deepEqual(res.structuredContent.result.pagination, { totalResults: 2, pageSize: 200, pages: 1, complete: true });
});

test("members without roles, company or a display name fall back cleanly", async (t) => {
    patchClient(t, { members: [{ id: "u9", email: "x@example.test", firstName: "Ada", lastName: "Lovelace", status: "pending" }] });
    const res = await getProjectUsersTool.callback({ projectId: PROJECT });
    assert.equal(res.content[0].text, [
        "Found 1 users:",
        "- Ada Lovelace (x@example.test) — pending",
        "    id: u9 | autodeskId: — | roles: none",
    ].join("\n"));
});
