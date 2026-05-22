import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { createContractTool } from "../../tools/cost/create-contract.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("createContract input schema rejects missing required fields", () => {
    const { containerId, code, name } = createContractTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => code.parse(""), /String must contain at least 1/);
    assert.throws(() => name.parse(""), /String must contain at least 1/);
});

test("createContract input schema accepts optional fields", () => {
    const { number, description, type, companyId, currency, awardedAt, executedAt, statusChangedAt } =
        createContractTool.inputSchema;
    assert.equal(number.parse(undefined), undefined);
    assert.equal(description.parse(undefined), undefined);
    assert.equal(type.parse("subcontract"), "subcontract");
    assert.equal(companyId.parse("co-1"), "co-1");
    assert.equal(currency.parse("AUD"), "AUD");
    assert.equal(awardedAt.parse("2026-05-01T00:00:00.000Z"), "2026-05-01T00:00:00.000Z");
    assert.equal(executedAt.parse(undefined), undefined);
    assert.equal(statusChangedAt.parse(undefined), undefined);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("createContract sends required + optional fields and shapes the response", async (t) => {
    const apiContract = {
        id: "con-1",
        code: "CON-001",
        name: "External civils subcontract — XYZ Pty Ltd",
        description: "phase 0 verify",
        containerId: CONTAINER,
        budgetIds: [],
        status: "draft",
        subStatus: null,
        companyId: "co-1",
        companyName: "XYZ Pty Ltd",
        currency: "AUD",
        awardedAt: "2026-05-01T00:00:00.000Z",
        executedAt: "2026-05-15T00:00:00.000Z",
        statusChangedAt: "2026-05-22T03:33:21.360Z",
    };
    const stub = stubFetch(async () => ({ status: 201, body: apiContract }));
    t.after(() => stub.restore());

    const result = await createContractTool.callback({
        containerId: CONTAINER,
        code: "CON-001",
        name: "External civils subcontract — XYZ Pty Ltd",
        description: "phase 0 verify",
        companyId: "co-1",
        awardedAt: "2026-05-01T00:00:00.000Z",
        executedAt: "2026-05-15T00:00:00.000Z",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/contracts$`));
    assert.equal(call.body.code, "CON-001");
    assert.equal(call.body.name, "External civils subcontract — XYZ Pty Ltd");
    assert.equal(call.body.description, "phase 0 verify");
    assert.equal(call.body.awardedAt, "2026-05-01T00:00:00.000Z");
    assert.equal(call.body.executedAt, "2026-05-15T00:00:00.000Z");
    // Critical: deprecated `budgets` field (2024-10-15) is NOT sent on POST /contracts.
    assert.equal(call.body.budgets, undefined);

    assert.equal(result.structuredContent.summary.id, "con-1");
    assert.equal(result.structuredContent.summary.code, "CON-001");
    assert.equal(result.structuredContent.summary.vendor, "XYZ Pty Ltd");
    assert.equal(result.structuredContent.summary.currency, "AUD");
    assert.equal(result.structuredContent.summary.status, "draft");
    assert.match(result.content[0].text, /Created contract CON-001/);
    assert.match(result.content[0].text, /linkBudgetsContractsTool/);
});

test("createContract omits unset optional fields from the request body", async (t) => {
    const stub = stubFetch(async () => ({
        status: 201,
        body: { id: "x", code: "C", name: "N", status: "draft" },
    }));
    t.after(() => stub.restore());

    await createContractTool.callback({ containerId: CONTAINER, code: "C", name: "N" });

    const body = stub.calls[0].body;
    assert.deepEqual(Object.keys(body).sort(), ["code", "name"]);
    // Specifically: no `budgets` field smuggled in.
    assert.equal(body.budgets, undefined);
});

// ─── Error path ───────────────────────────────────────────────────────────────

test("createContract surfaces the Cost API error envelope verbatim (missing code)", async (t) => {
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            error: {
                errors: [{ code: 451111, title: "Contract code is required.", detail: {} }],
                name: "ValidationException",
                title: "Contract code is required.",
                statusCode: 400,
            },
        },
    }));
    t.after(() => stub.restore());

    // The schema requires code, so we'd never reach the API; this test simulates
    // the server-side rejection when a callback bypasses the schema or the
    // payload becomes invalid for some other reason.
    const result = await createContractTool.callback({
        containerId: CONTAINER,
        code: "C",
        name: "N",
    });

    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /status 400/);
    assert.match(result.content[0].text, /451111/);
    assert.match(result.content[0].text, /Contract code is required/);
});
