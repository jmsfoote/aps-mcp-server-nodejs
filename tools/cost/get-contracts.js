import { z } from "zod";
import { costApiFetchAll, getFirst, numVal } from "./cost-helpers.js";

export const getContractsTool = {
    title: "Get Contracts",
    description:
        "List contracts (subcontracts, purchase orders) in ACC Cost Management. " +
        "Returns contract numbers, names, vendors, amounts, and status. " +
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
        const result = await costApiFetchAll(containerId, "contracts", {}, limit);

        if (result.error) {
            return {
                content: [{ type: "text", text: `Error fetching contracts: ${result.message}` }],
                structuredContent: result,
            };
        }

        const contracts = result.data.map((c) => ({
            id: getFirst(c, "id", "contractId"),
            name: getFirst(c, "name", "title"),
            number: getFirst(c, "number", "contractNumber"),
            status: getFirst(c, "status", "state"),
            type: getFirst(c, "type", "contractType"),
            vendor: getFirst(c, "vendor", "vendorName", "supplier"),
            amount: numVal(getFirst(c, "amount", "contractAmount", "totalAmount")),
            committed: numVal(getFirst(c, "committed", "committedAmount")),
            approved: numVal(getFirst(c, "approved", "approvedAmount")),
            currency: getFirst(c, "currency", "currencyCode"),
            awardedAt: c.awardedAt,
            executedAt: c.executedAt,
        }));

        const totalAmount = contracts.reduce((s, c) => s + (c.amount || 0), 0);
        const totalCommitted = contracts.reduce((s, c) => s + (c.committed || 0), 0);

        const lines = contracts.map(
            (c) =>
                `- ${c.number || "—"} | ${c.name || "—"} | ` +
                `Vendor: ${c.vendor || "—"} | Type: ${c.type || "—"} | ` +
                `Amount: ${fmt(c.amount)} | Committed: ${fmt(c.committed)} | ${c.status || "—"}`
        );

        const summary =
            `${contracts.length} contract(s) found.\n` +
            `Totals — Amount: ${fmt(totalAmount)}, Committed: ${fmt(totalCommitted)}\n\n` +
            lines.join("\n");

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { contracts, totals: { amount: totalAmount, committed: totalCommitted } },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
