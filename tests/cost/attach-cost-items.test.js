import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { attachCostItemsTool } from "../../tools/cost/attach-cost-items.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const OCO_ID = "2ddcfb40-58c3-11f1-9770-7919ffb2ff0c";
const CI_A = "2e22dde0-58c3-11f1-ba51-79b16742e941";
const CI_B = "2e22dde1-58c3-11f1-ba51-79b16742e941";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("attachCostItems input schema rejects missing required fields", () => {
    const { containerId, pairs } = attachCostItemsTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => pairs.parse([])); // .min(1)
    assert.throws(() => pairs.parse([{ changeOrderId: OCO_ID }])); // missing costItemId
    assert.throws(() => pairs.parse([{ costItemId: CI_A }])); // missing changeOrderId
    assert.throws(() => pairs.parse([{ changeOrderId: "", costItemId: CI_A }]));
});

test("attachCostItems input schema accepts multiple pairs", () => {
    const { pairs } = attachCostItemsTool.inputSchema;
    assert.doesNotThrow(() =>
        pairs.parse([
            { changeOrderId: OCO_ID, costItemId: CI_A },
            { changeOrderId: OCO_ID, costItemId: CI_B },
        ])
    );
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("attachCostItems sends a BARE ARRAY body (not wrapped) and shapes the response", async (t) => {
    // Phase 0 (2026-05-26) round-3 captured: response is bare-array echo of input pairs.
    const apiResp = [{ changeOrderId: OCO_ID, costItemId: CI_A }];
    const stub = stubFetch(async () => ({ status: 200, body: apiResp }));
    t.after(() => stub.restore());

    const result = await attachCostItemsTool.callback({
        containerId: CONTAINER,
        pairs: [{ changeOrderId: OCO_ID, costItemId: CI_A }],
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/cost-items:attach$`));
    // Critical: body is a BARE TOP-LEVEL ARRAY. All other shapes returned 400 in Phase 0.
    assert.ok(Array.isArray(call.body), "body must be a bare top-level array");
    assert.equal(call.body.length, 1);
    assert.equal(call.body[0].changeOrderId, OCO_ID);
    assert.equal(call.body[0].costItemId, CI_A);

    assert.equal(result.structuredContent.count, 1);
    assert.equal(result.structuredContent.pairs[0].changeOrderId, OCO_ID);
    assert.equal(result.structuredContent.pairs[0].costItemId, CI_A);
});

test("attachCostItems handles multiple pairs in one call", async (t) => {
    const stub = stubFetch(async () => ({
        status: 200,
        body: [
            { changeOrderId: OCO_ID, costItemId: CI_A },
            { changeOrderId: OCO_ID, costItemId: CI_B },
        ],
    }));
    t.after(() => stub.restore());

    await attachCostItemsTool.callback({
        containerId: CONTAINER,
        pairs: [
            { changeOrderId: OCO_ID, costItemId: CI_A },
            { changeOrderId: OCO_ID, costItemId: CI_B },
        ],
    });

    const body = stub.calls[0].body;
    assert.equal(body.length, 2);
    assert.equal(body[0].costItemId, CI_A);
    assert.equal(body[1].costItemId, CI_B);
});

// ─── Error path — wrong-shape rejected by API ────────────────────────────────

test("attachCostItems surfaces 'Expected type array' error verbatim", async (t) => {
    // Phase 0 round-3 captured: wrapped shapes (e.g. {attach:[...]}) returned this error.
    // The tool sends a bare array so wouldn't trigger this in practice, but the
    // formatCostApiError path needs to handle the envelope.
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            errors: [{ code: 45007, title: "INVALID_TYPE", detail: "Expected type array but found type object" }],
            name: "ValidationException",
        },
    }));
    t.after(() => stub.restore());

    const result = await attachCostItemsTool.callback({
        containerId: CONTAINER,
        pairs: [{ changeOrderId: OCO_ID, costItemId: CI_A }],
    });

    assert.equal(result.structuredContent.error, true);
    assert.match(result.content[0].text, /45007/);
    assert.match(result.content[0].text, /INVALID_TYPE/);
});
