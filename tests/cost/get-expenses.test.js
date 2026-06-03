import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { getExpensesTool } from "../../tools/cost/get-expenses.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// Shape modeled on the Phase 0 (2026-06-03) live capture from Parkside — the
// expense list returns INSTANCES wrapped in { results: [...], pagination }.
const apiExpenses = [
    {
        status: "draft",
        id: "91ab3eb0-5efa-11f1-8a76-c5ce0121f9b7",
        containerId: CONTAINER,
        supplierId: "542830416",
        supplierName: "PTP Group",
        type: null,
        number: "ZZZ-EXP-P0-1",
        name: "Skip-key probe expense",
        description: "round-trip capture",
        amount: "150.0000",
        referenceNumber: "PO-REF-P0-1",
        externalSystem: "ptp-acc-mcp-phase0",
        externalId: "ptp-p0-expenses-skipkey-001",
        mainContractId: "f5a3f9e0-58c2-11f1-9770-7919ffb2ff0c",
        createdAt: "2026-06-03T03:16:10.423Z",
        expenseItems: [],
    },
    {
        status: "paid",
        id: "bee4c792-ffff-4aa7-9d26-be721a343f08",
        supplierName: "PTP Group",
        number: "0001",
        name: "Traffic Engineer Payment",
        amount: null,
        externalId: null,
        externalSystem: null,
        expenseItems: [{ id: "item-1" }],
    },
];

// ─── Input schema ─────────────────────────────────────────────────────────────

test("getExpenses input schema rejects empty containerId", () => {
    const { containerId } = getExpensesTool.inputSchema;
    assert.throws(() => containerId.parse(""));
});

test("getExpenses externalId/status filters are optional and limit defaults", () => {
    const { externalId, status, limit } = getExpensesTool.inputSchema;
    assert.equal(externalId.parse(undefined), undefined);
    assert.equal(status.parse(undefined), undefined);
    assert.equal(limit.parse(undefined), 100); // default
});

// ─── Response mapping (Phase 0 captured shape) ───────────────────────────────

test("getExpenses surfaces externalId/externalSystem and coerces amount to a number", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: { results: apiExpenses, pagination: { limit: 100, totalResults: 2, offset: 0 } } }));
    t.after(() => stub.restore());

    const result = await getExpensesTool.callback({ containerId: CONTAINER, limit: 100 });
    const ex = result.structuredContent.expenses;
    assert.equal(ex.length, 2);
    // Skip-map key round-trips into the mapping (load-bearing for the wave handler).
    assert.equal(ex[0].externalId, "ptp-p0-expenses-skipkey-001");
    assert.equal(ex[0].externalSystem, "ptp-acc-mcp-phase0");
    assert.equal(ex[0].referenceNumber, "PO-REF-P0-1");
    assert.equal(ex[0].supplierName, "PTP Group");
    // amount "150.0000" (string) → 150 (number) via numVal; null → 0.
    assert.equal(ex[0].amount, 150);
    assert.equal(typeof ex[0].amount, "number");
    assert.equal(ex[1].amount, 0);
    assert.equal(result.structuredContent.totals.amount, 150);
});

// ─── #21 endpoint-variability fences (Phase 0 findings) ──────────────────────

test("getExpenses CLAMPS page size to 100 (the API caps limit at 100 — guards pagination truncation)", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: { results: [], pagination: { limit: 100, totalResults: 0, offset: 0 } } }));
    t.after(() => stub.restore());

    await getExpensesTool.callback({ containerId: CONTAINER, limit: 500 });
    assert.equal(stub.calls.length, 1);
    // Request must ask for 100, not 500 — else costApiFetchAll would stop early
    // on the first full 100-item page and silently truncate.
    assert.match(stub.calls[0].url, /[?&]limit=100(&|$)/);
    assert.doesNotMatch(stub.calls[0].url, /limit=500/);
});

test("getExpenses passes externalId/status as server-side filter[...] params", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: { results: [], pagination: { limit: 100, totalResults: 0, offset: 0 } } }));
    t.after(() => stub.restore());

    await getExpensesTool.callback({ containerId: CONTAINER, externalId: "ext-key-1", status: "draft", limit: 100 });
    // URLSearchParams percent-encodes the brackets — verified honored live.
    assert.match(stub.calls[0].url, /filter%5BexternalId%5D=ext-key-1/);
    assert.match(stub.calls[0].url, /filter%5Bstatus%5D=draft/);
});

test("getExpenses renders Cost API errors via formatCostApiError (parses the envelope, not raw JSON)", async (t) => {
    const stub = stubFetch(async () => ({
        status: 400,
        body: { errors: [{ code: 45007, title: "VALIDATION", detail: "bad filter value" }], name: "ValidationException" },
    }));
    t.after(() => stub.restore());

    const result = await getExpensesTool.callback({ containerId: CONTAINER, limit: 100 });
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    // Formatted through the shared helper — not the raw response body.
    assert.match(result.content[0].text, /Cost API error \(status 400\)/);
    assert.match(result.content[0].text, /45007/);
    assert.doesNotMatch(result.content[0].text, /Error fetching expenses/);
});
