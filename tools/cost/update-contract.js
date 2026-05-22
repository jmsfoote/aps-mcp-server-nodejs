import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-22) verification on Parkside Residences sandbox:
//   PATCH /contracts/{id} with a partial body (e.g. { description }) returned
//   200 + the full contract object with only the supplied fields changed.
//   The deprecated `budgets` field (deprecated 2024-10-15) is not sent.
//   Linking budgets to a contract uses budgets-contracts:link instead.
export const updateContractTool = {
    title: "Update Contract",
    description:
        "Update an existing contract in ACC Cost Management. Sends a partial " +
        "PATCH — only provided fields are changed. Use linkBudgetsContractsTool " +
        "to manage budget↔contract links (the deprecated `budgets` field on " +
        "PATCH /contracts is not sent).",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        contractId: z
            .string()
            .nonempty()
            .describe("Contract id to update (from getContractsTool)"),
        code: z.string().optional().describe("New contract code"),
        name: z.string().optional().describe("New display name"),
        number: z.string().optional().describe("New contract number (the API stores the primary identifier as `code`)"),
        description: z.string().optional().describe("New free-text description"),
        type: z.string().optional().describe("New contract type"),
        companyId: z.string().optional().describe("New vendor/supplier company ID"),
        currency: z.string().optional().describe("New currency code"),
        awardedAt: z.string().optional().describe("Awarded date (ISO-8601)"),
        executedAt: z.string().optional().describe("Executed date (ISO-8601)"),
        statusChangedAt: z.string().optional().describe("Status-changed date (ISO-8601)"),
    },
    callback: async ({ containerId, contractId, ...rest }) => {
        const body = {};
        for (const [k, v] of Object.entries(rest)) {
            if (v !== undefined) body[k] = v;
        }

        if (Object.keys(body).length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No update fields provided — pass at least one field (code, name, number, description, type, companyId, currency, awardedAt, executedAt, statusChangedAt).",
                    },
                ],
                structuredContent: { error: true, status: 400, message: "no fields" },
            };
        }

        const result = await costApiCall("PATCH", containerId, `contracts/${contractId}`, {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const updated = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(updated, "id", "contractId"),
            code: getFirst(updated, "code", "contractCode"),
            name: updated.name,
            number: getFirst(updated, "number", "contractNumber"),
            type: getFirst(updated, "type", "contractType"),
            status: getFirst(updated, "status", "state"),
            vendor: getFirst(updated, "companyName", "vendor", "vendorName", "supplier"),
            amount: numVal(getFirst(updated, "amount", "contractAmount", "totalAmount")),
            currency: getFirst(updated, "currency", "currencyCode"),
            awardedAt: updated.awardedAt,
            executedAt: updated.executedAt,
            statusChangedAt: updated.statusChangedAt,
        };

        const changedFields = Object.keys(body).join(", ");
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Updated contract ${summary.code ?? "—"} (id ${summary.id}). ` +
                        `Changed: ${changedFields}.\n` +
                        `Current name: ${summary.name ?? "—"} | status: ${summary.status ?? "—"}`,
                },
            ],
            structuredContent: { contract: updated, summary, changedFields: Object.keys(body) },
        };
    },
};
