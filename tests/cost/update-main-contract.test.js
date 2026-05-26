import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { updateMainContractTool } from "../../tools/cost/update-main-contract.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const MC_ID = "2efe70d0-58c3-11f1-9770-7919ffb2ff0c";

// ─── Input schema ─────────────────────────────────────────────────────────────

test("updateMainContract input schema rejects missing containerId / mainContractId", () => {
    const { containerId, mainContractId } = updateMainContractTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
    assert.throws(() => mainContractId.parse(""), /String must contain at least 1/);
});

test("updateMainContract input schema only declares content fields (no status)", () => {
    // The Zod schema for this tool is the content-fields whitelist.
    // Verify that lifecycle/status fields are NOT in the inputSchema —
    // this is the design-choice tools-side restriction documented in the
    // tool. (API accepts status PATCH; tool does not expose it.)
    const keys = Object.keys(updateMainContractTool.inputSchema).sort();
    assert.deepEqual(keys, [
        "code",
        "containerId",
        "currency",
        "description",
        "mainContractId",
        "name",
        "note",
        "type",
    ]);
    assert.equal(updateMainContractTool.inputSchema.status, undefined);
});

// ─── No-ops guard ─────────────────────────────────────────────────────────────

test("updateMainContract refuses no-ops (no content fields) client-side", async (t) => {
    const stub = stubFetch(async () => {
        throw new Error("should not hit network");
    });
    t.after(() => stub.restore());

    const result = await updateMainContractTool.callback({
        containerId: CONTAINER,
        mainContractId: MC_ID,
    });

    assert.equal(stub.calls.length, 0);
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /No update fields provided/);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test("updateMainContract sends PATCH with only the provided content fields", async (t) => {
    // Phase 0 (2026-05-26) round-3 captured: PATCH {name} returned 200 + full main-contract object.
    const apiMC = {
        id: MC_ID,
        containerId: CONTAINER,
        code: "MC-001",
        name: "ZZZ Slice 2 Phase 0 Main Contract — patched",
        status: "draft",
        type: null,
    };
    const stub = stubFetch(async () => ({ status: 200, body: apiMC }));
    t.after(() => stub.restore());

    const result = await updateMainContractTool.callback({
        containerId: CONTAINER,
        mainContractId: MC_ID,
        name: "ZZZ Slice 2 Phase 0 Main Contract — patched",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "PATCH");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/main-contracts/${MC_ID}$`));
    assert.deepEqual(Object.keys(call.body), ["name"]);
    assert.equal(call.body.name, "ZZZ Slice 2 Phase 0 Main Contract — patched");

    assert.equal(result.structuredContent.summary.id, MC_ID);
    assert.deepEqual(result.structuredContent.changedFields, ["name"]);
});

test("updateMainContract callback ignores forwarded non-whitelisted keys (status etc.)", async (t) => {
    // Direction-of-contract test: if the MCP SDK ever forwards a `status` field
    // through to the callback (e.g. a caller bypasses the inputSchema), the
    // callback's explicit-whitelist construction must NOT include it in the
    // PATCH body. This locks the design choice "status PATCH is not exposed
    // through this tool" against accidental drift.
    const stub = stubFetch(async () => ({ status: 200, body: { id: MC_ID, code: "C", name: "N", status: "draft" } }));
    t.after(() => stub.restore());

    // Call the callback directly with an extra `status` arg — simulating an
    // SDK that bypassed the schema. The callback should silently drop it.
    await updateMainContractTool.callback({
        containerId: CONTAINER,
        mainContractId: MC_ID,
        name: "N",
        status: "executed", // <- must not reach the API
    });

    const body = stub.calls[0].body;
    assert.equal(body.status, undefined, "status field must NOT be forwarded to the API");
    assert.deepEqual(Object.keys(body), ["name"]);
});

// ─── Error path ───────────────────────────────────────────────────────────────

test("updateMainContract surfaces the Cost API error envelope (validation 400)", async (t) => {
    // Use 400 here (not 404) because costApiCall replaces 404 responses with a
    // hardcoded "Cost module not activated" canned message, swallowing the
    // envelope. 400s pass through formatCostApiError as-is.
    const stub = stubFetch(async () => ({
        status: 400,
        body: { errors: [{ code: 45007, title: "ENUM_MISMATCH", detail: "No enum match for: invalidType on type" }] },
    }));
    t.after(() => stub.restore());

    const result = await updateMainContractTool.callback({
        containerId: CONTAINER,
        mainContractId: MC_ID,
        type: "invalidType",
    });

    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /45007/);
    assert.match(result.content[0].text, /ENUM_MISMATCH/);
});
