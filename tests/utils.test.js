import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "./setup.mjs";
import { getAccessToken, getTwoLeggedToken } from "../utils.js";

test("getAccessToken returns APS_TOKEN_OVERRIDE when NODE_ENV=test", async () => {
    // setup.mjs has already set NODE_ENV=test and APS_TOKEN_OVERRIDE
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(await getAccessToken(), process.env.APS_TOKEN_OVERRIDE);
});

test("getAccessToken refuses to use the override outside NODE_ENV=test", async (t) => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    t.after(() => { process.env.NODE_ENV = orig; });

    // With NODE_ENV != test, the override must NOT short-circuit — the real
    // SSA flow runs and (with our /dev/null SSA_KEY_PATH) must fail.
    await assert.rejects(getAccessToken, /EISDIR|ENOENT|read|PEM|key/i);
});

test("getTwoLeggedToken caches per scope set, so a narrower token is never reused for a broader scope", async (t) => {
    let issued = 0;
    const stub = stubFetch(async (url, init) => {
        assert.equal(url, "https://developer.api.autodesk.com/authentication/v2/token");
        assert.equal(init.method, "POST");
        issued += 1;
        return { status: 200, body: { access_token: `tok-${issued}-${init.body.get("scope")}`, token_type: "Bearer", expires_in: 3599 } };
    });
    t.after(() => stub.restore());

    const readA = await getTwoLeggedToken(["account:read"]);
    const readB = await getTwoLeggedToken(["account:read"]);
    const readWrite = await getTwoLeggedToken(["account:read", "account:write"]);
    const readWriteAgain = await getTwoLeggedToken(["account:read", "account:write"]);
    const dflt = await getTwoLeggedToken(); // default scopes === read+write → same cache slot

    assert.equal(readA, readB);
    assert.equal(readWrite, readWriteAgain);
    assert.equal(dflt, readWrite);
    assert.notEqual(readA, readWrite);
    assert.equal(issued, 2, "one exchange per distinct scope set");
    assert.equal(stub.calls[0].body.get("scope"), "account:read");
    assert.equal(stub.calls[1].body.get("scope"), "account:read account:write");
});
