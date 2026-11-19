import { z } from "zod";
import { accFetch } from "./api.js";

// HQ v1 ids are plain UUIDs. Checking the shape also keeps path-altering values out of the URL built below.
const HQ_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hqId = (name) => z.string().trim().refine((v) => HQ_UUID.test(v), {
    message: `${name} must be a UUID without the "b." prefix`,
});

export const PROJECT_COMPANIES_PAGE_SIZE = 100;
export const PROJECT_COMPANIES_MAX_PAGES = 50;

export const accProjectCompanyListTool = {
    title: "List Project Companies",
    description: `
        Lists the companies that are members of ONE ACC / Forma project, with each company's member_group_id.
        Read-only. accountId and projectId are plain UUIDs, WITHOUT the "b." prefix.

        Why this exists: the Reviews API identifies a company by its member-group id (a short number such as
        "542830416"), not by the company UUID. createReviewWorkflowTool and createReviewTool need that number for a
        company candidate ({"type": "company", "id": "<member_group_id>"}), and this is the only listing that
        returns it — accCompanyListTool (account-level) does not. A company that is not a member of the project
        is not listed here and cannot be a review candidate.

        Pages through GET hq/v1/accounts/:accountId/projects/:projectId/companies (100 per page; the endpoint's
        default page is 10). Text output per company: name, id (the company UUID) and member_group_id.
        structuredContent = { result: [every company], count, complete }; if the page cap of 50 was reached the
        text says INCOMPLETE and complete is false.
    `,
    inputSchema: {
        accountId: hqId("accountId"),
        projectId: hqId("projectId"),
    },
    callback: async ({ accountId, projectId }) => {
        const result = [];
        let complete = false;
        for (let page = 0; page < PROJECT_COMPANIES_MAX_PAGES; page += 1) {
            const batch = await accFetch(`/hq/v1/accounts/${accountId}/projects/${projectId}/companies`, {
                query: { limit: PROJECT_COMPANIES_PAGE_SIZE, offset: page * PROJECT_COMPANIES_PAGE_SIZE },
            });
            if (!Array.isArray(batch)) {
                throw new Error(`accProjectCompanyListTool: the companies endpoint returned ${batch === null ? "null" : typeof batch} instead of a list (page ${page + 1}); the listing cannot be trusted.`);
            }
            if (batch.length === 0) { complete = true; break; }
            result.push(...batch);
            if (batch.length < PROJECT_COMPANIES_PAGE_SIZE) { complete = true; break; }
        }
        const header = `Found ${result.length} project compan${result.length === 1 ? "y" : "ies"}` +
            (complete ? "" : ` — INCOMPLETE: stopped at the page cap of ${PROJECT_COMPANIES_MAX_PAGES}`);
        const lines = result.map((c) => `- ${c.name} — id: ${c.id} | member_group_id: ${c.member_group_id ?? "—"}`);
        return {
            content: [{ type: "text", text: lines.length ? `${header}:\n${lines.join("\n")}` : header }],
            structuredContent: { result, count: result.length, complete },
        };
    },
};
