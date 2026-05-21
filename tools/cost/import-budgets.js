import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-21) verification on Parkside Residences sandbox:
//   POST /budgets:import accepts {"data": [<budget>, ...]} (NOT a bare array,
//   NOT {"items": [...]}). On the Parkside sandbox the call returned
//   400 — "Contract locked" because budgets already exist and the segment
//   template is locked. That is the PHASE_4_COST_MANAGEMENT_SPEC §3.1
//   template-lock behavior; the error is surfaced verbatim to the caller.
//
// Per the brief: a repeat import appends — it does not upsert.
export const importBudgetsTool = {
    title: "Import Budgets (Bulk)",
    description:
        "Bulk-create budget line items in ACC Cost Management. JSON wire format " +
        "is { data: [<budget>, ...] }. A repeat import APPENDS — it does not " +
        "upsert. If the project's segment template is locked (any prior budget " +
        "exists), the API may reject the import; the error is surfaced verbatim. " +
        "Use this for the initial budget-template population; use createBudgetTool " +
        "for single additions once the template is locked.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        budgets: z
            .array(
                z.object({
                    name: z.string().nonempty(),
                    code: z
                        .string()
                        .min(1)
                        .max(64)
                        .regex(
                            /^[A-Za-z0-9._-]+$/,
                            "code must be alphanumeric with optional . _ - (no spaces or control chars)"
                        ),
                    description: z.string().optional(),
                    unitPrice: z.string().optional(),
                    quantity: z.number().optional(),
                    unit: z.string().optional(),
                    scope: z.enum(["budgetAndCost", "budgetOnly", "costOnly"]).optional(),
                    plannedStartDate: z.string().optional(),
                    plannedEndDate: z.string().optional(),
                })
            )
            .min(1)
            .describe("Budget items to create. Each requires name and code."),
    },
    callback: async ({ containerId, budgets }) => {
        const body = { data: budgets };
        const result = await costApiCall("POST", containerId, "budgets:import", {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data ?? [];
        const MAX_PREVIEW = 20;
        const lines = created.slice(0, MAX_PREVIEW).map((b) => {
            const code = getFirst(b, "code", "budgetCode") ?? "—";
            const fmt = getFirst(b, "formattedCode", "budgetFormattedCode") ?? "—";
            const amt = numVal(getFirst(b, "originalAmount", "originalBudget"));
            return `- ${code} (${fmt}) | ${b.name ?? "—"} | original ${amt}`;
        });
        if (created.length > MAX_PREVIEW) {
            lines.push(`… and ${created.length - MAX_PREVIEW} more`);
        }
        const preview = lines.join("\n") || "(no items in response)";

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Imported ${created.length} budget line(s) ` +
                        `(requested ${budgets.length}):\n${preview}`,
                },
            ],
            structuredContent: {
                requested: budgets.length,
                created: created.length,
                budgets: created,
            },
        };
    },
};
