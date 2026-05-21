import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-21) verification on Parkside Residences sandbox confirmed:
//   - request field is `code` (not `budgetCode`)
//   - `code` length is enforced by the project's segment template
//   - response is the full budget object with id, formattedCode,
//     budgetCode.budgetCodeSegments[], etc.
//   - amount fields (originalAmount) on create derive from unitPrice × quantity;
//     callers should pass unitPrice/quantity to set the amount.
export const createBudgetTool = {
    title: "Create Budget",
    description:
        "Create a single budget line item in an ACC Cost Management project. " +
        "Once any budget exists in a project, the segment-code template locks (read-only) — " +
        "subsequent budgets must use codes that conform to the existing template. " +
        "Use getCostContainerTool first to resolve the containerId, and getBudgetsTool " +
        "to inspect existing codes if you need to learn the template shape.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        name: z
            .string()
            .nonempty()
            .describe("Human-readable budget line name (e.g. 'External civil works')"),
        code: z
            .string()
            .min(1)
            .max(64)
            .regex(
                /^[A-Za-z0-9._-]+$/,
                "code must be alphanumeric with optional . _ - (no spaces or control chars)"
            )
            .describe(
                "Segment-template code (e.g. '000011700'). Total length must match the " +
                "project's segment template — schema accepts up to 64 chars; the API enforces " +
                "the actual template length and returns 'Code length not matched' on mismatch."
            ),
        description: z.string().optional().describe("Optional free-text description"),
        unitPrice: z
            .string()
            .optional()
            .describe(
                "Unit price as a decimal string (e.g. '350000.00'). The originalAmount is " +
                "computed by the API as unitPrice × quantity."
            ),
        quantity: z.number().optional().describe("Quantity (defaults to 1 on the API side)"),
        unit: z.string().optional().describe("Unit of measure (e.g. 'each', 'm2')"),
        scope: z
            .enum(["budgetAndCost", "budgetOnly", "costOnly"])
            .optional()
            .describe("Budget scope; defaults to 'budgetAndCost' on the API side"),
        plannedStartDate: z
            .string()
            .optional()
            .describe("Planned start (YYYY-MM-DD)"),
        plannedEndDate: z
            .string()
            .optional()
            .describe("Planned end (YYYY-MM-DD)"),
    },
    callback: async ({ containerId, name, code, description, unitPrice, quantity, unit, scope, plannedStartDate, plannedEndDate }) => {
        const body = { name, code };
        if (description !== undefined) body.description = description;
        if (unitPrice !== undefined) body.unitPrice = unitPrice;
        if (quantity !== undefined) body.quantity = quantity;
        if (unit !== undefined) body.unit = unit;
        if (scope !== undefined) body.scope = scope;
        if (plannedStartDate !== undefined) body.plannedStartDate = plannedStartDate;
        if (plannedEndDate !== undefined) body.plannedEndDate = plannedEndDate;

        const result = await costApiCall("POST", containerId, "budgets", {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(created, "id", "budgetId"),
            code: getFirst(created, "code", "budgetCode"),
            formattedCode: getFirst(created, "formattedCode", "budgetFormattedCode"),
            name: created.name,
            scope: created.scope,
            originalAmount: numVal(getFirst(created, "originalAmount", "originalBudget")),
            unitPrice: numVal(created.unitPrice),
            quantity: numVal(created.quantity),
        };

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Created budget ${summary.code ?? "—"} ` +
                        `(${summary.formattedCode ?? "—"}): ${summary.name ?? "—"}\n` +
                        `Id: ${summary.id}\n` +
                        `Original amount: ${summary.originalAmount} ` +
                        `(unitPrice ${summary.unitPrice} × qty ${summary.quantity})`,
                },
            ],
            structuredContent: { budget: created, summary },
        };
    },
};
