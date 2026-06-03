import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { updateExpenseTool } from "../../tools/cost/update-expense.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const EID = "91ab3eb0-5efa-11f1-8a76-c5ce0121f9b7";

const apiExpense = {
    status: "draft",
    id: EID,
    number: "ZZZ-EXP-P0-1",
    name: "Skip-key probe expense",
    supplierName: "PTP Group",
    description: "patched in P0-C",
    referenceNumber: "PO-REF-P0-PATCHED",
    externalId: "ptp-p0-expenses-skipkey-001",
    updatedAt: "2026-06-03T03:18:38.435Z",
};

// ─── Input schema ─────────────────────────────────────────────────────────────

test("updateExpense input schema requires containerId and expenseId", () => {
    const { containerId, expenseId } = updateExpenseTool.inputSchema;
    assert.throws(() => containerId.parse(""));
    assert.throws(() => expenseId.parse(""));
});

// ─── Anti-scope regression fence (Phase 0: status not settable on write path) ─

test("updateExpense does NOT expose a `status` input (lifecycle is operator-surface-only)", () => {
    // Phase 0 verified PATCH {status:...} → 400 "No enum match". Anyone re-adding
    // a status input (letting the wave handler drive lifecycle state) trips this.
    assert.equal(updateExpenseTool.inputSchema.status, undefined);
});

// ─── No-op guard ──────────────────────────────────────────────────────────────

test("updateExpense REJECTS an empty patch client-side (no API call)", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: apiExpense }));
    t.after(() => stub.restore());

    const result = await updateExpenseTool.callback({ containerId: CONTAINER, expenseId: EID });
    assert.equal(stub.calls.length, 0);
    assert.equal(result.structuredContent.error, true);
    assert.match(result.content[0].text, /at least one field/);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("updateExpense PATCHes /expenses/:id with only the changed fields", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: apiExpense }));
    t.after(() => stub.restore());

    const result = await updateExpenseTool.callback({
        containerId: CONTAINER,
        expenseId: EID,
        description: "patched in P0-C",
        referenceNumber: "PO-REF-P0-PATCHED",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "PATCH");
    assert.match(call.url, new RegExp(`/expenses/${EID}$`));
    assert.deepEqual(Object.keys(call.body).sort(), ["description", "referenceNumber"]);
    assert.deepEqual(result.structuredContent.changed.sort(), ["description", "referenceNumber"]);
    assert.equal(result.structuredContent.summary.referenceNumber, "PO-REF-P0-PATCHED");
});

test("updateExpense surfaces Cost API errors", async (t) => {
    const stub = stubFetch(async () => ({ status: 404, body: { errors: [{ code: 45007, title: "NOT_FOUND", detail: "expense not found" }] } }));
    t.after(() => stub.restore());

    const result = await updateExpenseTool.callback({ containerId: CONTAINER, expenseId: EID, name: "x" });
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 404);
});
