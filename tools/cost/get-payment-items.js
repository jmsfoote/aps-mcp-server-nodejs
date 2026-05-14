import { z } from "zod";
import { costApiFetchAll, getFirst, numVal } from "./cost-helpers.js";

export const getPaymentItemsTool = {
    title: "Get Payment Items",
    description:
        "List individual line items within a payment in ACC Cost Management. " +
        "REQUIRES at least one filter: paymentId, associationId, or associationType. " +
        "The API returns 400 if no filters are provided. " +
        "Use getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        paymentId: z
            .string()
            .optional()
            .describe("Filter by payment ID (comma-separated for multiple)"),
        associationId: z
            .string()
            .optional()
            .describe("Filter by association ID (comma-separated for multiple)"),
        associationType: z
            .string()
            .optional()
            .describe("Filter by association type (comma-separated for multiple)"),
        limit: z
            .number()
            .optional()
            .default(200)
            .describe("Items per page (max 200)"),
    },
    callback: async ({ containerId, paymentId, associationId, associationType, limit }) => {
        // Validate: at least one filter required
        if (!paymentId && !associationId && !associationType) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            "Error: At least one filter is required for payment items.\n" +
                            "Provide one or more of: paymentId, associationId, associationType.\n" +
                            "Use getPaymentsTool first to find payment IDs.",
                    },
                ],
                structuredContent: { error: true, message: "Missing required filter" },
            };
        }

        // Build filter query params
        const queryParams = {};
        if (paymentId) queryParams["filter[paymentId]"] = paymentId;
        if (associationId) queryParams["filter[associationId]"] = associationId;
        if (associationType) queryParams["filter[associationType]"] = associationType;

        const result = await costApiFetchAll(containerId, "payment-items", queryParams, limit);

        if (result.error) {
            return {
                content: [{ type: "text", text: `Error fetching payment items: ${result.message}` }],
                structuredContent: result,
            };
        }

        const items = result.data.map((pi) => ({
            id: getFirst(pi, "id", "paymentItemId"),
            paymentId: getFirst(pi, "paymentId", "payment_id"),
            budgetId: getFirst(pi, "budgetId", "budget_id"),
            costItemId: getFirst(pi, "costItemId", "cost_item_id"),
            description: getFirst(pi, "description", "title", "name"),
            status: getFirst(pi, "status", "state"),
            amount: numVal(getFirst(pi, "amount", "totalAmount", "itemAmount")),
            paid: numVal(getFirst(pi, "paid", "paidAmount", "amountPaid")),
            currency: getFirst(pi, "currency", "currencyCode"),
            date: getFirst(pi, "date", "paymentDate", "paidAt", "createdAt"),
        }));

        const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
        const totalPaid = items.reduce((s, i) => s + (i.paid || 0), 0);

        const lines = items.map(
            (i) =>
                `- ${i.description || "—"} | ` +
                `Amount: ${fmt(i.amount)} | Paid: ${fmt(i.paid)} | ${i.status || "—"}`
        );

        const summary =
            `${items.length} payment item(s) found.\n` +
            `Totals — Amount: ${fmt(totalAmount)}, Paid: ${fmt(totalPaid)}\n\n` +
            lines.join("\n");

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { paymentItems: items, totals: { amount: totalAmount, paid: totalPaid } },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
