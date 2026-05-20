import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { importBudgetsTool } from "../../tools/cost/import-budgets.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

test("importBudgets input schema requires at least one budget with name+code", () => {
    const { budgets } = importBudgetsTool.inputSchema;
    assert.throws(() => budgets.parse([]));
    assert.throws(() => budgets.parse([{ name: "x" }])); // missing code
    assert.throws(() => budgets.parse([{ code: "y" }])); // missing name
    const ok = budgets.parse([{ name: "x", code: "y" }]);
    assert.equal(ok.length, 1);
});

test("importBudgets POSTs to /budgets:import with {data: [...]} envelope", async (t) => {
    const apiResp = [
        { id: "b1", code: "C1", formattedCode: "F1", name: "One", originalAmount: "100.00" },
        { id: "b2", code: "C2", formattedCode: "F2", name: "Two", originalAmount: "200.00" },
    ];
    const stub = stubFetch(async () => ({ status: 200, body: apiResp }));
    t.after(() => stub.restore());

    const items = [
        { name: "One", code: "C1" },
        { name: "Two", code: "C2" },
    ];
    const result = await importBudgetsTool.callback({ containerId: CONTAINER, budgets: items });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/budgets:import$`));
    // Wire format MUST be {data: [...]} — verified live on Parkside 2026-05-21.
    assert.ok(call.body && Array.isArray(call.body.data), "body must be {data: [...]}");
    assert.equal(call.body.data.length, 2);
    assert.equal(call.body.data[0].code, "C1");
    // Critical: NOT a bare array, NOT {items: [...]}
    assert.equal(Array.isArray(call.body), false);
    assert.equal(call.body.items, undefined);

    assert.equal(result.structuredContent.requested, 2);
    assert.equal(result.structuredContent.created, 2);
    assert.match(result.content[0].text, /Imported 2 budget line/);
    assert.match(result.content[0].text, /C1/);
});

test("importBudgets surfaces template-lock error per spec §3.1", async (t) => {
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            error: {
                errors: [{ code: 450046, title: "Contract already unlocked.", detail: "Contract locked." }],
                statusCode: 400,
            },
        },
    }));
    t.after(() => stub.restore());

    const result = await importBudgetsTool.callback({
        containerId: CONTAINER,
        budgets: [{ name: "x", code: "y" }],
    });

    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /status 400/);
    assert.match(result.content[0].text, /450046/);
    assert.match(result.content[0].text, /Contract locked/);
});
