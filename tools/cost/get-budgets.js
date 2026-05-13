import { z } from "zod";
import { costApiFetchAll, getFirst, numVal } from "./cost-helpers.js";

export const getBudgetsTool = {
    title: "Get Budgets",
    description:
        "List all budget line items for an ACC Cost Management project. " +
        "Returns budget codes, names, original/revised/forecast amounts, and status. " +
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
        const result = await costApiFetchAll(containerId, "budgets", {}, limit);

        if (result.error) {
            return {
                content: [{ type: "text", text: `Error fetching budgets: ${result.message}` }],
                structuredContent: result,
            };
        }

        const budgets = result.data.map((b) => ({
            id: getFirst(b, "id", "budgetId"),
            budgetCode: getFirst(b, "budgetCode", "code"),
            budgetFormattedCode: getFirst(b, "budgetFormattedCode", "formattedCode"),
            name: getFirst(b, "name", "title"),
            status: getFirst(b, "status", "state"),
            originalBudget: numVal(getFirst(b, "originalBudget", "originalBudgetAmount", "originalAmount")),
            revisedBudget: numVal(getFirst(b, "revisedBudget", "revisedBudgetAmount", "revisedAmount", "currentBudget")),
            forecast: numVal(getFirst(b, "forecast", "forecastAmount", "forecastFinal", "forecastFinalAmount")),
            currency: getFirst(b, "currency", "currencyCode"),
        }));

        const totalOriginal = budgets.reduce((s, b) => s + (b.originalBudget || 0), 0);
        const totalRevised = budgets.reduce((s, b) => s + (b.revisedBudget || 0), 0);
        const totalForecast = budgets.reduce((s, b) => s + (b.forecast || 0), 0);

        const lines = budgets.map(
            (b) =>
                `- ${b.budgetCode || "—"} | ${b.name || "—"} | ` +
                `Original: ${fmt(b.originalBudget)} | Revised: ${fmt(b.revisedBudget)} | ` +
                `Forecast: ${fmt(b.forecast)} | ${b.status || "—"}`
        );

        const summary =
            `${budgets.length} budget line(s) found.\n` +
            `Totals — Original: ${fmt(totalOriginal)}, Revised: ${fmt(totalRevised)}, Forecast: ${fmt(totalForecast)}\n\n` +
            lines.join("\n");

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { budgets, totals: { originalBudget: totalOriginal, revisedBudget: totalRevised, forecast: totalForecast } },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
