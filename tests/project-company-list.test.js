import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { stubFetch } from "./setup.mjs";
import { accProjectCompanyListTool, PROJECT_COMPANIES_PAGE_SIZE, PROJECT_COMPANIES_MAX_PAGES } from "../tools/companies/project-list.js";

const ACCOUNT = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT = "bbbbbbbb-0000-4000-8000-000000000002";
const LIST_URL = `https://developer.api.autodesk.com/hq/v1/accounts/${ACCOUNT}/projects/${PROJECT}/companies`;
const TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";

const company = (i) => ({ id: `cccccccc-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Company ${i}`, member_group_id: String(542830000 + i), project_id: PROJECT });

function server(t, companies) {
    const stub = stubFetch(async (url, init = {}) => {
        if (url === TOKEN_URL) return { status: 200, body: { access_token: "two-legged-test-token", token_type: "Bearer", expires_in: 3599 } };
        const u = new URL(url);
        if ((init.method ?? "GET") === "GET" && `${u.origin}${u.pathname}` === LIST_URL) {
            const limit = Number(u.searchParams.get("limit") ?? 10); // the endpoint's own default page is 10
            const offset = Number(u.searchParams.get("offset") ?? 0);
            return { status: 200, body: companies.slice(offset, offset + limit) };
        }
        throw new Error(`unexpected call ${init.method ?? "GET"} ${url}`);
    });
    t.after(() => stub.restore());
    return { listCalls: () => stub.calls.filter((c) => c.url.startsWith(LIST_URL)) };
}

test("lists every project company with its member_group_id (the id a Reviews company candidate needs)", async (t) => {
    const s = server(t, [company(1), company(2)]);
    const res = await accProjectCompanyListTool.callback({ accountId: ACCOUNT, projectId: PROJECT });
    assert.equal(res.content[0].text, [
        "Found 2 project companies:",
        `- Company 1 — id: ${company(1).id} | member_group_id: 542830001`,
        `- Company 2 — id: ${company(2).id} | member_group_id: 542830002`,
    ].join("\n"));
    assert.deepEqual(res.structuredContent, { result: [company(1), company(2)], count: 2, complete: true });
    assert.equal(s.listCalls().length, 1);
    assert.equal(new URL(s.listCalls()[0].url).searchParams.get("limit"), String(PROJECT_COMPANIES_PAGE_SIZE), "asks for 100 per page, not the endpoint's default 10");
});

for (const n of [0, 1, 100, 101, 250]) {
    test(`pages until all are returned: ${n} companies`, async (t) => {
        const s = server(t, Array.from({ length: n }, (_, i) => company(i)));
        const res = await accProjectCompanyListTool.callback({ accountId: ACCOUNT, projectId: PROJECT });
        assert.equal(res.structuredContent.count, n);
        assert.equal(res.structuredContent.complete, true);
        assert.equal(s.listCalls().length, Math.floor(n / PROJECT_COMPANIES_PAGE_SIZE) + 1);
    });
}

test("input schema: both ids are UUIDs without the b. prefix", () => {
    const schema = z.object(accProjectCompanyListTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ accountId: ACCOUNT, projectId: PROJECT }));
    assert.throws(() => schema.parse({ accountId: ACCOUNT, projectId: `b.${PROJECT}` }), /projectId must be a UUID without the/);
    assert.throws(() => schema.parse({ accountId: `${ACCOUNT}/../x`, projectId: PROJECT }));
    assert.throws(() => schema.parse({ accountId: ACCOUNT }));
});

test("an answer that is not a list is a failure, never an empty-but-complete listing", async (t) => {
    for (const malformed of [null, { message: "unexpected" }, "oops"]) {
        const stub = stubFetch(async (url) => {
            if (url === TOKEN_URL) return { status: 200, body: { access_token: "two-legged-test-token", token_type: "Bearer", expires_in: 3599 } };
            return { status: 200, body: malformed };
        });
        await assert.rejects(accProjectCompanyListTool.callback({ accountId: ACCOUNT, projectId: PROJECT }), /the companies endpoint returned .* instead of a list \(page 1\)/);
        stub.restore();
    }
});

// Review round 2 (fresh reviewer pass on PR #14)
test("a project with more companies than the page cap allows is reported INCOMPLETE, never as the whole list", async (t) => {
    // Every page is full, for ever: the listing must stop at the cap and say so.
    const stub = stubFetch(async (url) => {
        if (url === TOKEN_URL) return { status: 200, body: { access_token: "two-legged-test-token", token_type: "Bearer", expires_in: 3599 } };
        const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
        return { status: 200, body: Array.from({ length: PROJECT_COMPANIES_PAGE_SIZE }, (_, i) => company(offset + i)) };
    });
    t.after(() => stub.restore());
    const res = await accProjectCompanyListTool.callback({ accountId: ACCOUNT, projectId: PROJECT });
    const expected = PROJECT_COMPANIES_PAGE_SIZE * PROJECT_COMPANIES_MAX_PAGES;
    assert.equal(res.structuredContent.complete, false);
    assert.equal(res.structuredContent.count, expected);
    assert.match(res.content[0].text, new RegExp(`^Found ${expected} project companies — INCOMPLETE: stopped at the page cap of ${PROJECT_COMPANIES_MAX_PAGES}:`));
    assert.equal(stub.calls.filter((c) => c.url.startsWith(LIST_URL)).length, PROJECT_COMPANIES_MAX_PAGES);
});
