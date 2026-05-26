import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { createMainContractTool } from "../../tools/cost/create-main-contract.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("createMainContract input schema rejects missing required fields", () => {
    const { containerId, code, name } = createMainContractTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => code.parse(""), /String must contain at least 1/);
    assert.throws(() => name.parse(""), /String must contain at least 1/);
});

test("createMainContract input schema accepts optional fields", () => {
    const { description, note, type, currency } = createMainContractTool.inputSchema;
    assert.equal(description.parse(undefined), undefined);
    assert.equal(note.parse(undefined), undefined);
    assert.equal(type.parse("Fixed Price"), "Fixed Price");
    assert.equal(currency.parse("AUD"), "AUD");
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("createMainContract sends required + optional fields and shapes the response", async (t) => {
    // Phase 0 (2026-05-26) captured: minimal {code, name} returns 201 + full main-contract object.
    const apiMC = {
        id: "2efe70d0-58c3-11f1-9770-7919ffb2ff0c",
        containerId: CONTAINER,
        code: "MC-001",
        name: "ZZZ Slice 2 Phase 0 Main Contract",
        status: "draft",
        type: null,
        currency: "AUD",
        externalSystem: null,
        externalId: null,
        integrationState: null,
        createdAt: "2026-05-26T05:24:36.000Z",
    };
    const stub = stubFetch(async () => ({ status: 201, body: apiMC }));
    t.after(() => stub.restore());

    const result = await createMainContractTool.callback({
        containerId: CONTAINER,
        code: "MC-001",
        name: "ZZZ Slice 2 Phase 0 Main Contract",
        description: "test",
        type: "Fixed Price",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/main-contracts$`));
    assert.equal(call.body.code, "MC-001");
    assert.equal(call.body.name, "ZZZ Slice 2 Phase 0 Main Contract");
    assert.equal(call.body.description, "test");
    assert.equal(call.body.type, "Fixed Price");

    assert.equal(result.structuredContent.summary.id, apiMC.id);
    assert.equal(result.structuredContent.summary.code, "MC-001");
    assert.equal(result.structuredContent.summary.status, "draft");
    assert.match(result.content[0].text, /Created main contract MC-001/);
    assert.match(result.content[0].text, /deferred to M7b/);
});

test("createMainContract omits unset optional fields from the request body", async (t) => {
    const stub = stubFetch(async () => ({
        status: 201,
        body: { id: "x", code: "C", name: "N", status: "draft" },
    }));
    t.after(() => stub.restore());

    await createMainContractTool.callback({ containerId: CONTAINER, code: "C", name: "N" });

    const body = stub.calls[0].body;
    assert.deepEqual(Object.keys(body).sort(), ["code", "name"]);
});

// ─── Error path ───────────────────────────────────────────────────────────────

test("createMainContract surfaces 'Missing required property: code' verbatim", async (t) => {
    // Phase 0 round-1 captured this exact error when {name, number} was sent without code.
    const stub = stubFetch(async () => ({
        status: 400,
        body: {
            errors: [{ code: 45007, title: "OBJECT_MISSING_REQUIRED_PROPERTY", detail: "Missing required property: code" }],
            name: "ValidationException",
        },
    }));
    t.after(() => stub.restore());

    const result = await createMainContractTool.callback({
        containerId: CONTAINER,
        code: "C",
        name: "N",
    });

    assert.equal(result.structuredContent.error, true);
    assert.match(result.content[0].text, /Missing required property: code/);
});
