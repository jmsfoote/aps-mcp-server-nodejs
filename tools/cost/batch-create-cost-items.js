import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-26) verification on Parkside Residences sandbox confirmed:
//   Endpoint: POST /cost/v1/containers/:id/cost-items:batch-create
//   Body:     { data: [ {name, code, ...}, ... ] }
//   Per-item required fields: `name` (required), `code` (required).
//   Response: BARE ARRAY of full cost-item objects (no wrapper).
//
//   The 2026-05-25 inventory cited a "≤100 hard limit" for this endpoint —
//   that claim is FALSE. Phase 0 sent a 101-item batch and the API responded
//   201 Created with all 101 items. No client-side `.max(...)` cap is
//   enforced here. Callers are advised to keep batches reasonable for
//   network/latency reasons; the tool description says so.
//
//   Each created cost item starts with:
//     budgetStatus="draft", costStatus="draft", scope="out",
//     budgetId=null, contractId=null, all amounts=null (zero value until
//     attached to a change order or directly to a contract).
export const batchCreateCostItemsTool = {
    title: "Batch-Create Cost Items",
    description:
        "Bulk-create cost items in ACC Cost Management. Each item requires " +
        "`name` and `code`; other fields are optional. Returns the array of " +
        "created items with their assigned ids and auto-generated numbers. " +
        "Cost items start with zero monetary value — attach them to a change " +
        "order via attachCostItemsTool to feed into a change-order envelope. " +
        "The API does not document an upper batch-size limit; Phase 0 " +
        "confirmed 101-item batches succeed. Keep batches reasonable for " +
        "network/latency reasons.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        items: z
            .array(
                z.object({
                    name: z.string().nonempty().describe("Cost item name (required)"),
                    code: z.string().nonempty().describe("Cost item code (required)"),
                    description: z.string().optional().describe("Optional description"),
                    scopeOfWork: z.string().optional().describe("Optional scope-of-work text"),
                    note: z.string().optional().describe("Optional internal note"),
                    contractId: z.string().optional().describe("Optional contract id to associate this cost item with"),
                    budgetId: z.string().optional().describe("Optional budget id to associate this cost item with"),
                })
            )
            .min(1)
            .describe(
                "Array of cost-item objects to create. At least one item " +
                "required. No upper bound enforced client-side."
            ),
    },
    callback: async ({ containerId, items }) => {
        // API expects { data: [...] } as the request wrapper.
        const body = { data: items };

        const result = await costApiCall("POST", containerId, "cost-items:batch-create", {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        // Response is a bare array of full cost-item objects — extractItems
        // returns it as-is in result.data.
        const created = result.data ?? [];
        const summaries = created.map((ci) => ({
            id: getFirst(ci, "id", "costItemId"),
            number: getFirst(ci, "number"),
            code: getFirst(ci, "code"),
            name: ci.name,
            budgetStatus: getFirst(ci, "budgetStatus"),
            costStatus: getFirst(ci, "costStatus"),
            contractId: getFirst(ci, "contractId"),
            budgetId: getFirst(ci, "budgetId"),
            amount: numVal(getFirst(ci, "amount", "totalAmount")),
        }));

        const text =
            `Created ${created.length} cost item(s).\n` +
            summaries
                .map(
                    (s) =>
                        `- ${s.number ?? "—"} | ${s.code ?? "—"} | ${s.name ?? "—"} | ` +
                        `budget=${s.budgetStatus ?? "—"} | cost=${s.costStatus ?? "—"}`
                )
                .join("\n");

        return {
            content: [{ type: "text", text }],
            structuredContent: { costItems: created, summaries, count: created.length },
        };
    },
};
