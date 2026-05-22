import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { updateContractTool } from "../../tools/cost/update-contract.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const CONTRACT = "22222222-2222-2222-2222-222222222222";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("updateContract input schema rejects missing required fields", () => {
    const { containerId, contractId } = updateContractTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => contractId.parse(""), /String must contain at least 1/);
});

test("updateContract input schema accepts all-optional content fields", () => {
    const { name, description, awardedAt } = updateContractTool.inputSchema;
    assert.equal(name.parse(undefined), undefined);
    assert.equal(description.parse(undefined), undefined);
    assert.equal(awardedAt.parse(undefined), undefined);
});

// ─── No-fields guard ──────────────────────────────────────────────────────────

test("updateContract short-circuits when no update fields are provided", async (t) => {
    const stub = stubFetch(async () => {
        throw new Error("should not hit network");
    });
    t.after(() => stub.restore());

    const result = await updateContractTool.callback({
        containerId: CONTAINER,
        contractId: CONTRACT,
    });

    assert.equal(stub.calls.length, 0);
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /No update fields/);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("updateContract sends PATCH with only the provided fields and shapes the response", async (t) => {
    const apiContract = {
        id: CONTRACT,
        code: "CON-001",
        name: "External civils subcontract — XYZ Pty Ltd",
        description: "phase 0 patch test",
        containerId: CONTAINER,
        status: "draft",
        companyName: "XYZ Pty Ltd",
        currency: "AUD",
        awardedAt: "2026-05-01T00:00:00.000Z",
        executedAt: "2026-05-15T00:00:00.000Z",
    };
    const stub = stubFetch(async () => ({ status: 200, body: apiContract }));
    t.after(() => stub.restore());

    const result = await updateContractTool.callback({
        containerId: CONTAINER,
        contractId: CONTRACT,
        description: "phase 0 patch test",
        executedAt: "2026-05-15T00:00:00.000Z",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "PATCH");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/contracts/${CONTRACT}$`));
    assert.deepEqual(Object.keys(call.body).sort(), ["description", "executedAt"]);
    assert.equal(call.body.description, "phase 0 patch test");
    assert.equal(call.body.executedAt, "2026-05-15T00:00:00.000Z");
    // Critical: deprecated `budgets` field is NOT sent on PATCH /contracts.
    assert.equal(call.body.budgets, undefined);

    assert.equal(result.structuredContent.summary.id, CONTRACT);
    assert.equal(result.structuredContent.summary.code, "CON-001");
    assert.equal(result.structuredContent.summary.vendor, "XYZ Pty Ltd");
    assert.deepEqual(result.structuredContent.changedFields.sort(), ["description", "executedAt"]);
    assert.match(result.content[0].text, /Updated contract CON-001/);
    assert.match(result.content[0].text, /Changed: description, executedAt/);
});

// ─── Error path ───────────────────────────────────────────────────────────────

test("updateContract surfaces the Cost API error envelope verbatim", async (t) => {
    // 400/409 envelopes are passed through formatCostApiError verbatim.
    // (404 and 403 hit costApiCall's hardcoded cost-module-not-activated /
    // missing-permission guidance branches — not exercised here.)
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            error: {
                errors: [{ code: 450019, title: "Validation failed.", detail: "executedAt must be after awardedAt." }],
                name: "ValidationException",
                statusCode: 400,
            },
        },
    }));
    t.after(() => stub.restore());

    const result = await updateContractTool.callback({
        containerId: CONTAINER,
        contractId: CONTRACT,
        executedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /status 400/);
    assert.match(result.content[0].text, /450019/);
    assert.match(result.content[0].text, /Validation failed/);
});
