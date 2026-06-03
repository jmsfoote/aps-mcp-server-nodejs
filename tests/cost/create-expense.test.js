import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { createExpenseTool } from "../../tools/cost/create-expense.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// Phase 0 (2026-06-03) captured fixture — create-expense 201 response from Parkside.
const apiExpense = {
    status: "draft",
    id: "91ab3eb0-5efa-11f1-8a76-c5ce0121f9b7",
    containerId: CONTAINER,
    supplierId: "542830416",
    supplierName: "PTP Group",
    number: "ZZZ-EXP-P0-1",
    name: "Skip-key probe expense",
    referenceNumber: "PO-REF-P0-1",
    externalSystem: "ptp-acc-mcp-phase0",
    externalId: "ptp-p0-expenses-skipkey-001",
    mainContractId: "f5a3f9e0-58c2-11f1-9770-7919ffb2ff0c",
    createdAt: "2026-06-03T03:16:10.423Z",
    expenseItems: [],
};

// ─── Input schema ─────────────────────────────────────────────────────────────

test("createExpense input schema rejects empty containerId and name", () => {
    const { containerId, name } = createExpenseTool.inputSchema;
    assert.throws(() => containerId.parse(""));
    assert.throws(() => name.parse(""));
});

// ─── Supplier one-of guard (client-side, Phase 0 450897) ─────────────────────

test("createExpense REJECTS missing supplier client-side (no API call)", async (t) => {
    const stub = stubFetch(async () => ({ status: 201, body: apiExpense }));
    t.after(() => stub.restore());

    const result = await createExpenseTool.callback({ containerId: CONTAINER, name: "No supplier" });
    // Must not reach the API — the guard short-circuits (the API would 450897).
    assert.equal(stub.calls.length, 0);
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /supplierId or supplierName/);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("createExpense POSTs to /expenses with the body and surfaces round-trip fields", async (t) => {
    const stub = stubFetch(async () => ({ status: 201, body: apiExpense }));
    t.after(() => stub.restore());

    const result = await createExpenseTool.callback({
        containerId: CONTAINER,
        name: "Skip-key probe expense",
        supplierId: "542830416",
        externalId: "ptp-p0-expenses-skipkey-001",
        externalSystem: "ptp-acc-mcp-phase0",
        referenceNumber: "PO-REF-P0-1",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/expenses$`));
    assert.equal(call.body.name, "Skip-key probe expense");
    assert.equal(call.body.supplierId, "542830416");
    assert.equal(call.body.externalId, "ptp-p0-expenses-skipkey-001");
    // Anti-scope: status is never sent (server-controlled, not settable on write).
    assert.ok(!("status" in call.body));

    const s = result.structuredContent.summary;
    assert.equal(s.id, apiExpense.id);
    assert.equal(s.number, "ZZZ-EXP-P0-1");
    assert.equal(s.externalId, "ptp-p0-expenses-skipkey-001");
    assert.equal(s.externalSystem, "ptp-acc-mcp-phase0");
    assert.equal(s.status, "draft");
    assert.match(result.content[0].text, /Created expense ZZZ-EXP-P0-1/);
});

test("createExpense omits unset optional fields from the body", async (t) => {
    const stub = stubFetch(async () => ({ status: 201, body: apiExpense }));
    t.after(() => stub.restore());

    await createExpenseTool.callback({ containerId: CONTAINER, name: "N", supplierName: "Acme" });
    assert.deepEqual(Object.keys(stub.calls[0].body).sort(), ["name", "supplierName"]);
});

// ─── Error path ───────────────────────────────────────────────────────────────

test("createExpense surfaces the missing-name 400 envelope (Phase 0 45007)", async (t) => {
    const stub = stubFetch(async () => ({
        status: 400,
        body: { errors: [{ code: 45007, title: "OBJECT_MISSING_REQUIRED_PROPERTY", detail: "Missing required property: name" }], name: "ValidationException" },
    }));
    t.after(() => stub.restore());

    const result = await createExpenseTool.callback({ containerId: CONTAINER, name: "x", supplierName: "Acme" });
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /45007/);
});
