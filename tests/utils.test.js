import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAccessToken } from "../utils.js";

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
