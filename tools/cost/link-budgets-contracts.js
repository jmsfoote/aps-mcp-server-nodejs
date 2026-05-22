import { z } from "zod";
import { costApiCall, formatCostApiError } from "./cost-helpers.js";

// Phase 0 (2026-05-22) verification on Parkside Residences sandbox confirmed:
//   - `POST /budgets-contracts:link` with `{ create: [{contractId, budgetId}] }`
//     returns 200 + empty body on success. Nothing is echoed; the tool must not
//     rely on returned link IDs or pair lists.
//   - Two `create` entries sharing one `budgetId` in a single call → 400 with
//     error code 450031: "The same budget is not yet supported to be linked to
//     more than one contract in one API call." The tool auto-splits into
//     sequential calls so each call's `create` array has unique budgetIds.
//   - Attempting to link a budget already linked to another contract → 400 with
//     error code 450030. This is the spec §8 `contract_link_already_exists`
//     scenario, surfaced verbatim per-call so the wave handler can map it to
//     its AMBER flag (handler scope, not tool scope).
//   - The deprecated `budgets` field on POST/PATCH /contracts is the wrong
//     mechanism; this endpoint is the only correct linking path post-2024-10-15.
//   - `remove` entries are pair objects (`{ contractId, budgetId }`), not link
//     IDs. The empty-body endpoint returns 200 on `remove` success as well.

// Partition a `create` array into the minimum number of groups such that no
// group contains two entries sharing the same `budgetId`. First-fit greedy.
// Exported for testability.
export function splitCreateByBudgetId(creates) {
    const groups = [];
    for (const entry of creates) {
        let placed = false;
        for (const g of groups) {
            if (!g.some((e) => e.budgetId === entry.budgetId)) {
                g.push(entry);
                placed = true;
                break;
            }
        }
        if (!placed) groups.push([entry]);
    }
    return groups;
}

const linkPairSchema = z.object({
    contractId: z.string().nonempty(),
    budgetId: z.string().nonempty(),
});

export const linkBudgetsContractsTool = {
    title: "Link Budgets ↔ Contracts",
    description:
        "Create or remove budget↔contract links in ACC Cost Management. " +
        "This is the only correct linking mechanism — the deprecated " +
        "`budgets` field on POST/PATCH /contracts was deprecated 2024-10-15. " +
        "If multiple `create` entries share the same budgetId, the tool " +
        "auto-splits into sequential API calls (the API rejects duplicates " +
        "in one call with error 450031). Each per-call result is surfaced so " +
        "partial failures (e.g. budget already linked — error 450030) are " +
        "visible to the caller.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        create: z
            .array(linkPairSchema)
            .optional()
            .describe("Pairs to link (each `{ contractId, budgetId }`)"),
        remove: z
            .array(linkPairSchema)
            .optional()
            .describe("Pairs to unlink (each `{ contractId, budgetId }`)"),
    },
    callback: async ({ containerId, create, remove }) => {
        const creates = Array.isArray(create) ? create : [];
        const removes = Array.isArray(remove) ? remove : [];

        if (creates.length === 0 && removes.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No link operations provided — pass at least one of `create` or `remove` (the endpoint accepts empty bodies with 200, but this tool refuses no-ops client-side).",
                    },
                ],
                structuredContent: { error: true, status: 400, message: "no link operations" },
            };
        }

        const calls = []; // { intent: 'create'|'remove', groupIndex, body, status, ok, error? }
        const createGroups = creates.length > 0 ? splitCreateByBudgetId(creates) : [];

        for (let i = 0; i < createGroups.length; i++) {
            const body = { create: createGroups[i] };
            const result = await costApiCall("POST", containerId, "budgets-contracts:link", {}, body);
            if (result.error) {
                calls.push({
                    intent: "create",
                    groupIndex: i,
                    pairs: createGroups[i].length,
                    status: result.status,
                    ok: false,
                    error: formatCostApiError(result),
                });
            } else {
                calls.push({
                    intent: "create",
                    groupIndex: i,
                    pairs: createGroups[i].length,
                    status: 200,
                    ok: true,
                });
            }
        }

        if (removes.length > 0) {
            const body = { remove: removes };
            const result = await costApiCall("POST", containerId, "budgets-contracts:link", {}, body);
            if (result.error) {
                calls.push({
                    intent: "remove",
                    pairs: removes.length,
                    status: result.status,
                    ok: false,
                    error: formatCostApiError(result),
                });
            } else {
                calls.push({
                    intent: "remove",
                    pairs: removes.length,
                    status: 200,
                    ok: true,
                });
            }
        }

        const okCalls = calls.filter((c) => c.ok);
        const failedCalls = calls.filter((c) => !c.ok);
        const totalCreatedPairs = okCalls
            .filter((c) => c.intent === "create")
            .reduce((s, c) => s + c.pairs, 0);
        const totalRemovedPairs = okCalls
            .filter((c) => c.intent === "remove")
            .reduce((s, c) => s + c.pairs, 0);

        const lines = [
            `${calls.length} call(s) issued (${createGroups.length} create-group${createGroups.length === 1 ? "" : "s"}` +
                `${removes.length > 0 ? ", 1 remove" : ""}).`,
            `Linked: ${totalCreatedPairs} pair(s). Unlinked: ${totalRemovedPairs} pair(s). Failed calls: ${failedCalls.length}.`,
        ];
        if (failedCalls.length > 0) {
            lines.push("Failures:");
            for (const f of failedCalls) {
                lines.push(`  - ${f.intent}${f.intent === "create" ? ` group ${f.groupIndex}` : ""} (${f.pairs} pair${f.pairs === 1 ? "" : "s"}): ${f.error}`);
            }
        }

        return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: {
                calls,
                totals: {
                    callsIssued: calls.length,
                    pairsLinked: totalCreatedPairs,
                    pairsUnlinked: totalRemovedPairs,
                    callsFailed: failedCalls.length,
                },
            },
        };
    },
};
