import { z } from "zod";
import { costApiCall, formatCostApiError } from "./cost-helpers.js";

// Phase 0 (2026-05-26) verification on Parkside Residences sandbox confirmed:
//   Endpoint: POST /cost/v1/containers/:id/cost-items:attach
//   Body:     BARE TOP-LEVEL ARRAY — NOT a wrapped object.
//             [ { changeOrderId, costItemId }, ... ]
//
//   Other shape probes that all returned 400 "Expected type array but found
//   type object" or similar:
//     - { attach: [...] }
//     - { changeOrderId, costItemIds: [...] }
//     - { data: [{ changeOrderId, costItemIds }] }
//     - bare array of just costItem ids
//     - bare array of { associationType, associationId, costItemId }
//     - bare array of { id (costItemId), changeOrderId }
//   Only the bare-array-of-{changeOrderId, costItemId}-pairs shape works.
//
//   Response: BARE ARRAY ECHO of the input pairs (no transformation).
//   The cost items' associations update on the server side; the cost-item
//   record now has `changeOrderId` set, and the change-order's monetary
//   value aggregates from attached cost items.
//
//   NOTE: there is a parallel mechanism — PATCH /cost-items/:id with body
//   `{changeOrderId}` ALSO works (Phase 0 captured 200). This dedicated
//   :attach endpoint with bare-array shape is preferred because it
//   communicates intent and handles multiple pairs in a single call.
export const attachCostItemsTool = {
    title: "Attach Cost Items to Change Order",
    description:
        "Attach one or more cost items to change orders. Each input pair " +
        "links one cost item to one change order. Multiple pairs can target " +
        "the same change order or different change orders in a single call. " +
        "Attaching is what gives a change order its monetary value — an " +
        "empty change order has zero value. The cost item's associations " +
        "are updated on the server; the change order's envelope amount " +
        "aggregates from attached cost items.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        pairs: z
            .array(
                z.object({
                    changeOrderId: z
                        .string()
                        .nonempty()
                        .describe("Change order id to attach to"),
                    costItemId: z
                        .string()
                        .nonempty()
                        .describe("Cost item id to attach"),
                })
            )
            .min(1)
            .describe(
                "Array of {changeOrderId, costItemId} pairs. At least one " +
                "pair required. The same changeOrderId may appear in " +
                "multiple pairs to attach several cost items to it."
            ),
    },
    callback: async ({ containerId, pairs }) => {
        // Body is a BARE ARRAY — JSON.stringify serialises it correctly.
        // The cost-helpers `costApiCall` passes body through as-is.
        const body = pairs;

        const result = await costApiCall("POST", containerId, "cost-items:attach", {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        // Response is a bare-array echo of the input pairs — extractItems
        // returns it as-is in result.data.
        const echoed = result.data ?? [];

        const text =
            `Attached ${pairs.length} cost-item↔change-order pair(s).\n` +
            pairs
                .map((p) => `- changeOrder ${p.changeOrderId} ← costItem ${p.costItemId}`)
                .join("\n") +
            `\nRe-read the change order via getChangeOrdersTool to see its updated envelope amount.`;

        return {
            content: [{ type: "text", text }],
            structuredContent: { attached: echoed, count: pairs.length, pairs },
        };
    },
};
