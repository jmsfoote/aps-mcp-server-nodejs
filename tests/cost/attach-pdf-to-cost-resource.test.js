import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubFetch } from "../setup.mjs";
import { attachPdfToCostResourceTool } from "../../tools/cost/attach-pdf-to-cost-resource.js";

const CONTAINER = "11111111-1111-1111-1111-111111111111";
const EID = "91ab3eb0-5efa-11f1-8a76-c5ce0121f9b7";
const URN = "urn:adsk.objects:os.object:wip.dm.prod/invoice.pdf";

// Phase 0 (2026-06-03) captured fixture — attachment 201 response from Parkside.
const apiAttachment = {
    errorInfo: null,
    id: "9407d1be-6b76-479f-9a08-bc3ff59efa31",
    containerId: CONTAINER,
    urn: URN,
    name: "invoice.pdf",
    type: "Upload",
    associationId: EID,
    associationType: "Expense",
    status: "Complete",
};

// ─── Input schema ─────────────────────────────────────────────────────────────

test("attachPdf requires containerId, associationId, urn, name", () => {
    const { containerId, associationId, urn, name } = attachPdfToCostResourceTool.inputSchema;
    assert.throws(() => containerId.parse(""));
    assert.throws(() => associationId.parse(""));
    assert.throws(() => urn.parse(""));
    assert.throws(() => name.parse(""));
});

test("attachPdf associationType enum is scoped to Expense/ExpenseItem", () => {
    const { associationType } = attachPdfToCostResourceTool.inputSchema;
    assert.equal(associationType.parse("Expense"), "Expense");
    assert.equal(associationType.parse("ExpenseItem"), "ExpenseItem");
    // Case-exact; the endpoint accepts more types but this slice is scoped (M7b broadens).
    assert.throws(() => associationType.parse("expense"));
    assert.throws(() => associationType.parse("Contract"));
});

// ─── Happy path + endpoint regression fence (Phase 0: attachments, NOT documents) ─

test("attachPdf POSTs to /attachments (NOT /documents) with the association body", async (t) => {
    const stub = stubFetch(async () => ({ status: 201, body: apiAttachment }));
    t.after(() => stub.restore());

    const result = await attachPdfToCostResourceTool.callback({
        containerId: CONTAINER,
        associationType: "Expense",
        associationId: EID,
        urn: URN,
        name: "invoice.pdf",
    });

    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    // Phase 0: POST /documents → 405. The write surface is /attachments.
    assert.match(call.url, new RegExp(`/containers/${CONTAINER}/attachments$`));
    assert.doesNotMatch(call.url, /\/documents/);
    assert.deepEqual(call.body, { associationType: "Expense", associationId: EID, urn: URN, name: "invoice.pdf" });

    const s = result.structuredContent.summary;
    assert.equal(s.id, apiAttachment.id);
    assert.equal(s.status, "Complete");
    assert.equal(s.associationType, "Expense");
    assert.match(result.content[0].text, /Attached "invoice.pdf" to Expense/);
});

test("attachPdf works for ExpenseItem targets too", async (t) => {
    const stub = stubFetch(async () => ({ status: 201, body: { ...apiAttachment, associationType: "ExpenseItem", associationId: "item-1" } }));
    t.after(() => stub.restore());

    const result = await attachPdfToCostResourceTool.callback({
        containerId: CONTAINER,
        associationType: "ExpenseItem",
        associationId: "item-1",
        urn: URN,
        name: "invoice.pdf",
    });
    assert.equal(stub.calls[0].body.associationType, "ExpenseItem");
    assert.equal(result.structuredContent.summary.associationType, "ExpenseItem");
});

// ─── Error path (Phase 0: urn missing → 450080) ──────────────────────────────

test("attachPdf surfaces the Cost API error envelope", async (t) => {
    const stub = stubFetch(async () => ({
        status: 400,
        body: { error: { errors: [{ code: 450080, title: "A URN is missing in the attachment." }], name: "ValidationException", statusCode: 400 } },
    }));
    t.after(() => stub.restore());

    const result = await attachPdfToCostResourceTool.callback({
        containerId: CONTAINER,
        associationType: "Expense",
        associationId: EID,
        urn: URN,
        name: "invoice.pdf",
    });
    assert.equal(result.structuredContent.error, true);
    assert.match(result.content[0].text, /450080/);
});
