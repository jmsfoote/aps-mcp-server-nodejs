import { z } from "zod";
import { accFetch } from "./api.js";
import { CompanyInputSchema, applyDefaults } from "./schema.js";

export const accCompanyCreateTool = {
    title: "Create ACC Company",
    description: `
        Creates a single company in a Forma/ACC hub (account-level). Direct write — no
        preview step. For seeding 5+ companies at once, prefer accCompanyBulkImportPreviewTool
        followed by accCompanyBulkImportCommitTool — that path checks for duplicates first.

        On 409 (name already exists) the tool surfaces a clear error suggesting
        accCompanyListTool to find the existing record's ID.

        accountId should NOT include the "b." prefix. Required: company.name.
        Defaults: country = "Australia" if not provided.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        company: CompanyInputSchema,
    },
    callback: async ({ accountId, company }) => {
        const payload = applyDefaults(company);
        try {
            const result = await accFetch(`/hq/v1/accounts/${accountId}/companies`, {
                method: "POST",
                body: payload,
            });
            return {
                content: [{ type: "text", text: `Company "${result?.name}" created (ID: ${result?.id}).` }],
                structuredContent: { result },
            };
        } catch (e) {
            if (e.status === 409) {
                throw new Error(
                    `Company "${company.name}" already exists in this hub. ` +
                    `Use accCompanyListTool with nameFilter="${company.name}" to find the existing ID.`
                );
            }
            throw e;
        }
    },
};
