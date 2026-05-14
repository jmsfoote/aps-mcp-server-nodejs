import { z } from "zod";
import { accFetch } from "./api.js";

export const accCompanyGetTool = {
    title: "Get ACC Company",
    description: `
        Retrieves a single company by its ID from a Forma/ACC hub.
        accountId should NOT include the "b." prefix.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        companyId: z.string().nonempty(),
    },
    callback: async ({ accountId, companyId }) => {
        const result = await accFetch(`/hq/v1/accounts/${accountId}/companies/${companyId}`);
        const name = result?.name || "(unnamed)";
        return {
            content: [{ type: "text", text: `Company "${name}" retrieved (ID: ${result?.id}).` }],
            structuredContent: { result },
        };
    },
};
