import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { createBudgetTool } from "../../tools/cost/create-budget.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("createBudget input schema rejects missing required fields", () => {
    const { containerId, name, code } = createBudgetTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => name.parse(""), /String must contain at least 1/);
    assert.throws(() => code.parse(""), /String must contain at least 1/);
});

test("createBudget input schema rejects malformed codes (whitespace, garbage)", () => {
    const { code } = createBudgetTool.inputSchema;
    assert.doesNotThrow(() => code.parse("000011700"));
    assert.doesNotThrow(() => code.parse("A.B-C_D"));
    assert.throws(() => code.parse("000 11700"), /alphanumeric/i);
    assert.throws(() => code.parse("000\n11700"), /alphanumeric/i);
    assert.throws(() => code.parse("000/11700"), /alphanumeric/i);
    assert.throws(() => code.parse("x".repeat(65)), /at most 64/i);
});

test("createBudget input schema accepts optional fields", () => {
    const { description, unitPrice, quantity, scope } = createBudgetTool.inputSchema;
    assert.equal(description.parse(undefined), undefined);
    assert.equal(unitPrice.parse("1234.56"), "1234.56");
    assert.equal(quantity.parse(2), 2);
    assert.equal(scope.parse("budgetAndCost"), "budgetAndCost");
    assert.throws(() => scope.parse("nope"));
});

// ─── Happy path ────────────────────────────────────────────────────────────────

test("createBudget sends `code` (not `budgetCode`) and shapes the response", async (t) => {
    const apiBudget = {
        id: "bud-1",
        code: "000011700",
        formattedCode: "1.700",
        name: "External civil works",
        scope: "budgetAndCost",
        originalAmount: "350000.0000",
        unitPrice: "350000.00000000",
        quantity: 1,
    };
    const stub = stubFetch(async () => ({ status: 201, body: apiBudget }));
    t.after(() => stub.restore());

    const result = await createBudgetTool.callback({
        containerId: CONTAINER,
        name: "External civil works",
        code: "000011700",
        unitPrice: "350000.00",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/budgets$`));
    // Critical: field name is `code`, not `budgetCode`.
    assert.equal(call.body.code, "000011700");
    assert.equal(call.body.name, "External civil works");
    assert.equal(call.body.unitPrice, "350000.00");
    assert.equal(call.body.budgetCode, undefined);

    assert.equal(result.structuredContent.summary.id, "bud-1");
    assert.equal(result.structuredContent.summary.code, "000011700");
    assert.equal(result.structuredContent.summary.originalAmount, 350000);
    // numVal must parse the API's string-as-number — not concatenate
    assert.equal(typeof result.structuredContent.summary.originalAmount, "number");
    assert.match(result.content[0].text, /Created budget 000011700/);
});

test("createBudget omits unset optional fields from the request body", async (t) => {
    const stub = stubFetch(async () => ({ status: 201, body: { id: "x", code: "C", name: "N" } }));
    t.after(() => stub.restore());

    await createBudgetTool.callback({ containerId: CONTAINER, name: "N", code: "C" });

    const body = stub.calls[0].body;
    assert.deepEqual(Object.keys(body).sort(), ["code", "name"]);
});

// ─── Error path ────────────────────────────────────────────────────────────────

test("createBudget surfaces the Cost API error envelope verbatim", async (t) => {
    const stub = stubFetch(async () => ({
        status: 409,
        body: {
            error: {
                errors: [{ code: 450407, title: "Code length not matched.", detail: "code: XYZ length not matched" }],
                name: "ConflictError",
                statusCode: 409,
            },
        },
    }));
    t.after(() => stub.restore());

    const result = await createBudgetTool.callback({
        containerId: CONTAINER,
        name: "N",
        code: "TOO_SHORT",
    });

    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 409);
    assert.match(result.content[0].text, /status 409/);
    assert.match(result.content[0].text, /450407/);
    assert.match(result.content[0].text, /Code length not matched/);
});
