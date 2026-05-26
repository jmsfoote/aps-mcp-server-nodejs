import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { createChangeOrderTool } from "../../tools/cost/create-change-order.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("createChangeOrder input schema rejects missing required fields", () => {
    const { containerId, changeOrderType, code, name } = createChangeOrderTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => code.parse(""), /String must contain at least 1/);
    assert.throws(() => name.parse(""), /String must contain at least 1/);
    // changeOrderType is an enum; passing undefined or invalid throws
    assert.throws(() => changeOrderType.parse(undefined));
    assert.throws(() => changeOrderType.parse("oco")); // lowercase rejected at Zod
});

// ─── Bidirectional contract: OCO/SCO accepted; PCO/RFQ/COR rejected ──────────

test("createChangeOrder accepts OCO and SCO at the Zod layer", () => {
    const { changeOrderType } = createChangeOrderTool.inputSchema;
    assert.equal(changeOrderType.parse("OCO"), "OCO");
    assert.equal(changeOrderType.parse("SCO"), "SCO");
});

test("createChangeOrder REJECTS PCO/RFQ/COR at the Zod layer (M7b deferral)", () => {
    const { changeOrderType } = createChangeOrderTool.inputSchema;
    assert.throws(() => changeOrderType.parse("PCO"));
    assert.throws(() => changeOrderType.parse("RFQ"));
    assert.throws(() => changeOrderType.parse("COR"));
});

// ─── Happy path: OCO ──────────────────────────────────────────────────────────

test("createChangeOrder sends lowercase type in URL, full body, and shapes the response", async (t) => {
    // Phase 0 (2026-05-26) captured fixture — OCO response from Parkside sandbox.
    const apiCO = {
        id: "f45a89f0-58c2-11f1-9770-7919ffb2ff0c",
        containerId: CONTAINER,
        number: "0001",
        name: "External civils OCO — XYZ Pty Ltd",
        scope: "out",
        type: "Owner Change Order",
        formDefinitionType: "oco",
        description: "phase 0 verify",
        note: null,
        budgetStatus: "draft",
        costStatus: null,
        workflowType: "Budget",
        contractId: null,
        mainContractId: null,
        companyId: "abebad03-320f-4b0b-94a7-beb604c31e3e",
        createdAt: "2026-05-26T05:22:57.168Z",
    };
    const stub = stubFetch(async () => ({ status: 201, body: apiCO }));
    t.after(() => stub.restore());

    const result = await createChangeOrderTool.callback({
        containerId: CONTAINER,
        changeOrderType: "OCO",
        code: "OCO-001",
        name: "External civils OCO — XYZ Pty Ltd",
        description: "phase 0 verify",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    // Critical: URL uses LOWERCASE type, not uppercase (Phase 0 round-2 finding).
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/change-orders/oco$`));
    assert.equal(call.body.code, "OCO-001");
    assert.equal(call.body.name, "External civils OCO — XYZ Pty Ltd");
    assert.equal(call.body.description, "phase 0 verify");

    assert.equal(result.structuredContent.summary.id, apiCO.id);
    assert.equal(result.structuredContent.summary.number, "0001");
    assert.equal(result.structuredContent.summary.formDefinitionType, "oco");
    assert.equal(result.structuredContent.summary.typeLabel, "Owner Change Order");
    assert.equal(result.structuredContent.summary.budgetStatus, "draft");
    assert.equal(result.structuredContent.summary.costStatus, null);
    assert.match(result.content[0].text, /Created OCO OCO-001/);
});

test("createChangeOrder SCO uses lowercase sco in URL", async (t) => {
    const stub = stubFetch(async () => ({
        status: 201,
        body: { id: "s1", number: "0002", name: "N", formDefinitionType: "sco", budgetStatus: "draft" },
    }));
    t.after(() => stub.restore());

    await createChangeOrderTool.callback({
        containerId: CONTAINER,
        changeOrderType: "SCO",
        code: "SCO-001",
        name: "N",
    });

    assert.match(stub.calls[0].url, new RegExp(`/change-orders/sco$`));
});

test("createChangeOrder omits unset optional fields from the request body", async (t) => {
    const stub = stubFetch(async () => ({
        status: 201,
        body: { id: "x", code: "C", name: "N", formDefinitionType: "oco", budgetStatus: "draft" },
    }));
    t.after(() => stub.restore());

    await createChangeOrderTool.callback({
        containerId: CONTAINER,
        changeOrderType: "OCO",
        code: "C",
        name: "N",
    });

    const body = stub.calls[0].body;
    assert.deepEqual(Object.keys(body).sort(), ["code", "name"]);
});

// ─── Error path ───────────────────────────────────────────────────────────────

test("createChangeOrder surfaces the Cost API error envelope (ENUM_MISMATCH on wrong case)", async (t) => {
    // Phase 0 round-1 captured this exact error when uppercase type was used in path.
    // The tool always lowercases, so this codepath simulates an unrelated
    // server-side ENUM_MISMATCH (e.g. unknown future enum value).
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            errors: [{ code: 45007, title: "ENUM_MISMATCH", detail: "No enum match for: OCO" }],
            name: "ValidationException",
        },
    }));
    t.after(() => stub.restore());

    const result = await createChangeOrderTool.callback({
        containerId: CONTAINER,
        changeOrderType: "OCO",
        code: "C",
        name: "N",
    });

    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /45007/);
    assert.match(result.content[0].text, /ENUM_MISMATCH/);
});
