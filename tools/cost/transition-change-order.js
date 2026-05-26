import { z } from "zod";
import { costApiCall, formatCostApiError } from "./cost-helpers.js";

// Phase 0 (2026-05-26) verification on Parkside Residences sandbox confirmed:
//   Endpoint: POST /cost/v1/containers/:id/workflows/actions
//   Body: bare top-level array of action objects.
//   Each action object: { action, associationId, associationType, options }
//
//   ENUM-CASE GOTCHA: associationType MUST be UPPERCASE ("OCO", "SCO", ...).
//   This is the OPPOSITE of the change-order path which is lowercase
//   (`change-orders/oco`). Passing lowercase here returns
//   ENUM_MISMATCH: "No enum match for: oco on 0.associationType".
//
//   The set of valid `action` values for a given change order in its current
//   state can be discovered via GET /workflows/:UPPERCASE_TYPE/:id/actions
//   (not surfaced as a tool in this PR — anti-scope; candidate for follow-up).
//
//   Example transition observed on a fresh OCO (budgetStatus=draft):
//     - action "submit"  → budgetStatus="submitted"
//     - action "open"    → budgetStatus="open"
//
// NOTE: This tool ships but is NOT called by the cost_change_orders wave
// handler (Slice 2 PR-2). Operators retain explicit control over status
// transitions because they trigger downstream effects (notifications,
// budget locks). The tool exists for operator use, not handler use.
export const transitionChangeOrderTool = {
    title: "Transition Change Order",
    description:
        "Execute a workflow action (status transition) on a change order in " +
        "ACC Cost Management. The action set depends on the change order's " +
        "current state — common actions on an OCO include 'submit', 'open', " +
        "and 'execute'. The tool issues a single action against a single " +
        "change order; bulk transitions are not in scope. NOT called by the " +
        "cost wave handler — this is an operator surface only, because " +
        "transitions have downstream side-effects (notifications, budget locks).",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        changeOrderId: z
            .string()
            .nonempty()
            .describe("Change order id (from getChangeOrdersTool or createChangeOrderTool's response)"),
        changeOrderType: z
            .enum(["OCO", "SCO"])
            .describe(
                "Change-order type — used as `associationType` in the action body. " +
                "Must be UPPERCASE per the API enum. (Other types accepted by the API " +
                "but deferred to M7b: PCO, RFQ, COR.)"
            ),
        action: z
            .string()
            .nonempty()
            .describe(
                "Action name to execute (e.g. 'submit', 'open', 'execute'). " +
                "The valid set depends on current state; an invalid action " +
                "returns ENUM_MISMATCH which this tool surfaces verbatim."
            ),
        options: z
            .record(z.any())
            .optional()
            .describe(
                "Optional action-specific options object (Phase 0 captured no " +
                "required options for 'submit'/'open' on an OCO; default {})."
            ),
    },
    callback: async ({ containerId, changeOrderId, changeOrderType, action, options }) => {
        // Body is a BARE ARRAY — not wrapped in {data: [...]}.
        // costApiCall passes the body through JSON.stringify as-is, which
        // serialises an array correctly.
        const body = [
            {
                action,
                associationId: changeOrderId,
                associationType: changeOrderType, // already UPPERCASE per Zod enum
                options: options ?? {},
            },
        ];

        const result = await costApiCall("POST", containerId, "workflows/actions", {}, body);

        if (result.error) {
            // Surface invalid-transition errors as-is. The wave-handler (PR-2)
            // would want to flag these as `change_order_invalid_transition`
            // but the wave handler doesn't call this tool, so the tagging
            // happens (if ever) in the caller's context.
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        // Response is a bare array — echo of the action(s) applied.
        // extractItems in cost-helpers returns it as-is in result.data.
        const applied = result.data?.[0] ?? {};
        const summary = {
            changeOrderId,
            changeOrderType,
            action,
            applied: result.data?.length ?? 0,
        };

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Action "${action}" applied to ${changeOrderType} ${changeOrderId}. ` +
                        `Re-read via getChangeOrdersTool to see the new budgetStatus/costStatus.`,
                },
            ],
            structuredContent: { actionResponse: applied, summary },
        };
    },
};
