import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-06-03) verification on Parkside Residences sandbox confirmed:
//   Endpoint: PATCH /cost/v1/containers/:id/expenses/:expenseId/items/:itemId
//   Partial update; `amount` is re-computed server-side from quantity × unitPrice
//   (PATCH {quantity:4, unitPrice:25} → amount "100.0000"). Returns the full item.
//   Pairs with createExpenseLineItemTool for the re-run correction path (the API
//   has no batch endpoint — items are created and corrected one at a time).
export const updateExpenseLineItemTool = {
    title: "Update Expense Line Item",
    description:
        "Update a single expense line item in ACC Cost Management (partial update " +
        "— only the fields you pass change). `amount` is recomputed by the server " +
        "from quantity × unitPrice. Use getCostContainerTool first to resolve the " +
        "containerId.",
    inputSchema: {
        containerId: z.string().nonempty().describe("Cost container ID"),
        expenseId: z.string().nonempty().describe("Id of the parent expense"),
        itemId: z.string().nonempty().describe("Id of the line item to update"),
        name: z.string().trim().min(1).optional().describe("New line-item name"),
        quantity: z.number().optional().describe("New quantity"),
        unitPrice: z.number().optional().describe("New unit price"),
        unit: z.string().trim().min(1).optional().describe("New unit of measure"),
        description: z.string().optional().describe("New description"),
        note: z.string().optional().describe("New internal note"),
        budgetId: z.string().trim().min(1).optional().describe("New budget mapping"),
        contractId: z.string().trim().min(1).optional().describe("New contract mapping"),
        externalId: z.string().trim().min(1).optional().describe("New per-row external-system id"),
        externalSystem: z.string().trim().min(1).optional().describe("New external-system label"),
    },
    callback: async (args) => {
        const { containerId, expenseId, itemId } = args;
        const body = {};
        for (const f of ["name", "quantity", "unitPrice", "unit", "description", "note", "budgetId", "contractId", "externalId", "externalSystem"]) {
            if (args[f] !== undefined) body[f] = args[f];
        }
        if (Object.keys(body).length === 0) {
            const message = "updateExpenseLineItem requires at least one field to change.";
            return {
                content: [{ type: "text", text: message }],
                structuredContent: { error: true, status: 400, message },
            };
        }

        const result = await costApiCall("PATCH", containerId, `expenses/${expenseId}/items/${itemId}`, {}, body);
        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const updated = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(updated, "id", "expenseItemId"),
            number: getFirst(updated, "number"),
            name: getFirst(updated, "name"),
            quantity: getFirst(updated, "quantity"),
            unitPrice: numVal(getFirst(updated, "unitPrice")),
            amount: numVal(getFirst(updated, "amount")),
            externalId: getFirst(updated, "externalId"),
        };
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Updated line item ${summary.number ?? "—"} (id ${summary.id})\n` +
                        `Changed: ${Object.keys(body).join(", ")} | amount now ${fmt(summary.amount)}`,
                },
            ],
            structuredContent: { expenseItem: updated, summary, changed: Object.keys(body) },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
