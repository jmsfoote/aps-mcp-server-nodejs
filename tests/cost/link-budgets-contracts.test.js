import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import {
    linkBudgetsContractsTool,
    splitCreateByBudgetId,
} from "../../tools/cost/link-budgets-contracts.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const C1 = "ccccccc1-cccc-cccc-cccc-cccccccccccc";
const C2 = "ccccccc2-cccc-cccc-cccc-cccccccccccc";
const B1 = "bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const B2 = "bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// ─── splitCreateByBudgetId — pure unit ────────────────────────────────────────

test("splitCreateByBudgetId keeps a single group when budgetIds are unique", () => {
    const groups = splitCreateByBudgetId([
        { contractId: C1, budgetId: B1 },
        { contractId: C2, budgetId: B2 },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 2);
});

test("splitCreateByBudgetId places duplicate-budgetId entries into separate groups", () => {
    const groups = splitCreateByBudgetId([
        { contractId: C1, budgetId: B1 },
        { contractId: C2, budgetId: B1 }, // duplicate budgetId — must split
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].length, 1);
    assert.equal(groups[1].length, 1);
    assert.equal(groups[0][0].budgetId, B1);
    assert.equal(groups[1][0].budgetId, B1);
});

test("splitCreateByBudgetId packs unique entries alongside split duplicates", () => {
    const groups = splitCreateByBudgetId([
        { contractId: C1, budgetId: B1 },
        { contractId: C2, budgetId: B1 }, // dup
        { contractId: C1, budgetId: B2 }, // unique — fits in first group
    ]);
    assert.equal(groups.length, 2);
    // first-fit: B2 (unique) lands in group 0 alongside the first B1 entry
    assert.equal(groups[0].length, 2);
    assert.equal(groups[1].length, 1);
});

// ─── Input schema ─────────────────────────────────────────────────────────────

test("linkBudgetsContracts input schema rejects missing containerId", () => {
    const { containerId } = linkBudgetsContractsTool.inputSchema;
    assert.throws(() => containerId.parse(""), /String must contain at least 1/);
});

test("linkBudgetsContracts input schema validates pair shape", () => {
    const { create } = linkBudgetsContractsTool.inputSchema;
    assert.doesNotThrow(() => create.parse([{ contractId: C1, budgetId: B1 }]));
    assert.throws(() => create.parse([{ contractId: "", budgetId: B1 }]));
    assert.throws(() => create.parse([{ contractId: C1 }])); // missing budgetId
});

// ─── No-ops guard ─────────────────────────────────────────────────────────────

test("linkBudgetsContracts refuses no-ops (no create, no remove) client-side", async (t) => {
    const stub = stubFetch(async () => {
        throw new Error("should not hit network");
    });
    t.after(() => stub.restore());

    const result = await linkBudgetsContractsTool.callback({ containerId: CONTAINER });

    assert.equal(stub.calls.length, 0);
    assert.equal(result.structuredContent.error, true);
    assert.equal(result.structuredContent.status, 400);
    assert.match(result.content[0].text, /No link operations/);
});

// ─── Happy path: create-only, single group ────────────────────────────────────

test("linkBudgetsContracts issues one POST for a create-only call with unique budgetIds", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: "" }));
    t.after(() => stub.restore());

    const result = await linkBudgetsContractsTool.callback({
        containerId: CONTAINER,
        create: [
            { contractId: C1, budgetId: B1 },
            { contractId: C2, budgetId: B2 },
        ],
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/budgets-contracts:link$`));
    assert.equal(call.body.create.length, 2);
    assert.equal(call.body.remove, undefined);

    assert.equal(result.structuredContent.totals.callsIssued, 1);
    assert.equal(result.structuredContent.totals.pairsLinked, 2);
    assert.equal(result.structuredContent.totals.callsFailed, 0);
});

// ─── Happy path: remove-only ──────────────────────────────────────────────────

test("linkBudgetsContracts issues one POST for a remove-only call (pair objects)", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: "" }));
    t.after(() => stub.restore());

    const result = await linkBudgetsContractsTool.callback({
        containerId: CONTAINER,
        remove: [{ contractId: C1, budgetId: B1 }],
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.body.remove.length, 1);
    assert.equal(call.body.remove[0].contractId, C1);
    assert.equal(call.body.remove[0].budgetId, B1);
    assert.equal(call.body.create, undefined);

    assert.equal(result.structuredContent.totals.pairsUnlinked, 1);
});

// ─── Auto-split: duplicate budgetIds in `create` ──────────────────────────────

test("linkBudgetsContracts auto-splits create when budgetIds repeat (spec §3.2 limit)", async (t) => {
    const stub = stubFetch(async () => ({ status: 200, body: "" }));
    t.after(() => stub.restore());

    const result = await linkBudgetsContractsTool.callback({
        containerId: CONTAINER,
        create: [
            { contractId: C1, budgetId: B1 },
            { contractId: C2, budgetId: B1 }, // duplicate budgetId — must trigger split
        ],
    });

    // Two sequential calls, each with create-array length 1 (single B1 entry each).
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0].body.create.length, 1);
    assert.equal(stub.calls[1].body.create.length, 1);
    assert.equal(stub.calls[0].body.create[0].budgetId, B1);
    assert.equal(stub.calls[1].body.create[0].budgetId, B1);

    assert.equal(result.structuredContent.totals.callsIssued, 2);
    assert.equal(result.structuredContent.totals.pairsLinked, 2);
});

// ─── Partial failure visibility ───────────────────────────────────────────────

test("linkBudgetsContracts surfaces per-call partial failures (e.g. already-linked, code 450030)", async (t) => {
    let callIndex = 0;
    const stub = stubFetch(async () => {
        const i = callIndex++;
        if (i === 1) {
            return {
                status: 400,
                body: {
                    error: {
                        errors: [
                            {
                                code: 450030,
                                title: "The same budget is only allowed to be linked to one contract in mode of multiple budgets to one contract.",
                                detail: { alreadyLinkedBudgets: [{ budgetId: B1, contractId: "other-contract" }] },
                            },
                        ],
                        name: "ValidationException",
                        statusCode: 400,
                    },
                },
            };
        }
        return { status: 200, body: "" };
    });
    t.after(() => stub.restore());

    const result = await linkBudgetsContractsTool.callback({
        containerId: CONTAINER,
        create: [
            { contractId: C1, budgetId: B1 },
            { contractId: C2, budgetId: B1 }, // splits into a second call; second call fails 450030
        ],
    });

    assert.equal(stub.calls.length, 2);
    assert.equal(result.structuredContent.totals.callsIssued, 2);
    assert.equal(result.structuredContent.totals.pairsLinked, 1); // only the first call succeeded
    assert.equal(result.structuredContent.totals.callsFailed, 1);
    assert.match(result.content[0].text, /450030/);
    assert.match(result.content[0].text, /Failures:/);
});
