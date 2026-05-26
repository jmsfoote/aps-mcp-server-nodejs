import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { transitionChangeOrderTool } from "../../tools/cost/transition-change-order.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const CO_ID = "9fecdd40-58c8-11f1-9770-7919ffb2ff0c";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("transitionChangeOrder input schema rejects missing required fields", () => {
    const { containerId, changeOrderId, changeOrderType, action } = transitionChangeOrderTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => changeOrderId.parse(""), /String must contain at least 1/);
    assert.throws(() => action.parse(""), /String must contain at least 1/);
    assert.throws(() => changeOrderType.parse("oco")); // lowercase rejected at Zod (case asymmetry)
    assert.throws(() => changeOrderType.parse("PCO"));
});

test("transitionChangeOrder accepts UPPERCASE OCO/SCO for changeOrderType", () => {
    const { changeOrderType } = transitionChangeOrderTool.inputSchema;
    assert.equal(changeOrderType.parse("OCO"), "OCO");
    assert.equal(changeOrderType.parse("SCO"), "SCO");
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("transitionChangeOrder sends bare-array body with UPPERCASE associationType", async (t) => {
    // Phase 0 (2026-05-26) round-4 captured: a 'submit' action on a fresh OCO
    // (budgetStatus=draft) returns 200 + echo array.
    const apiResp = [
        {
            action: "submit",
            associationId: CO_ID,
            associationType: "OCO",
            options: {},
        },
    ];
    const stub = stubFetch(async () => ({ status: 200, body: apiResp }));
    t.after(() => stub.restore());

    const result = await transitionChangeOrderTool.callback({
        containerId: CONTAINER,
        changeOrderId: CO_ID,
        changeOrderType: "OCO",
        action: "submit",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    // Critical: URL is /workflows/actions, NOT /actions (the inventory's wrong claim).
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/workflows/actions$`));
    // Critical: body is a BARE ARRAY — not wrapped in {data:[...]} or anything.
    assert.ok(Array.isArray(call.body), "body must be a bare top-level array");
    assert.equal(call.body.length, 1);
    assert.equal(call.body[0].action, "submit");
    assert.equal(call.body[0].associationId, CO_ID);
    // Critical: associationType MUST be UPPERCASE (Phase 0 round-4 found
    // lowercase returns ENUM_MISMATCH).
    assert.equal(call.body[0].associationType, "OCO");
    assert.deepEqual(call.body[0].options, {});

    assert.equal(result.structuredContent.summary.changeOrderId, CO_ID);
    assert.equal(result.structuredContent.summary.action, "submit");
    assert.equal(result.structuredContent.summary.applied, 1);
});

test("transitionChangeOrder passes user-supplied options through", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: [{ action: "submit" }] }));
    t.after(() => stub.restore());

    await transitionChangeOrderTool.callback({
        containerId: CONTAINER,
        changeOrderId: CO_ID,
        changeOrderType: "OCO",
        action: "submit",
        options: { sendNotifications: false },
    });

    assert.deepEqual(stub.calls[0].body[0].options, { sendNotifications: false });
});

// ─── Error path — invalid action ─────────────────────────────────────────────

test("transitionChangeOrder surfaces ENUM_MISMATCH for invalid action verbatim", async (t) => {
    // Phase 0 round-4 didn't capture an invalid-action error cleanly (the
    // associationType-case validation ran first). This synthesises a likely
    // shape — if the live API differs, the formatCostApiError helper still
    // handles the standard nested/flat error-envelope variants.
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            errors: [{ code: 45007, title: "ENUM_MISMATCH", detail: "No enum match for: no_such_action_xyz on 0.action" }],
            name: "ValidationException",
        },
    }));
    t.after(() => stub.restore());

    const result = await transitionChangeOrderTool.callback({
        containerId: CONTAINER,
        changeOrderId: CO_ID,
        changeOrderType: "OCO",
        action: "no_such_action_xyz",
    });

    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /45007/);
    assert.match(result.content[0].text, /ENUM_MISMATCH/);
});
