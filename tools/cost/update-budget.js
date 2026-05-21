import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-21) verification on Parkside Residences sandbox:
//   PATCH /budgets/{id} with a partial body (e.g. { name, description }) returned
//   200 + the full budget object. Field changes outside name/description likely
//   trigger the project's template-lock guards — surface API errors verbatim.
export const updateBudgetTool = {
    title: "Update Budget",
    description:
        "Update an existing budget line item in ACC Cost Management. Sends a partial " +
        "PATCH — only provided fields are changed. Updating the segment `code` after " +
        "budgets exist is generally blocked by the project's template lock; the API " +
        "error is surfaced verbatim if so.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        budgetId: z
            .string()
            .nonempty()
            .describe("Budget id to update (from getBudgetsTool)"),
        name: z.string().optional().describe("New display name"),
        description: z.string().optional().describe("New free-text description"),
        unitPrice: z.string().optional().describe("New unit price as a decimal string"),
        quantity: z.number().optional().describe("New quantity"),
        unit: z.string().optional().describe("New unit of measure"),
        scope: z
            .enum(["budgetAndCost", "budgetOnly", "costOnly"])
            .optional()
            .describe("New budget scope"),
        plannedStartDate: z.string().optional().describe("Planned start (YYYY-MM-DD)"),
        plannedEndDate: z.string().optional().describe("Planned end (YYYY-MM-DD)"),
    },
    callback: async ({ containerId, budgetId, ...rest }) => {
        const body = {};
        for (const [k, v] of Object.entries(rest)) {
            if (v !== undefined) body[k] = v;
        }

        if (Object.keys(body).length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No update fields provided — pass at least one field (name, description, unitPrice, quantity, unit, scope, plannedStartDate, plannedEndDate).",
                    },
                ],
                structuredContent: { error: true, status: 400, message: "no fields" },
            };
        }

        const result = await costApiCall("PATCH", containerId, `budgets/${budgetId}`, {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const updated = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(updated, "id", "budgetId"),
            code: getFirst(updated, "code", "budgetCode"),
            formattedCode: getFirst(updated, "formattedCode", "budgetFormattedCode"),
            name: updated.name,
            description: updated.description,
            unitPrice: numVal(updated.unitPrice),
            quantity: numVal(updated.quantity),
            originalAmount: numVal(getFirst(updated, "originalAmount", "originalBudget")),
        };

        const changedFields = Object.keys(body).join(", ");
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Updated budget ${summary.code ?? "—"} (id ${summary.id}). ` +
                        `Changed: ${changedFields}.\n` +
                        `Current name: ${summary.name ?? "—"} | ` +
                        `original amount: ${summary.originalAmount}`,
                },
            ],
            structuredContent: { budget: updated, summary, changedFields: Object.keys(body) },
        };
    },
};
