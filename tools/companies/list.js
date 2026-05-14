import { z } from "zod";
import { accFetch } from "./api.js";

export const accCompanyListTool = {
    title: "List ACC Companies",
    description: `
        Lists companies registered in a Forma/ACC hub (account-level). Use to check whether
        a company already exists before creating, or to retrieve company IDs for downstream
        operations. Paginated — use limit/offset to walk the full set if there are >100.
        accountId should NOT include the "b." prefix.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        nameFilter: z.string().optional(),
    },
    callback: async ({ accountId, limit = 100, offset = 0, nameFilter }) => {
        const query = { limit, offset };
        if (nameFilter) query["filter[name]"] = nameFilter;
        const result = await accFetch(`/hq/v1/accounts/${accountId}/companies`, { query });
        const count = Array.isArray(result) ? result.length : 0;
        const summary = `Returned ${count} companies (limit=${limit}, offset=${offset}${nameFilter ? `, nameFilter=${nameFilter}` : ""}).`;
        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { result, count },
        };
    },
};
