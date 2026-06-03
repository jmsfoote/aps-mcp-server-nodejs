import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst } from "./cost-helpers.js";

// Phase 0 (2026-06-03) verification on Parkside Residences sandbox confirmed:
//   Endpoint: POST /cost/v1/containers/:id/expenses
//   Required: `name` (45007 OBJECT_MISSING_REQUIRED_PROPERTY) AND a supplier —
//             one of `supplierId` / `supplierName` (450897 "Supplier name cannot
//             be empty; please provide a supplierId or supplierName."). This tool
//             enforces the supplier one-of CLIENT-SIDE before calling the API.
//   supplierId is NOT FK-validated: a non-existent id (e.g. "000000000") returns
//             201 and is stored as the literal supplierName with supplierCompanyUid
//             = null. Operators should pass a real company id; the tool documents
//             the silent-fallback behavior rather than pretending the API errors.
//   status:   server-set to "draft" on create and NOT settable on the write path
//             (sending status:"inReview" → 400 "No enum match for: inReview on
//             status"). Lifecycle transitions are operator-surface-only — the
//             Slice-2 transitionChangeOrder lesson repeating (see updateExpenseTool).
//   Round-trip: name, description, note, number, referenceNumber, externalId,
//             externalSystem all echo on the create response AND on GET readback.
//             `externalId` (+ `externalSystem`) is the recommended wave-handler
//             idempotency / skip-map key.
export const createExpenseTool = {
    title: "Create Expense",
    description:
        "Create an expense in ACC Cost Management. `name` is required, plus a " +
        "supplier — provide `supplierId` (an ACC company id) or `supplierName` " +
        "(free text). Note: an unrecognized supplierId is NOT rejected by the API " +
        "— it is stored as a literal supplier name — so pass a real company id " +
        "where possible. Set `externalId`/`externalSystem` to make re-runs " +
        "idempotent (getExpensesTool can pre-fetch by externalId). New expenses " +
        "start in status 'draft'; status transitions are not available via the " +
        "API. Use getCostContainerTool first to resolve the containerId; add line " +
        "items via createExpenseLineItemTool.",
    inputSchema: {
        containerId: z.string().nonempty().describe("Cost container ID (from getCostContainerTool)"),
        name: z.string().nonempty().describe("Expense name — required"),
        supplierId: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe(
                "ACC company id of the supplier. Provide this OR supplierName. " +
                "NOT FK-validated — an unknown id is stored as a literal supplier name."
            ),
        supplierName: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("Free-text supplier name. Provide this OR supplierId."),
        description: z.string().optional().describe("Optional description"),
        note: z.string().optional().describe("Optional internal note"),
        number: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("Optional human expense number (free-form accepted, e.g. 'EXP-100'); auto-assigned if omitted"),
        referenceNumber: z.string().trim().min(1).optional().describe("Optional supplier/PO reference number"),
        externalId: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("Optional external-system id for cross-system idempotency (round-trips on read; recommended skip-map key)"),
        externalSystem: z.string().trim().min(1).optional().describe("Optional external-system label paired with externalId"),
        mainContractId: z.string().trim().min(1).optional().describe("Optional main-contract id to associate the expense with"),
    },
    callback: async (args) => {
        const { containerId, name, supplierId, supplierName } = args;
        // Supplier one-of enforced client-side: the API returns 450897 otherwise,
        // far from the input site. Mirrors the link-tool's client-side guard.
        if (supplierId === undefined && supplierName === undefined) {
            const message = "createExpense requires a supplier: provide supplierId or supplierName.";
            return {
                content: [{ type: "text", text: message }],
                structuredContent: { error: true, status: 400, message },
            };
        }

        const body = { name };
        for (const f of ["supplierId", "supplierName", "description", "note", "number", "referenceNumber", "externalId", "externalSystem", "mainContractId"]) {
            if (args[f] !== undefined) body[f] = args[f];
        }

        const result = await costApiCall("POST", containerId, "expenses", {}, body);
        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(created, "id", "expenseId"),
            number: getFirst(created, "number"),
            name: getFirst(created, "name"),
            status: getFirst(created, "status"),
            supplierId: getFirst(created, "supplierId"),
            supplierName: getFirst(created, "supplierName"),
            externalId: getFirst(created, "externalId"),
            externalSystem: getFirst(created, "externalSystem"),
            referenceNumber: getFirst(created, "referenceNumber"),
            mainContractId: getFirst(created, "mainContractId"),
            createdAt: getFirst(created, "createdAt"),
        };

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Created expense ${summary.number ?? "—"} (id ${summary.id})\n` +
                        `Name: ${summary.name ?? "—"} | Supplier: ${summary.supplierName ?? "—"}\n` +
                        `Status: ${summary.status ?? "—"} | externalId: ${summary.externalId ?? "—"}\n` +
                        `Add line items via createExpenseLineItemTool; attach a PDF via attachPdfToCostResourceTool.`,
                },
            ],
            structuredContent: { expense: created, summary },
        };
    },
};
