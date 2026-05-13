import { z } from "zod";
import { costApiFetchAll, getFirst, numVal } from "./cost-helpers.js";

export const getCostItemsTool = {
    title: "Get Cost Items",
    description:
        "List cost items (actual costs and commitments) for an ACC Cost Management project. " +
        "Returns cost item numbers, titles, vendors, amounts, committed and paid values. " +
        "Use getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        limit: z
            .number()
            .optional()
            .default(200)
            .describe("Items per page (max 200)"),
    },
    callback: async ({ containerId, limit }) => {
        const result = await costApiFetchAll(containerId, "cost-items", {}, limit);

        if (result.error) {
            return {
                content: [{ type: "text", text: `Error fetching cost items: ${result.message}` }],
                structuredContent: result,
            };
        }

        const items = result.data.map((c) => ({
            id: getFirst(c, "id", "costItemId"),
            number: getFirst(c, "number", "costItemNumber"),
            title: getFirst(c, "title", "name"),
            status: getFirst(c, "status", "state"),
            vendor: getFirst(c, "vendor", "vendorName", "supplier"),
            budgetCode: getFirst(c, "budgetCode", "code"),
            amount: numVal(getFirst(c, "amount", "costAmount", "totalAmount")),
            committed: numVal(getFirst(c, "committed", "committedAmount")),
            paid: numVal(getFirst(c, "paid", "paidAmount")),
        }));

        const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
        const totalCommitted = items.reduce((s, i) => s + (i.committed || 0), 0);
        const totalPaid = items.reduce((s, i) => s + (i.paid || 0), 0);

        const lines = items.map(
            (i) =>
                `- ${i.number || "—"} | ${i.title || "—"} | ` +
                `Vendor: ${i.vendor || "—"} | Amount: ${fmt(i.amount)} | ` +
                `Committed: ${fmt(i.committed)} | Paid: ${fmt(i.paid)} | ${i.status || "—"}`
        );

        const summary =
            `${items.length} cost item(s) found.\n` +
            `Totals — Amount: ${fmt(totalAmount)}, Committed: ${fmt(totalCommitted)}, Paid: ${fmt(totalPaid)}\n\n` +
            lines.join("\n");

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { costItems: items, totals: { amount: totalAmount, committed: totalCommitted, paid: totalPaid } },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
