import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { updateBudgetTool } from "../../tools/cost/update-budget.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const BUDGET_ID = "bud-1";

test("updateBudget input schema rejects empty containerId/budgetId", () => {
    const { containerId, budgetId } = updateBudgetTool.inputSchema;
    assert.throws(() => containerId.parse(""));
    assert.throws(() => budgetId.parse(""));
});

test("updateBudget short-circuits when no update fields provided", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: {} }));
    t.after(() => stub.restore());

    const result = await updateBudgetTool.callback({ containerId: CONTAINER, budgetId: BUDGET_ID });

    // Should NOT have called the API
    assert.equal(stub.calls.length, 0);
    assert.equal(result.structuredContent.error, true);
    assert.match(result.content[0].text, /No update fields/);
});

test("updateBudget PATCHes the right URL with only the provided fields", async (t) => {
    const stub = stubFetch(async () => ({
        status: 200,
        body: {
            id: BUDGET_ID,
            code: "000011700",
            formattedCode: "1.700",
            name: "Renamed",
            description: "new desc",
            originalAmount: "350000.0000",
            unitPrice: "350000.0",
            quantity: 1,
        },
    }));
    t.after(() => stub.restore());

    const result = await updateBudgetTool.callback({
        containerId: CONTAINER,
        budgetId: BUDGET_ID,
        name: "Renamed",
        description: "new desc",
        // explicit undefined should be stripped
        unitPrice: undefined,
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "PATCH");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/budgets/${BUDGET_ID}$`));
    assert.deepEqual(Object.keys(call.body).sort(), ["description", "name"]);
    assert.equal(call.body.unitPrice, undefined);

    assert.equal(result.structuredContent.summary.name, "Renamed");
    assert.deepEqual(result.structuredContent.changedFields.sort(), ["description", "name"]);
    assert.match(result.content[0].text, /Changed: name, description|Changed: description, name/);
});

test("updateBudget surfaces API errors with status and code", async (t) => {
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            error: {
                errors: [{ code: 45007, title: "OBJECT_INVALID", detail: "field foo invalid" }],
                statusCode: 400,
            },
        },
    }));
    t.after(() => stub.restore());

    const result = await updateBudgetTool.callback({
        containerId: CONTAINER,
        budgetId: BUDGET_ID,
        name: "x",
    });

    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /status 400/);
    assert.match(result.content[0].text, /45007/);
    assert.match(result.content[0].text, /OBJECT_INVALID/);
});
