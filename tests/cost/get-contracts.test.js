import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { getContractsTool } from "../../tools/cost/get-contracts.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";

test("getContracts surfaces contract code in structured output", async (t) => {
    const apiContracts = [
        {
            id: "con-1",
            code: "CON-001",
            name: "External civils subcontract — XYZ Pty Ltd",
            status: "draft",
            type: "subcontract",
            vendor: "XYZ Pty Ltd",
            amount: "350000.0000",
            committed: "100000.0000",
            currency: "AUD",
        },
        {
            id: "con-2",
            code: "CON-002",
            name: "Electrical PO",
            status: "approved",
            type: "purchaseOrder",
            vendor: "Sparky Co",
            amount: "50000.0000",
            committed: "50000.0000",
            currency: "AUD",
        },
    ];
    const stub = stubFetch(async () => ({ status: 200, body: apiContracts }));
    t.after(() => stub.restore());

    const result = await getContractsTool.callback({ containerId: CONTAINER, limit: 200 });

    // First page returned 2 items < limit 200, so pagination terminates after one fetch.
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].method, "GET");
    assert.match(stub.calls[0].url, new RegExp(`/containers/${CONTAINER}/contracts\\?`));

    // Regression lock: code must surface — this is the gap PR-2's wave handler
    // needs closed to build a code-keyed skip-set for re-run safety.
    assert.equal(result.structuredContent.contracts.length, 2);
    assert.equal(result.structuredContent.contracts[0].code, "CON-001");
    assert.equal(result.structuredContent.contracts[1].code, "CON-002");

    // Previously-mapped fields still surface — the one-line addition didn't disturb the map.
    assert.equal(result.structuredContent.contracts[0].id, "con-1");
    assert.equal(result.structuredContent.contracts[0].name, "External civils subcontract — XYZ Pty Ltd");
    assert.equal(result.structuredContent.contracts[0].status, "draft");
});

test("getContracts code falls back to contractCode alias", async (t) => {
    const stub = stubFetch(async () => ({
        status: 200,
        body: [{ id: "con-9", contractCode: "ALT-009", name: "Alt-keyed contract", status: "draft" }],
    }));
    t.after(() => stub.restore());

    const result = await getContractsTool.callback({ containerId: CONTAINER, limit: 200 });

    assert.equal(result.structuredContent.contracts[0].code, "ALT-009");
});
