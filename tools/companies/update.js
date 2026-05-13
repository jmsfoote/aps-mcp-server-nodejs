import { z } from "zod";
import { accFetch } from "./api.js";
import { CompanyUpdateSchema } from "./schema.js";

export const accCompanyUpdateTool = {
    title: "Update ACC Company",
    description: `
        Partially updates an existing company in a Forma/ACC hub via PATCH. Only fields
        present in the patch are modified. Use accCompanyGetTool first to confirm the
        current state if you want to verify what'll change.

        accountId should NOT include the "b." prefix.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        companyId: z.string().nonempty(),
        patch: CompanyUpdateSchema,
    },
    callback: async ({ accountId, companyId, patch }) => {
        const result = await accFetch(`/hq/v1/accounts/${accountId}/companies/${companyId}`, {
            method: "PATCH",
            body: patch,
        });
        const fields = Object.keys(patch).join(", ") || "(none)";
        return {
            content: [{ type: "text", text: `Company "${result?.name}" updated. Fields patched: ${fields}.` }],
            structuredContent: { result },
        };
    },
};
