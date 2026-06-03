import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst } from "./cost-helpers.js";

// Phase 0 (2026-06-03) verification on Parkside Residences sandbox confirmed:
//   Endpoint: PATCH /cost/v1/containers/:id/expenses/:expenseId
//   Partial update: only supplied fields change; returns the full updated object.
//   `externalId` is correctable via PATCH (idempotency-key repair path).
//   ANTI-SCOPE: `status` is deliberately NOT exposed. The write path rejects
//   status values (PATCH {status:"inReview"} → 400 "No enum match for: inReview
//   on status"; same for "submitted"). Expense lifecycle transitions
//   (draft→inReview→approved→paid) are operator-surface-only — the Slice-2
//   transitionChangeOrder lesson repeating. The wave handler must not drive
//   expense state through this tool, and there is no expense transition tool
//   (deferred to M7b, consistent with the slice anti-scope).
export const updateExpenseTool = {
    title: "Update Expense",
    description:
        "Update an existing expense in ACC Cost Management (partial update — only " +
        "the fields you pass change). Useful for correcting the supplier, " +
        "reference number, or the externalId idempotency key. Status / lifecycle " +
        "transitions are NOT available via the API and are intentionally not " +
        "exposed here. Use getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z.string().nonempty().describe("Cost container ID"),
        expenseId: z.string().nonempty().describe("Id of the expense to update"),
        name: z.string().trim().min(1).optional().describe("New expense name"),
        supplierId: z.string().trim().min(1).optional().describe("New supplier company id (not FK-validated)"),
        supplierName: z.string().trim().min(1).optional().describe("New free-text supplier name"),
        description: z.string().optional().describe("New description"),
        note: z.string().optional().describe("New internal note"),
        number: z.string().trim().min(1).optional().describe("New human expense number"),
        referenceNumber: z.string().trim().min(1).optional().describe("New supplier/PO reference number"),
        externalId: z.string().trim().min(1).optional().describe("New external-system id (idempotency key)"),
        externalSystem: z.string().trim().min(1).optional().describe("New external-system label"),
        mainContractId: z.string().trim().min(1).optional().describe("New main-contract association"),
    },
    callback: async (args) => {
        const { containerId, expenseId } = args;
        const body = {};
        for (const f of ["name", "supplierId", "supplierName", "description", "note", "number", "referenceNumber", "externalId", "externalSystem", "mainContractId"]) {
            if (args[f] !== undefined) body[f] = args[f];
        }
        if (Object.keys(body).length === 0) {
            const message = "updateExpense requires at least one field to change.";
            return {
                content: [{ type: "text", text: message }],
                structuredContent: { error: true, status: 400, message },
            };
        }

        const result = await costApiCall("PATCH", containerId, `expenses/${expenseId}`, {}, body);
        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const updated = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(updated, "id", "expenseId"),
            number: getFirst(updated, "number"),
            name: getFirst(updated, "name"),
            status: getFirst(updated, "status"),
            supplierName: getFirst(updated, "supplierName"),
            externalId: getFirst(updated, "externalId"),
            referenceNumber: getFirst(updated, "referenceNumber"),
            updatedAt: getFirst(updated, "updatedAt"),
        };
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Updated expense ${summary.number ?? "—"} (id ${summary.id})\n` +
                        `Changed: ${Object.keys(body).join(", ")}\n` +
                        `Status: ${summary.status ?? "—"} | externalId: ${summary.externalId ?? "—"}`,
                },
            ],
            structuredContent: { expense: updated, summary, changed: Object.keys(body) },
        };
    },
};
