import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { createExpenseLineItemTool } from "../../tools/cost/create-expense-line-item.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const EID = "91ab3eb0-5efa-11f1-8a76-c5ce0121f9b7";

// Phase 0 (2026-06-03) captured fixture — single-object create returns the item
// with server-computed amount (qty 3 × unitPrice 50 = "150.0000").
const apiItem = {
    id: "e9beda30-5efa-11f1-aea7-f5e88bcf1513",
    expenseId: EID,
    number: "0001",
    name: "ZZZ ENV single",
    quantity: 3,
    unitPrice: "50.000000000000",
    unit: "ea",
    amount: "150.0000",
    budgetId: null,
    contractId: null,
    externalId: null,
};

// ─── Input schema ─────────────────────────────────────────────────────────────

test("createExpenseLineItem requires containerId, expenseId, name", () => {
    const { containerId, expenseId, name } = createExpenseLineItemTool.inputSchema;
    assert.throws(() => containerId.parse(""));
    assert.throws(() => expenseId.parse(""));
    assert.throws(() => name.parse(""));
});

// ─── Happy path + SINGULAR-envelope regression fence (Phase 0 F0.4) ──────────

test("createExpenseLineItem POSTs a SINGLE flat object to /expenses/:id/items", async (t) => {
    const stub = stubFetch(async () => ({ status: 201, body: apiItem }));
    t.after(() => stub.restore());

    const result = await createExpenseLineItemTool.callback({
        containerId: CONTAINER,
        expenseId: EID,
        name: "ZZZ ENV single",
        quantity: 3,
        unitPrice: 50,
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/expenses/${EID}/items$`));
    // Phase 0 proved the API rejects array / {data:[...]} envelopes (400). The
    // body MUST be a single flat object — anyone "batching" this trips the fence.
    assert.ok(!Array.isArray(call.body), "body must not be an array");
    assert.ok(!("data" in call.body), "body must not be wrapped in {data:[...]}");
    assert.equal(call.body.name, "ZZZ ENV single");
    assert.equal(call.body.quantity, 3);
    assert.equal(call.body.unitPrice, 50);

    const s = result.structuredContent.summary;
    assert.equal(s.id, apiItem.id);
    assert.equal(s.number, "0001");
    assert.equal(s.amount, 150); // numVal("150.0000")
    assert.equal(typeof s.amount, "number");
    assert.equal(s.expenseId, EID);
});

// ─── Error path (Phase 0: name required) ─────────────────────────────────────

test("createExpenseLineItem surfaces the missing-name 400 (Phase 0 45007)", async (t) => {
    const stub = stubFetch(async () => ({
        status: 400,
        body: { errors: [{ code: 45007, title: "OBJECT_MISSING_REQUIRED_PROPERTY", detail: "Missing required property: name" }] },
    }));
    t.after(() => stub.restore());

    const result = await createExpenseLineItemTool.callback({ containerId: CONTAINER, expenseId: EID, name: "x" });
    assert.equal(result.structuredContent.error, true);
    assert.match(result.content[0].text, /45007/);
});
