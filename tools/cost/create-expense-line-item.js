import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-06-03) verification on Parkside Residences sandbox confirmed:
//   Endpoint: POST /cost/v1/containers/:id/expenses/:expenseId/items
//   Body:     a SINGLE flat object — one line item per call. There is NO batch
//             endpoint for expense items:
//               [ {...} ]           → 400 INVALID_TYPE "Expected type object but found type array"
//               { data: [ {...} ] } → 400 OBJECT_MISSING_REQUIRED_PROPERTY (wrapper not recognised)
//               { ... }             → 201
//             (Contrast batchCreateCostItemsTool, which wraps a real
//             cost-items:batch-create endpoint. Expense items have none — the
//             Slice-3 wave handler iterates one POST per item.)
//   Required: `name` only (45007 "Missing required property: name").
//   Amounts:  `amount` is server-computed = quantity × unitPrice (qty 3 ×
//             unitPrice 50 → amount "150.0000"); `unit` defaults to "ea".
//   The line item carries its own `externalId`/`externalSystem` for per-row
//   idempotency, and the parent expense's `amount` aggregates from its items.
export const createExpenseLineItemTool = {
    title: "Create Expense Line Item",
    description:
        "Create a single line item on an expense in ACC Cost Management. One item " +
        "per call — the API has no batch endpoint for expense items (call this " +
        "repeatedly to add several). `name` is required; `amount` is computed by " +
        "the server as quantity × unitPrice. Use getCostContainerTool first to " +
        "resolve the containerId and createExpenseTool to create the parent expense.",
    inputSchema: {
        containerId: z.string().nonempty().describe("Cost container ID"),
        expenseId: z.string().nonempty().describe("Id of the parent expense"),
        name: z.string().nonempty().describe("Line-item name — required"),
        quantity: z.number().optional().describe("Quantity (server computes amount = quantity × unitPrice)"),
        unitPrice: z.number().optional().describe("Unit price (server computes amount = quantity × unitPrice)"),
        unit: z.string().trim().min(1).optional().describe("Unit of measure (defaults to 'ea')"),
        description: z.string().optional().describe("Optional description"),
        note: z.string().optional().describe("Optional internal note"),
        budgetId: z.string().trim().min(1).optional().describe("Optional budget id to map this line item to"),
        contractId: z.string().trim().min(1).optional().describe("Optional contract id to map this line item to"),
        externalId: z.string().trim().min(1).optional().describe("Optional per-row external-system id"),
        externalSystem: z.string().trim().min(1).optional().describe("Optional external-system label"),
    },
    callback: async (args) => {
        const { containerId, expenseId, name } = args;
        const body = { name };
        for (const f of ["quantity", "unitPrice", "unit", "description", "note", "budgetId", "contractId", "externalId", "externalSystem"]) {
            if (args[f] !== undefined) body[f] = args[f];
        }

        const result = await costApiCall("POST", containerId, `expenses/${expenseId}/items`, {}, body);
        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(created, "id", "expenseItemId"),
            number: getFirst(created, "number"),
            name: getFirst(created, "name"),
            quantity: getFirst(created, "quantity"),
            unitPrice: numVal(getFirst(created, "unitPrice")),
            unit: getFirst(created, "unit"),
            amount: numVal(getFirst(created, "amount")),
            budgetId: getFirst(created, "budgetId"),
            contractId: getFirst(created, "contractId"),
            externalId: getFirst(created, "externalId"),
            expenseId: getFirst(created, "expenseId"),
        };
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Created line item ${summary.number ?? "—"} (id ${summary.id}) on expense ${expenseId}\n` +
                        `Name: ${summary.name ?? "—"} | Qty: ${summary.quantity ?? "—"} × ${fmt(summary.unitPrice)} = ${fmt(summary.amount)}`,
                },
            ],
            structuredContent: { expenseItem: created, summary },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
