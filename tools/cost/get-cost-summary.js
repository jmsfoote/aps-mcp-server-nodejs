import { z } from "zod";
import { costApiFetchAll, getFirst, numVal } from "./cost-helpers.js";

export const getCostSummaryTool = {
    title: "Get Cost Summary",
    description:
        "Get a budget-vs-actual summary for an ACC Cost Management project. " +
        "Fetches budgets and cost items, then computes variance (budget - committed - paid). " +
        "Useful for a quick financial health check. " +
        "Use getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
    },
    callback: async ({ containerId }) => {
        // Fetch budgets and cost items in parallel
        const [budgetResult, costItemResult] = await Promise.all([
            costApiFetchAll(containerId, "budgets"),
            costApiFetchAll(containerId, "cost-items"),
        ]);

        if (budgetResult.error) {
            return {
                content: [{ type: "text", text: `Error fetching budgets: ${budgetResult.message}` }],
                structuredContent: budgetResult,
            };
        }
        if (costItemResult.error) {
            return {
                content: [{ type: "text", text: `Error fetching cost items: ${costItemResult.message}` }],
                structuredContent: costItemResult,
            };
        }

        // Aggregate cost items by budget code
        const costByBudget = {};
        for (const ci of costItemResult.data) {
            const code = getFirst(ci, "budgetCode", "code") || "UNALLOCATED";
            if (!costByBudget[code]) {
                costByBudget[code] = { committed: 0, paid: 0, amount: 0 };
            }
            costByBudget[code].committed += numVal(getFirst(ci, "committed", "committedAmount"));
            costByBudget[code].paid += numVal(getFirst(ci, "paid", "paidAmount"));
            costByBudget[code].amount += numVal(getFirst(ci, "amount", "costAmount", "totalAmount"));
        }

        // Build summary rows by joining budgets with aggregated costs
        const rows = budgetResult.data.map((b) => {
            const code = getFirst(b, "budgetCode", "code") || "—";
            const name = getFirst(b, "name", "title") || "—";
            const originalBudget = numVal(getFirst(b, "originalBudget", "originalBudgetAmount", "originalAmount"));
            const revisedBudget = numVal(getFirst(b, "revisedBudget", "revisedBudgetAmount", "revisedAmount", "currentBudget"));
            const budget = revisedBudget || originalBudget;

            const costs = costByBudget[code] || { committed: 0, paid: 0, amount: 0 };
            const variance = budget - costs.committed - costs.paid;
            const pctSpent = budget > 0 ? ((costs.committed + costs.paid) / budget) * 100 : 0;

            return {
                budgetCode: code,
                name,
                originalBudget,
                revisedBudget,
                committed: costs.committed,
                paid: costs.paid,
                variance,
                pctSpent: Math.round(pctSpent * 10) / 10,
            };
        });

        // Grand totals
        const totals = rows.reduce(
            (t, r) => ({
                originalBudget: t.originalBudget + r.originalBudget,
                revisedBudget: t.revisedBudget + r.revisedBudget,
                committed: t.committed + r.committed,
                paid: t.paid + r.paid,
                variance: t.variance + r.variance,
            }),
            { originalBudget: 0, revisedBudget: 0, committed: 0, paid: 0, variance: 0 }
        );
        const totalBudget = totals.revisedBudget || totals.originalBudget;
        totals.pctSpent = totalBudget > 0 ? Math.round(((totals.committed + totals.paid) / totalBudget) * 1000) / 10 : 0;

        // Format as text table
        const header = "Budget Code | Name | Original | Revised | Committed | Paid | Variance | % Spent";
        const divider = "---|---|---|---|---|---|---|---";
        const tableRows = rows.map(
            (r) =>
                `${r.budgetCode} | ${r.name} | ${fmt(r.originalBudget)} | ${fmt(r.revisedBudget)} | ` +
                `${fmt(r.committed)} | ${fmt(r.paid)} | ${fmt(r.variance)} | ${r.pctSpent}%`
        );
        const totalRow =
            `**TOTAL** | | ${fmt(totals.originalBudget)} | ${fmt(totals.revisedBudget)} | ` +
            `${fmt(totals.committed)} | ${fmt(totals.paid)} | ${fmt(totals.variance)} | ${totals.pctSpent}%`;

        const summary =
            `Budget vs Actual Summary — ${rows.length} budget line(s), ${costItemResult.data.length} cost item(s)\n\n` +
            `${header}\n${divider}\n${tableRows.join("\n")}\n${totalRow}`;

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { rows, totals, budgetCount: rows.length, costItemCount: costItemResult.data.length },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
