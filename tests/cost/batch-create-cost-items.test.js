import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { batchCreateCostItemsTool } from "../../tools/cost/batch-create-cost-items.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("batchCreateCostItems input schema rejects missing required fields", () => {
    const { containerId, items } = batchCreateCostItemsTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => items.parse([])); // .min(1)
    assert.throws(() => items.parse([{ code: "C" }])); // missing name
    assert.throws(() => items.parse([{ name: "N" }])); // missing code
});

test("batchCreateCostItems input schema accepts valid items including optionals", () => {
    const { items } = batchCreateCostItemsTool.inputSchema;
    assert.doesNotThrow(() => items.parse([{ name: "N", code: "C" }]));
    assert.doesNotThrow(() =>
        items.parse([{ name: "N", code: "C", description: "D", contractId: "ct-1", budgetId: "b-1" }])
    );
});

test("batchCreateCostItems input schema accepts large batches (no max cap — Phase 0 confirmed 101 succeeds)", () => {
    const { items } = batchCreateCostItemsTool.inputSchema;
    // Per Phase 0 round-2: the inventory's "≤100 hard limit" claim is wrong.
    // The API accepts batches of 101+. This test locks the absence of a
    // client-side cap so a future regression doesn't re-introduce one
    // without re-verification against the API.
    const big = Array.from({ length: 150 }, (_, i) => ({ name: `n${i}`, code: `c${i}` }));
    assert.doesNotThrow(() => items.parse(big));
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("batchCreateCostItems wraps items in {data:[...]} and shapes the response", async (t) => {
    // Phase 0 (2026-05-26) captured: response is a BARE ARRAY of full cost-item objects.
    const apiItems = [
        {
            id: "f4e787b0-58c2-11f1-ba51-79b16742e941",
            containerId: CONTAINER,
            number: "0006",
            code: "CI-A",
            name: "ZZZ Phase 0 CI A",
            budgetStatus: "draft",
            costStatus: "draft",
            scope: "out",
            budgetId: null,
            contractId: null,
        },
        {
            id: "f4e787b1-58c2-11f1-ba51-79b16742e941",
            containerId: CONTAINER,
            number: "0007",
            code: "CI-B",
            name: "ZZZ Phase 0 CI B",
            budgetStatus: "draft",
            costStatus: "draft",
            scope: "out",
            budgetId: null,
            contractId: null,
        },
    ];
    const stub = stubFetch(async () => ({ status: 201, body: apiItems }));
    t.after(() => stub.restore());

    const result = await batchCreateCostItemsTool.callback({
        containerId: CONTAINER,
        items: [
            { name: "ZZZ Phase 0 CI A", code: "CI-A" },
            { name: "ZZZ Phase 0 CI B", code: "CI-B" },
        ],
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/cost-items:batch-create$`));
    // Critical: body wraps items in `data` key.
    assert.ok(call.body.data, "body must wrap items in {data:[...]}");
    assert.equal(call.body.data.length, 2);
    assert.equal(call.body.data[0].name, "ZZZ Phase 0 CI A");
    assert.equal(call.body.data[0].code, "CI-A");

    assert.equal(result.structuredContent.count, 2);
    assert.equal(result.structuredContent.summaries.length, 2);
    assert.equal(result.structuredContent.summaries[0].id, apiItems[0].id);
    assert.equal(result.structuredContent.summaries[0].number, "0006");
    assert.equal(result.structuredContent.summaries[0].code, "CI-A");
    assert.equal(result.structuredContent.summaries[0].budgetStatus, "draft");
});

// ─── Error path ───────────────────────────────────────────────────────────────

test("batchCreateCostItems surfaces validation errors per-item", async (t) => {
    // Phase 0 round-1 captured: "Missing required property: name on data.1" when
    // an item in the array was missing `name`.
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            errors: [{ code: 45007, title: "OBJECT_MISSING_REQUIRED_PROPERTY", detail: "Missing required property: name on data.1" }],
            name: "ValidationException",
        },
    }));
    t.after(() => stub.restore());

    const result = await batchCreateCostItemsTool.callback({
        containerId: CONTAINER,
        items: [{ name: "A", code: "CA" }, { name: "B", code: "CB" }],
    });

    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /45007/);
    assert.match(result.content[0].text, /Missing required property: name on data.1/);
});
