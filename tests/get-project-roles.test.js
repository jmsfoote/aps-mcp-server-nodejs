import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { stubFetch } from "./setup.mjs";
import { getProjectRolesTool } from "../tools/get-project-roles.js";

const ACCOUNT = "aaaaaaaa-0000-0000-0000-000000000001";
const PROJECT = "bbbbbbbb-0000-0000-0000-000000000002";
const ROLES_URL = `https://developer.api.autodesk.com/hq/v2/accounts/${ACCOUNT}/projects/${PROJECT}/industry_roles`;
const TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";
const TWO_LEGGED = "two-legged-test-token";

function apiStub(rolesResponse) {
    return stubFetch(async (url, init) => {
        if (url === TOKEN_URL) return { status: 200, body: { access_token: TWO_LEGGED, token_type: "Bearer", expires_in: 3599 } };
        if (url === ROLES_URL) return rolesResponse;
        throw new Error(`unexpected call ${init.method ?? "GET"} ${url}`);
    });
}

test("input schema requires HQ v2 ids without the b. prefix", () => {
    const schema = z.object(getProjectRolesTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ accountId: ACCOUNT, projectId: PROJECT }));
    assert.throws(() => schema.parse({ accountId: `b.${ACCOUNT}`, projectId: PROJECT }), /accountId must be an HQ v2 ID without the/);
    assert.throws(() => schema.parse({ accountId: ACCOUNT, projectId: `b.${PROJECT}` }), /projectId must be an HQ v2 ID without the/);
    assert.throws(() => schema.parse({ accountId: "", projectId: PROJECT }));
});

test("calls industry_roles with the 2-legged client-credentials token (account:read), not the SSA token", async (t) => {
    const stub = apiStub({ status: 200, body: [
        { id: "r1", name: "Architect", status: "active", member_group_id: "100" },
        { id: "r2", name: "Owner", status: "inactive", member_group_id: "101" },
    ] });
    t.after(() => stub.restore());

    const result = await getProjectRolesTool.callback({ accountId: ACCOUNT, projectId: PROJECT });

    const tokenCall = stub.calls.find((c) => c.url === TOKEN_URL);
    assert.ok(tokenCall, "a client_credentials exchange must happen (the SSA override token must not be used)");
    assert.equal(tokenCall.method, "POST");
    assert.match(tokenCall.headers.Authorization, /^Basic /);
    const params = tokenCall.body instanceof URLSearchParams ? tokenCall.body : new URLSearchParams(String(tokenCall.body));
    assert.equal(params.get("grant_type"), "client_credentials");
    assert.equal(params.get("scope"), "account:read");

    const rolesCall = stub.calls.find((c) => c.url === ROLES_URL);
    assert.ok(rolesCall);
    assert.equal(rolesCall.method, "GET");
    assert.equal(rolesCall.headers.Authorization, `Bearer ${TWO_LEGGED}`);
    assert.notEqual(rolesCall.headers.Authorization, `Bearer ${process.env.APS_TOKEN_OVERRIDE}`);

    assert.equal(result.structuredContent.roles.length, 2);
    assert.equal(result.structuredContent.roles[1].member_group_id, "101");
    assert.match(result.content[0].text, /^Found 2 role\(s\):/);
    assert.match(result.content[0].text, /- Architect \(ID: r1\)\n- Owner \(ID: r2\)  \[inactive\]/);
});

test("surfaces an HTTP error with status and body (the 403/1003 shape seen with the SSA token)", async (t) => {
    const stub = apiStub({ status: 403, body: { code: 1003, message: "The user does not have access to this project." } });
    t.after(() => stub.restore());
    await assert.rejects(
        () => getProjectRolesTool.callback({ accountId: ACCOUNT, projectId: PROJECT }),
        /getProjectRolesTool: HTTP 403 .*1003.*does not have access/
    );
});

test("rejects a non-array response body", async (t) => {
    const stub = apiStub({ status: 200, body: { results: [] } });
    t.after(() => stub.restore());
    await assert.rejects(
        () => getProjectRolesTool.callback({ accountId: ACCOUNT, projectId: PROJECT }),
        /unexpected response shape \(expected array, got object\)/
    );
});
