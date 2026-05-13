import { z } from "zod";
import { accFetch } from "./api.js";
import { previewStore } from "./preview-store.js";

export const accCompanyBulkImportCommitTool = {
    title: "Commit ACC Company Bulk Import",
    description: `
        Phase 2 of the bulk-import flow. Takes a previewId returned by
        accCompanyBulkImportPreviewTool and writes the validated, deduplicated company
        list to the hub via POST /companies/import. Returns success_items and failure_items
        — partial success is normal for bulk operations, both arrays are surfaced.

        Preview must be committed within 10 minutes of creation, otherwise re-run preview.
    `,
    inputSchema: {
        previewId: z.string().uuid(),
    },
    callback: async ({ previewId }) => {
        const preview = previewStore.get(previewId);
        if (!preview) {
            throw new Error(
                `Preview ${previewId} not found or expired. Re-run accCompanyBulkImportPreviewTool.`
            );
        }
        const { accountId, companies } = preview;
        if (!companies?.length) {
            // Nothing to do — clean up and report
            previewStore.delete(previewId);
            return {
                content: [{ type: "text", text: `Preview ${previewId} had 0 companies to create (all submissions were duplicates). Nothing imported.` }],
                structuredContent: { success_items: [], failure_items: [], summary: { attempted: 0, succeeded: 0, failed: 0 } },
            };
        }

        const result = await accFetch(`/hq/v1/accounts/${accountId}/companies/import`, {
            method: "POST",
            body: companies,
        });

        previewStore.delete(previewId);

        const success_items = result?.success_items ?? [];
        const failure_items = result?.failure_items ?? [];
        const attempted = companies.length;
        const succeeded = success_items.length;
        const failed = failure_items.length;

        const text =
            `Bulk import complete: ${succeeded}/${attempted} created, ${failed} failed.` +
            (failed > 0 ? " See failure_items in structuredContent for per-row reasons." : "");

        return {
            content: [{ type: "text", text }],
            structuredContent: {
                success_items,
                failure_items,
                summary: { attempted, succeeded, failed },
            },
        };
    },
};
