import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { costApiCall, formatCostApiError, numVal } from "../../tools/cost/cost-helpers.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

test("costApiCall passes a JSON-stringified body when one is provided", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: { id: "x" } }));
    t.after(() => stub.restore());

    const body = { name: "n", code: "c" };
    const r = await costApiCall("POST", CONTAINER, "budgets", {}, body);

    assert.equal(stub.calls.length, 1);
    assert.deepEqual(stub.calls[0].body, body);
    assert.equal(stub.calls[0].headers["Content-Type"], "application/json");
    assert.equal(stub.calls[0].headers["x-ads-region"], "AUS");
    assert.match(stub.calls[0].headers.Authorization, /^Bearer /);
    // Single-object response wrapped to [obj] by extractItems
    assert.equal(r.data.length, 1);
    assert.equal(r.data[0].id, "x");
});

test("costApiCall sends no body when none is provided (GET path)", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: { results: [{ id: 1 }, { id: 2 }] } }));
    t.after(() => stub.restore());

    await costApiCall("GET", CONTAINER, "budgets", { limit: 50 });

    assert.equal(stub.calls[0].body, undefined);
    assert.match(stub.calls[0].url, /\?limit=50$/);
});

test("formatCostApiError parses the nested {error: {errors: [...]}} envelope", () => {
    const msg = JSON.stringify({
        error: {
            errors: [{ code: 450407, title: "Code length not matched.", detail: "code: X length not matched" }],
            statusCode: 409,
        },
    });
    const out = formatCostApiError({ status: 409, message: msg });
    assert.match(out, /status 409/);
    assert.match(out, /450407/);
    assert.match(out, /Code length not matched/);
    assert.match(out, /length not matched/);
});

test("formatCostApiError falls back to the legacy flat envelope", () => {
    const msg = JSON.stringify({
        errors: [{ code: 45007, title: "OBJECT_MISSING_REQUIRED_PROPERTY", detail: "Missing required property: code" }],
    });
    const out = formatCostApiError({ status: 400, message: msg });
    assert.match(out, /45007/);
    assert.match(out, /Missing required property: code/);
});

test("formatCostApiError handles non-JSON message bodies", () => {
    const out = formatCostApiError({ status: 500, message: "Internal Server Error" });
    assert.match(out, /status 500/);
    assert.match(out, /Internal Server Error/);
});

test("numVal parses string monetary values without concatenation", () => {
    assert.equal(numVal("350000.0000"), 350000);
    assert.equal(numVal(""), 0);
    assert.equal(numVal(null), 0);
    assert.equal(numVal(undefined), 0);
    assert.equal(numVal("not a number"), 0);
    assert.equal(numVal(42), 42);
});
