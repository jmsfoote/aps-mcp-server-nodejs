import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { getChangeOrdersTool } from "../../tools/cost/get-change-orders.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("getChangeOrders input schema rejects empty containerId", () => {
    const { containerId } = getChangeOrdersTool.inputSchema;
    assert.throws(() => containerId.parse(""));
});

// ─── Response mapping (Phase 0 captured shape) ───────────────────────────────

// Shape modeled after the Phase 0 OCO response captured by Slice 2 PR-1 (see
// `create-change-order.test.js`) and re-verified live against Parkside on
// 2026-05-27. Field names that matter for the mapping: `type` (human label),
// `formDefinitionType` (lowercase machine enum), `budgetStatus`, `costStatus`.
// `status` and `state` are intentionally absent — the API does not surface them.
const apiOcoChangeOrders = [
    {
        id: "f45a89f0-58c2-11f1-9770-7919ffb2ff0c",
        containerId: CONTAINER,
        number: "0001",
        name: "ZZZ Slice 2 Phase 0 OCO",
        scope: "out",
        type: "Owner Change Order",
        formDefinitionType: "oco",
        description: null,
        budgetStatus: "draft",
        costStatus: null,
        contractId: null,
        createdAt: "2026-05-26T05:22:57.168Z",
    },
    {
        id: "2ddcfb40-58c3-11f1-9770-7919ffb2ff0c",
        containerId: CONTAINER,
        number: "0002",
        name: "ZZZ R3 OCO",
        scope: "out",
        type: "Owner Change Order",
        formDefinitionType: "oco",
        description: null,
        budgetStatus: "draft",
        costStatus: null,
        contractId: null,
        createdAt: "2026-05-26T05:24:33.652Z",
    },
];

test("getChangeOrders surfaces formDefinitionType, budgetStatus, costStatus", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: apiOcoChangeOrders }));
    t.after(() => stub.restore());

    const result = await getChangeOrdersTool.callback({
        containerId: CONTAINER,
        type: "oco",
        limit: 200,
    });

    const cos = result.structuredContent.changeOrders;
    assert.equal(cos.length, 2);
    assert.equal(cos[0].formDefinitionType, "oco");
    assert.equal(cos[0].type, "Owner Change Order");
    assert.equal(cos[0].budgetStatus, "draft");
    assert.equal(cos[0].costStatus, null);
    // Regression fence: the broken `status: getFirst(co, "status", "state")`
    // must not return. Anyone re-adding it hits this assertion.
    assert.ok(!Object.prototype.hasOwnProperty.call(cos[0], "status"));
    // Existing fields preserved for current callers.
    assert.equal(cos[0].id, apiOcoChangeOrders[0].id);
    assert.equal(cos[0].number, "0001");
    assert.equal(cos[0].name, "ZZZ Slice 2 Phase 0 OCO");
    assert.equal(cos[0].scope, "out");
    assert.equal(cos[0].createdAt, "2026-05-26T05:22:57.168Z");
});

// ─── URL-path lowercase normalization (bidirectional) ────────────────────────

test("getChangeOrders lowercases uppercase type segment in URL path", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: [] }));
    t.after(() => stub.restore());

    await getChangeOrdersTool.callback({
        containerId: CONTAINER,
        type: "OCO",
        limit: 200,
    });

    assert.equal(stub.calls.length, 1);
    // Must hit /change-orders/oco, not /change-orders/OCO (Phase 0 finding —
    // uppercase returns 400 ENUM_MISMATCH from the Cost API).
    assert.match(stub.calls[0].url, /\/change-orders\/oco\?/);
    assert.doesNotMatch(stub.calls[0].url, /\/change-orders\/OCO/);
});

test("getChangeOrders preserves already-lowercase type segment", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: [] }));
    t.after(() => stub.restore());

    await getChangeOrdersTool.callback({
        containerId: CONTAINER,
        type: "oco",
        limit: 200,
    });

    assert.match(stub.calls[0].url, /\/change-orders\/oco\?/);
});

test("getChangeOrders omits the type segment entirely when no type is passed", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: [] }));
    t.after(() => stub.restore());

    await getChangeOrdersTool.callback({
        containerId: CONTAINER,
        limit: 200,
    });

    // /change-orders, not /change-orders/something
    assert.match(stub.calls[0].url, /\/change-orders\?/);
});

test("getChangeOrders trims incidental whitespace around the type segment", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: [] }));
    t.after(() => stub.restore());

    await getChangeOrdersTool.callback({
        containerId: CONTAINER,
        type: "  OCO ",
        limit: 200,
    });

    // Trim runs before lowercase, so the path is /change-orders/oco — not
    // /change-orders/%20%20OCO%20 or /change-orders/   oco .
    assert.match(stub.calls[0].url, /\/change-orders\/oco\?/);
});

test("getChangeOrders treats whitespace-only type as no filter", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: [] }));
    t.after(() => stub.restore());

    await getChangeOrdersTool.callback({
        containerId: CONTAINER,
        type: "   ",
        limit: 200,
    });

    // Whitespace-only collapses to "" (falsy) → bare endpoint, no segment.
    assert.match(stub.calls[0].url, /\/change-orders\?/);
    assert.doesNotMatch(stub.calls[0].url, /\/change-orders\//);
});
