import { z } from "zod";
import { costApiFetchAll, getFirst, numVal } from "./cost-helpers.js";

export const getChangeOrdersTool = {
    title: "Get Change Orders",
    description:
        "List change orders (PCO, SCO, RCO, OCO) in ACC Cost Management. " +
        "Returns change order numbers, names, types, amounts, status, and budget references. " +
        "PCOs (Potential Change Orders) represent costs being considered but not yet approved. " +
        "Use getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        type: z
            .string()
            .optional()
            .describe("Change order type filter: PCO, SCO, RCO, OCO, or omit for all types"),
        limit: z
            .number()
            .optional()
            .default(200)
            .describe("Items per page (max 200)"),
    },
    callback: async ({ containerId, type, limit }) => {
        // The Cost API requires lowercase type segments in the URL path
        // (/change-orders/oco, not /change-orders/OCO — uppercase returns 400
        // ENUM_MISMATCH). Trim before lowercasing so incidental whitespace
        // ("  OCO ") doesn't produce a malformed path; whitespace-only inputs
        // collapse to "" (falsy) and fall through to the bare endpoint.
        const normalizedType = type ? type.trim().toLowerCase() : null;
        const endpoint = normalizedType ? `change-orders/${normalizedType}` : "change-orders";
        const result = await costApiFetchAll(containerId, endpoint, {}, limit);

        if (result.error) {
            return {
                content: [{ type: "text", text: `Error fetching change orders: ${result.message}` }],
                structuredContent: result,
            };
        }

        const changeOrders = result.data.map((co) => ({
            id: getFirst(co, "id", "changeOrderId"),
            name: getFirst(co, "name", "title"),
            number: getFirst(co, "number", "changeOrderNumber"),
            // The API surfaces two parallel status streams (budgetStatus and
            // costStatus); it does not surface `status` or `state`. The prior
            // `status: getFirst(co, "status", "state")` always resolved to
            // undefined.
            budgetStatus: getFirst(co, "budgetStatus"),
            costStatus: getFirst(co, "costStatus"),
            // `type` is the human label ("Owner Change Order");
            // `formDefinitionType` is the lowercase machine enum ("oco") that
            // re-run skip-maps key on. Surface both.
            type: getFirst(co, "type", "changeOrderType"),
            formDefinitionType: getFirst(co, "formDefinitionType"),
            scope: getFirst(co, "scope", "scopeOfWork"),
            description: getFirst(co, "description", "notes"),
            amount: numVal(getFirst(co, "amount", "totalAmount", "changeOrderAmount")),
            budgetId: getFirst(co, "budgetId", "budget_id"),
            budgetCode: getFirst(co, "budgetCode", "budget_code"),
            contractId: getFirst(co, "contractId", "contract_id"),
            createdAt: getFirst(co, "createdAt", "created_at"),
        }));

        const totalAmount = changeOrders.reduce((s, co) => s + (co.amount || 0), 0);

        const lines = changeOrders.map(
            (co) =>
                `- ${co.number || "—"} | ${co.name || "—"} | ` +
                `Type: ${co.type || "—"} (${co.formDefinitionType || "—"}) | ` +
                `Budget Status: ${co.budgetStatus || "—"} | ` +
                `Cost Status: ${co.costStatus || "—"} | ` +
                `Amount: ${fmt(co.amount)} | Budget: ${co.budgetCode || "—"}`
        );

        const summary =
            `${changeOrders.length} change order(s) found.\n` +
            `Totals — Amount: ${fmt(totalAmount)}\n\n` +
            lines.join("\n");

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { changeOrders, totals: { amount: totalAmount } },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
