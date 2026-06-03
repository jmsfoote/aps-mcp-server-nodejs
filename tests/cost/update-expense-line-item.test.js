import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { updateExpenseLineItemTool } from "../../tools/cost/update-expense-line-item.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const EID = "91ab3eb0-5efa-11f1-8a76-c5ce0121f9b7";
const IID = "e9beda30-5efa-11f1-aea7-f5e88bcf1513";

// Phase 0 (2026-06-03): PATCH {quantity:4, unitPrice:25} → amount recomputed "100.0000".
const apiItem = {
    id: IID,
    expenseId: EID,
    number: "0001",
    name: "ZZZ ENV single",
    description: "patched",
    quantity: 4,
    unitPrice: "25.000000000000",
    amount: "100.0000",
    externalId: null,
};

// ─── Input schema ─────────────────────────────────────────────────────────────

test("updateExpenseLineItem requires containerId, expenseId, itemId", () => {
    const { containerId, expenseId, itemId } = updateExpenseLineItemTool.inputSchema;
    assert.throws(() => containerId.parse(""));
    assert.throws(() => expenseId.parse(""));
    assert.throws(() => itemId.parse(""));
});

// ─── No-op guard ──────────────────────────────────────────────────────────────

test("updateExpenseLineItem REJECTS an empty patch client-side (no API call)", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: apiItem }));
    t.after(() => stub.restore());

    const result = await updateExpenseLineItemTool.callback({ containerId: CONTAINER, expenseId: EID, itemId: IID });
    assert.equal(stub.calls.length, 0);
    assert.equal(result.structuredContent.error, true);
    assert.match(result.content[0].text, /at least one field/);
});

// ─── Happy path (amount recompute surfaced) ──────────────────────────────────

test("updateExpenseLineItem PATCHes /expenses/:id/items/:itemId and surfaces recomputed amount", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: apiItem }));
    t.after(() => stub.restore());

    const result = await updateExpenseLineItemTool.callback({
        containerId: CONTAINER,
        expenseId: EID,
        itemId: IID,
        quantity: 4,
        unitPrice: 25,
        description: "patched",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "PATCH");
    assert.match(call.url, new RegExp(`/expenses/${EID}/items/${IID}$`));
    assert.deepEqual(Object.keys(call.body).sort(), ["description", "quantity", "unitPrice"]);

    const s = result.structuredContent.summary;
    assert.equal(s.amount, 100); // numVal("100.0000") — server-recomputed 4 × 25
    assert.equal(typeof s.amount, "number");
    assert.deepEqual(result.structuredContent.changed.sort(), ["description", "quantity", "unitPrice"]);
});

test("updateExpenseLineItem surfaces Cost API errors", async (t) => {
    const stub = stubFetch(async () => ({ status: 404, body: { errors: [{ code: 45007, title: "NOT_FOUND", detail: "item not found" }] } }));
    t.after(() => stub.restore());

    const result = await updateExpenseLineItemTool.callback({ containerId: CONTAINER, expenseId: EID, itemId: IID, name: "x" });
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 404);
});
