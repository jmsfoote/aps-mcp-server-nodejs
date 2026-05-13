import { z } from "zod";
import crypto from "node:crypto";
import { fetchAllCompanies } from "./api.js";
import { CompanyInputSchema, applyDefaults } from "./schema.js";
import { previewStore } from "./preview-store.js";

export const accCompanyBulkImportPreviewTool = {
    title: "Preview ACC Company Bulk Import",
    description: `
        Phase 1 of the bulk-import flow. Validates the company list against schema,
        fetches the existing hub roster, and flags duplicates by case-insensitive name match.
        Does NOT write anything. Returns a previewId that must be passed to
        accCompanyBulkImportCommitTool within 10 minutes to actually import.

        accountId should NOT include the "b." prefix. Up to 100 companies per call.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        companies: z.array(CompanyInputSchema).min(1).max(100),
    },
    callback: async ({ accountId, companies }) => {
        const normalised = companies.map(applyDefaults);

        // Duplicate detection against the live hub
        const existing = await fetchAllCompanies(accountId);
        const existingByName = new Map(
            existing.map((c) => [String(c.name || "").toLowerCase().trim(), c])
        );

        const duplicates = [];
        const toCreate = [];
        for (const c of normalised) {
            const key = c.name.toLowerCase().trim();
            const match = existingByName.get(key);
            if (match) {
                duplicates.push({ name: c.name, existingId: match.id });
            } else {
                toCreate.push(c);
            }
        }

        const previewId = crypto.randomUUID();
        const ttlSeconds = previewStore.set(previewId, { accountId, companies: toCreate });

        const summary =
            `Bulk import preview ready (previewId=${previewId}). ` +
            `Submitted ${companies.length}; will create ${toCreate.length}; skipping ${duplicates.length} duplicate(s). ` +
            `Call accCompanyBulkImportCommitTool with this previewId within ${Math.round(ttlSeconds / 60)} min.`;

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: {
                previewId,
                summary: {
                    totalSubmitted: companies.length,
                    toCreate: toCreate.length,
                    duplicatesSkipped: duplicates.length,
                },
                duplicates,
                toCreate,
                expiresInSeconds: ttlSeconds,
                nextStep: "Call accCompanyBulkImportCommitTool with this previewId to write these companies to the hub.",
            },
        };
    },
};
