import { z } from "zod";
import { costApiFetchAll, formatCostApiError, getFirst, numVal } from "./cost-helpers.js";

// Phase 0 (2026-06-03) verification on Parkside Residences sandbox confirmed:
//   Endpoint: GET /cost/v1/containers/:id/expenses
//   Shape:    { results: [ <expense>, ... ], pagination: { limit, totalResults,
//             offset, nextUrl } } — INSTANCES, not form/category buckets
//             (contrast the change-order list trap; no per-type dispatch needed).
//   Page cap: the API silently CAPS `limit` at 100 (requesting 200/500 still
//             returns pagination.limit=100). costApiFetchAll stops a run when a
//             page returns < limit items, so a >100 page size would TRUNCATE at
//             the first full 100-item page. This tool clamps the page size to 100.
//   Filters:  server-side `filter[externalId]` and `filter[status]` are honored
//             (verified live — percent-encoded brackets survive URLSearchParams).
//             `filter[supplierId]` is IGNORED (returns all). Exposed: externalId,
//             status. The Slice-3 wave handler pre-fetches its skip-map by
//             externalId — `getExpensesTool({containerId, externalId})`.
//   Skip-map: `externalId` (+ `externalSystem`) round-trips on create AND list;
//             it is the recommended wave-handler idempotency key (unlike change
//             orders, expenses carry a first-class external-id field).
export const getExpensesTool = {
    title: "Get Expenses",
    description:
        "List expenses in ACC Cost Management. Returns expense numbers, names, " +
        "suppliers, statuses, amounts, and the externalId/externalSystem " +
        "integration fields used for re-run idempotency. Optional `externalId` " +
        "and `status` filters are applied server-side — pass `externalId` to " +
        "pre-fetch a single expense by its integration key. Use " +
        "getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        externalId: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe(
                "Filter to the expense whose externalId matches (server-side " +
                "filter[externalId]); use for idempotency skip-map pre-fetch"
            ),
        status: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("Filter by status, e.g. 'draft', 'inReview', 'paid' (server-side filter[status])"),
        limit: z
            .number()
            .int()
            .positive()
            .optional()
            .default(100)
            .describe("Items per page (the API caps at 100; larger values are clamped)"),
    },
    callback: async ({ containerId, externalId, status, limit }) => {
        const queryParams = {};
        if (externalId !== undefined) queryParams["filter[externalId]"] = externalId;
        if (status !== undefined) queryParams["filter[status]"] = status;

        // The /expenses endpoint caps page size at 100; clamp so the paginator's
        // "page shorter than limit ⇒ last page" stop condition stays correct.
        // `limit ?? 100` keeps the tool robust if the callback is invoked without
        // Zod applying its default (the MCP layer always does).
        const pageLimit = Math.min(limit ?? 100, 100);
        const result = await costApiFetchAll(containerId, "expenses", queryParams, pageLimit);

        if (result.error) {
            // Render via the shared formatter so validation/5xx envelopes come
            // back parsed (matches the write-tool convention) rather than dumping
            // the raw response body. structuredContent keeps the full result.
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const expenses = result.data.map((e) => ({
            id: getFirst(e, "id", "expenseId"),
            number: getFirst(e, "number"),
            name: getFirst(e, "name"),
            status: getFirst(e, "status"),
            type: getFirst(e, "type"),
            supplierId: getFirst(e, "supplierId"),
            supplierName: getFirst(e, "supplierName"),
            amount: numVal(getFirst(e, "amount", "totalAmount")),
            // Integration / skip-map fields — load-bearing for the wave handler.
            externalId: getFirst(e, "externalId"),
            externalSystem: getFirst(e, "externalSystem"),
            referenceNumber: getFirst(e, "referenceNumber"),
            description: getFirst(e, "description"),
            mainContractId: getFirst(e, "mainContractId"),
            // NOTE: the list/get-one views do NOT embed line items (the
            // `expenseItems` array is always []); item counts/values come from
            // GET expenses/:id/items. We surface `amount` (which the server
            // aggregates from items) rather than a misleading always-0 count.
            createdAt: getFirst(e, "createdAt", "created_at"),
        }));

        const totalAmount = expenses.reduce((s, e) => s + (e.amount || 0), 0);
        const lines = expenses.map(
            (e) =>
                `- ${e.number || "—"} | ${e.name || "—"} | ` +
                `Supplier: ${e.supplierName || "—"} | Status: ${e.status || "—"} | ` +
                `Amount: ${fmt(e.amount)} | externalId: ${e.externalId || "—"}`
        );
        const summary =
            `${expenses.length} expense(s) found.\n` +
            `Totals — Amount: ${fmt(totalAmount)}\n\n` +
            lines.join("\n");

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { expenses, totals: { amount: totalAmount }, count: expenses.length },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
