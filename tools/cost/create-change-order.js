import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-26) verification on Parkside Residences sandbox confirmed:
//   - Path uses LOWERCASE type segment: `change-orders/oco`, `change-orders/sco`
//     (uppercase returns `ENUM_MISMATCH`). The tool accepts the uppercase form
//     the operator types ("OCO"/"SCO") and lowercases it internally.
//   - Minimal required body is `{code, name}` — both required (45007).
//   - On success the API returns the full change-order object including:
//       id, containerId, number (auto-assigned, e.g. "0001"),
//       type            — human-readable category label (e.g. "Owner Change Order")
//       formDefinitionType — machine-readable enum (e.g. "oco")
//       budgetStatus    — initial "draft"
//       costStatus      — initial null
//       workflowType    — e.g. "Budget"
//       contractId, mainContractId, companyId, ...
//   - The API accepts PCO/RFQ/COR as valid path types, but those are deferred
//     to M7b per the spec. This tool rejects them client-side with a clear
//     error referencing the deferral.
export const createChangeOrderTool = {
    title: "Create Change Order",
    description:
        "Create an OCO (Owner Change Order) or SCO (Subcontract Change Order) " +
        "in ACC Cost Management. `code` and `name` are required. PCO/RFQ/COR " +
        "change-order types are deferred to M7b and rejected by this tool " +
        "(the underlying API endpoint accepts them; the restriction is " +
        "tools-side). Use getCostContainerTool first to resolve the " +
        "containerId; use attachCostItemsTool afterwards to attach cost items " +
        "(which is what carries the monetary value — an empty change order " +
        "has zero value).",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        changeOrderType: z
            .enum(["OCO", "SCO"])
            .describe(
                "Change-order type. OCO (Owner Change Order) or SCO " +
                "(Subcontract Change Order). PCO/RFQ/COR are accepted by the " +
                "underlying API but deferred to M7b by this tool."
            ),
        code: z
            .string()
            .nonempty()
            .describe("Change-order code — required (e.g. 'OCO-001')"),
        name: z
            .string()
            .nonempty()
            .describe("Human-readable change-order name"),
        description: z.string().optional().describe("Optional free-text description"),
        scopeOfWork: z.string().optional().describe("Optional scope-of-work text"),
        note: z.string().optional().describe("Optional internal note"),
        contractId: z
            .string()
            .optional()
            .describe(
                "Optional contract id to associate this change order with. " +
                "Relevant for SCOs which sit under a subcontract."
            ),
        mainContractId: z
            .string()
            .optional()
            .describe(
                "Optional main-contract id to associate this change order with. " +
                "Relevant for OCOs which sit under the owner↔builder main contract."
            ),
    },
    callback: async ({
        containerId, changeOrderType, code, name,
        description, scopeOfWork, note, contractId, mainContractId,
    }) => {
        const pathType = changeOrderType.toLowerCase(); // OCO -> oco, SCO -> sco
        const body = { code, name };
        if (description !== undefined) body.description = description;
        if (scopeOfWork !== undefined) body.scopeOfWork = scopeOfWork;
        if (note !== undefined) body.note = note;
        if (contractId !== undefined) body.contractId = contractId;
        if (mainContractId !== undefined) body.mainContractId = mainContractId;

        const result = await costApiCall("POST", containerId, `change-orders/${pathType}`, {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(created, "id", "changeOrderId"),
            number: created.number,
            // The API does NOT echo `code` back in the change-order response
            // (Phase 0 round-3 verified). Carry the caller's `code` through
            // to the summary so operator-facing text has the identifier
            // they're tracking.
            code: getFirst(created, "code", "changeOrderCode") ?? code,
            name: created.name,
            // formDefinitionType is the machine-readable enum ("oco"/"sco"/etc.)
            // `type` is the human-readable category label ("Owner Change Order")
            formDefinitionType: getFirst(created, "formDefinitionType"),
            typeLabel: getFirst(created, "type"),
            // Status is split into two fields — budgetStatus + costStatus.
            // Surfacing both because `getChangeOrdersTool` consumers will need
            // them (read-tool follow-up tracked separately).
            budgetStatus: getFirst(created, "budgetStatus"),
            costStatus: getFirst(created, "costStatus"),
            workflowType: getFirst(created, "workflowType"),
            contractId: getFirst(created, "contractId"),
            mainContractId: getFirst(created, "mainContractId"),
            companyId: getFirst(created, "companyId"),
            createdAt: getFirst(created, "createdAt"),
        };

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Created ${changeOrderType} ${summary.code ?? "—"} (id ${summary.id}, number ${summary.number ?? "—"})\n` +
                        `Name: ${summary.name ?? "—"}\n` +
                        `Status: budget=${summary.budgetStatus ?? "—"}, cost=${summary.costStatus ?? "—"}\n` +
                        `Attach cost items via attachCostItemsTool to give this change order value.`,
                },
            ],
            structuredContent: { changeOrder: created, summary },
        };
    },
};
