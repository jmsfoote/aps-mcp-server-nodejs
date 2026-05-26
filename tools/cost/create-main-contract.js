import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-26) verification on Parkside Residences sandbox confirmed:
//   Endpoint:  POST /cost/v1/containers/:id/main-contracts
//   Required:  `code` and `name` (Phase 0 round-1 captured "Missing required
//              property: code" when only {name, number} was sent).
//   Response:  Full main-contract object incl. id, status="draft",
//              type, code, name, externalSystem/externalId/integrationState
//              (lifecycle/integration fields).
//
// CONTEXT (from BUSINESS_CONTEXT.md and the 2026-05-25 inventory):
// A Main Contract is the owner↔builder prime-contract object. PTP's
// integration narrative makes this useful as a lender-facing header even
// when items don't ship until M7b. Main Contract Items (the line items
// inside a main contract) are intentionally NOT exposed in this PR —
// the same zero-value trap as an empty change order applies.
export const createMainContractTool = {
    title: "Create Main Contract",
    description:
        "Create a Main Contract (owner↔builder prime contract) in ACC Cost " +
        "Management. `code` and `name` are required. The main contract is a " +
        "header object; line items (Main Contract Items) are deferred to " +
        "M7b. Useful on its own as a lender-facing prime-contract reference.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        code: z
            .string()
            .nonempty()
            .describe("Main contract code — required (e.g. 'MC-001')"),
        name: z
            .string()
            .nonempty()
            .describe("Human-readable main contract name"),
        description: z.string().optional().describe("Optional free-text description"),
        note: z.string().optional().describe("Optional internal note"),
        type: z
            .string()
            .optional()
            .describe(
                "Optional main-contract type (project-defined options observed on " +
                "Parkside: 'Unit Price', 'Cost Plus', 'Fixed Price'). Check the " +
                "container's MainContract type property for the allowed set."
            ),
        currency: z
            .string()
            .optional()
            .describe("Optional currency code (defaults to project currency, e.g. 'AUD')"),
    },
    callback: async ({ containerId, code, name, description, note, type, currency }) => {
        const body = { code, name };
        if (description !== undefined) body.description = description;
        if (note !== undefined) body.note = note;
        if (type !== undefined) body.type = type;
        if (currency !== undefined) body.currency = currency;

        const result = await costApiCall("POST", containerId, "main-contracts", {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(created, "id", "mainContractId"),
            code: getFirst(created, "code"),
            name: created.name,
            status: getFirst(created, "status"),
            type: getFirst(created, "type"),
            currency: getFirst(created, "currency"),
            amount: numVal(getFirst(created, "amount", "totalAmount")),
            externalSystem: getFirst(created, "externalSystem"),
            externalId: getFirst(created, "externalId"),
            integrationState: getFirst(created, "integrationState"),
            createdAt: getFirst(created, "createdAt"),
        };

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Created main contract ${summary.code ?? "—"}: ${summary.name ?? "—"}\n` +
                        `Id: ${summary.id} | Status: ${summary.status ?? "—"} | Type: ${summary.type ?? "—"}\n` +
                        `Main contract items (line items) are deferred to M7b.`,
                },
            ],
            structuredContent: { mainContract: created, summary },
        };
    },
};
