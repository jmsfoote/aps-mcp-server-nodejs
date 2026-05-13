// Shared zod schema for the ACC Company input payload.
// HQ v1 field names are snake_case (e.g. address_line_1) — we accept the same
// shape on input so callers can pass through API field names directly without
// camelCase translation. Keeps the tool contract close to the API contract.

import { z } from "zod";

export const CompanyInputSchema = z.object({
    name: z.string().min(1).max(255).describe("Company name. Required."),
    // ACC's hq/v1 Companies endpoint REQUIRES `trade` despite Autodesk docs marking it optional.
    // Empirically confirmed 2026-05-05: `name`-only payloads fail with 400 Bad Request on
    // single-create AND with "required parameters missing" on bulk-import. Smoke tests yesterday
    // succeeded because they all had `trade: "Test"`. Default to "Other" if not provided.
    trade: z.string().optional().describe("Trade/discipline, e.g. 'General Contractor', 'Architect'. Empirically required by the API even though docs say optional — defaults to 'Other' if not set."),
    address_line_1: z.string().optional(),
    address_line_2: z.string().optional(),
    city: z.string().optional(),
    state_or_province: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional().describe("Defaults to 'Australia' if not provided."),
    phone: z.string().optional(),
    website_url: z.string().url().optional(),
    description: z.string().optional(),
    erp_id: z.string().optional(),
    tax_id: z.string().optional().describe("ABN for Australian companies."),
});

export const CompanyUpdateSchema = CompanyInputSchema.partial();

/**
 * Apply PTP-default values when missing.
 *   country: defaulted to "Australia" — the HQ v1 endpoint doesn't enforce
 *     country, but downstream search/filter UX is much better with it set.
 *   trade: defaulted to "Other" — the HQ v1 endpoint REQUIRES trade despite
 *     docs marking it optional. Empirical finding 2026-05-05.
 */
export function applyDefaults(company) {
    return { country: "Australia", trade: "Other", ...company };
}
