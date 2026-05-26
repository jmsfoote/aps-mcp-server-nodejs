import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-26) verification on Parkside Residences sandbox confirmed:
//   Endpoint:  PATCH /cost/v1/containers/:id/main-contracts/:mainContractId
//   Behaviour: API accepts PATCH on lifecycle/status fields too (a
//              {status:"executed"} PATCH returned 200 and persisted on GET
//              readback). The "content fields only" restriction in this
//              tool is a DESIGN CHOICE, not an API constraint:
//                - Status / lifecycle transitions belong on a different
//                  operator surface (they trigger notifications, budget
//                  locks, and integration-state changes that the operator
//                  should be intentional about).
//                - This tool whitelists content fields only via the Zod
//                  schema. Any other fields will fail Zod validation
//                  before reaching the API.
//
// If a future PR wants to expose status-transition for main contracts, it
// belongs as a separate tool (e.g. transitionMainContractTool) for
// description-as-contract clarity, not buried as an option here.
export const updateMainContractTool = {
    title: "Update Main Contract",
    description:
        "Update content fields on an existing Main Contract in ACC Cost " +
        "Management. Sends a partial PATCH — only provided fields are changed. " +
        "Whitelisted to content fields only (name, code, description, note, " +
        "type, currency). Status / lifecycle transitions are intentionally " +
        "not exposed through this tool — those belong to a separate " +
        "transition surface (deferred). The underlying API does accept " +
        "status PATCHes; the restriction is tools-side.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        mainContractId: z
            .string()
            .nonempty()
            .describe("Main contract id to update"),
        // Content-field whitelist follows. Zod's default for unknown keys
        // is `.strip()` (silently drops them, NOT rejection) — so the
        // schema alone is NOT the defense against a smuggled-in `status`
        // or other lifecycle field. The actual enforcement is the
        // callback's explicit destructuring below, which only references
        // the seven whitelisted fields. A direction-of-contract test
        // (`callback ignores forwarded non-whitelisted keys`) locks this
        // against accidental drift.
        code: z.string().optional().describe("New main contract code"),
        name: z.string().optional().describe("New display name"),
        description: z.string().optional().describe("New free-text description"),
        note: z.string().optional().describe("New internal note"),
        type: z.string().optional().describe("New main-contract type"),
        currency: z.string().optional().describe("New currency code"),
    },
    callback: async ({ containerId, mainContractId, code, name, description, note, type, currency }) => {
        // Explicit whitelist — DO NOT use a generic ...rest sweep here.
        // The MCP SDK may forward unknown fields from caller input through
        // to the callback's destructured object, and we want the design
        // choice (no status/lifecycle PATCH) enforced at this layer too,
        // not just trusted to upstream validation.
        const body = {};
        if (code !== undefined) body.code = code;
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (note !== undefined) body.note = note;
        if (type !== undefined) body.type = type;
        if (currency !== undefined) body.currency = currency;

        if (Object.keys(body).length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            "No update fields provided — pass at least one content field " +
                            "(code, name, description, note, type, currency).",
                    },
                ],
                structuredContent: { error: true, status: 400, message: "no fields" },
            };
        }

        const result = await costApiCall(
            "PATCH",
            containerId,
            `main-contracts/${mainContractId}`,
            {},
            body
        );

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const updated = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(updated, "id", "mainContractId"),
            code: getFirst(updated, "code"),
            name: updated.name,
            status: getFirst(updated, "status"),
            type: getFirst(updated, "type"),
            currency: getFirst(updated, "currency"),
            amount: numVal(getFirst(updated, "amount", "totalAmount")),
        };

        const changedFields = Object.keys(body);
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Updated main contract ${summary.code ?? "—"} (id ${summary.id}). ` +
                        `Changed: ${changedFields.join(", ")}.\n` +
                        `Current name: ${summary.name ?? "—"} | status: ${summary.status ?? "—"}`,
                },
            ],
            structuredContent: { mainContract: updated, summary, changedFields },
        };
    },
};
