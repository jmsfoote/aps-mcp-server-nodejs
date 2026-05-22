import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-05-22) verification on Parkside Residences sandbox confirmed:
//   - `code` and `name` are both required (codes 451111 and 45007 respectively).
//   - `number` is optional; the response object exposes `code` but no `number`
//     field — the spec's "contract number" maps onto `code` in practice.
//   - Dec-2025 lifecycle dates (`awardedAt`, `executedAt`) are settable on
//     create; `statusChangedAt` is server-controlled and overwrites supplied
//     values at creation.
//   - The deprecated `budgets` field (deprecated 2024-10-15) is not sent.
//     Linking budgets to a contract uses `budgets-contracts:link` instead.
//   - On success the API returns the full contract object — status defaults
//     to "draft", currency defaults to project default (e.g. "AUD"),
//     `budgetIds` is `[]`.
export const createContractTool = {
    title: "Create Contract",
    description:
        "Create a contract (subcontract, purchase order, or commitment) in an " +
        "ACC Cost Management project. `code` and `name` are required; other " +
        "fields are optional and the API supplies defaults. Once created, " +
        "link the contract to one or more budgets via linkBudgetsContractsTool. " +
        "Use getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        code: z
            .string()
            .nonempty()
            .describe(
                "Contract code — required. Used by the API as the primary " +
                "identifier of the contract on subsequent reads."
            ),
        name: z
            .string()
            .nonempty()
            .describe("Human-readable contract name (e.g. 'External civils subcontract — XYZ Pty Ltd')"),
        number: z
            .string()
            .optional()
            .describe(
                "Optional contract number. The API does not return a separate " +
                "`number` field on the contract object; `code` carries the " +
                "primary identifier."
            ),
        description: z.string().optional().describe("Optional free-text description"),
        type: z.string().optional().describe("Optional contract type (e.g. 'subcontract', 'purchaseOrder' — project-defined)"),
        companyId: z.string().optional().describe("Optional vendor/supplier company ID"),
        currency: z.string().optional().describe("Optional currency code (defaults to project currency, e.g. 'AUD')"),
        awardedAt: z
            .string()
            .optional()
            .describe("Awarded date — ISO-8601 datetime. Settable on create."),
        executedAt: z
            .string()
            .optional()
            .describe("Executed date — ISO-8601 datetime. Settable on create."),
        statusChangedAt: z
            .string()
            .optional()
            .describe(
                "Status-changed date — ISO-8601 datetime. NOTE: server-controlled " +
                "on create — any value passed is silently overwritten with the " +
                "creation timestamp. Useful on PATCH (see updateContractTool)."
            ),
    },
    callback: async ({ containerId, code, name, number, description, type, companyId, currency, awardedAt, executedAt, statusChangedAt }) => {
        const body = { code, name };
        if (number !== undefined) body.number = number;
        if (description !== undefined) body.description = description;
        if (type !== undefined) body.type = type;
        if (companyId !== undefined) body.companyId = companyId;
        if (currency !== undefined) body.currency = currency;
        if (awardedAt !== undefined) body.awardedAt = awardedAt;
        if (executedAt !== undefined) body.executedAt = executedAt;
        if (statusChangedAt !== undefined) body.statusChangedAt = statusChangedAt;

        const result = await costApiCall("POST", containerId, "contracts", {}, body);

        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(created, "id", "contractId"),
            code: getFirst(created, "code", "contractCode"),
            name: created.name,
            number: getFirst(created, "number", "contractNumber"),
            type: getFirst(created, "type", "contractType"),
            status: getFirst(created, "status", "state"),
            vendor: getFirst(created, "companyName", "vendor", "vendorName", "supplier"),
            amount: numVal(getFirst(created, "amount", "contractAmount", "totalAmount")),
            currency: getFirst(created, "currency", "currencyCode"),
            awardedAt: created.awardedAt,
            executedAt: created.executedAt,
            statusChangedAt: created.statusChangedAt,
        };

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Created contract ${summary.code ?? "—"}: ${summary.name ?? "—"}\n` +
                        `Id: ${summary.id}\n` +
                        `Status: ${summary.status ?? "—"} | Vendor: ${summary.vendor ?? "—"} | ` +
                        `Currency: ${summary.currency ?? "—"}\n` +
                        `Link to budgets via linkBudgetsContractsTool.`,
                },
            ],
            structuredContent: { contract: created, summary },
        };
    },
};
