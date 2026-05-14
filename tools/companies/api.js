// Shared helpers for the ACC Companies HQ v1 API.
// Endpoints documented at:
//   https://aps.autodesk.com/en/docs/acc/v1/reference/http/companies-POST/
//
// Auth: 2-legged OAuth (pure client_credentials), NOT the SSA/JWT-bearer flow.
// Empirically (2026-04-30), the HQ v1 Companies endpoints return
// `1003 — Only support 2 legged access token` when given an SSA token. Use
// getTwoLeggedToken (utils.js) for these endpoints.
//
// Region: per the spec, AU/US hubs use the default URL. EMEA uses /regions/eu/
// — out of scope for now (no PTP EMEA hubs).

import { getTwoLeggedToken } from "../../utils.js";

const BASE = "https://developer.api.autodesk.com";

/**
 * Fetch wrapper that injects the service-account bearer token and parses JSON.
 * Throws with the response body on non-2xx so callers can surface the error.
 */
export async function accFetch(path, { method = "GET", body, query } = {}) {
    const url = new URL(`${BASE}${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
        }
    }
    const token = await getTwoLeggedToken();
    const init = {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    };
    if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
        const err = new Error(`ACC ${method} ${path} failed: ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.body = parsed;
        throw err;
    }
    return parsed;
}

/**
 * Fetch every page of companies for an account (paginates at 100/page).
 * Used by the bulk-import preview to detect duplicates against the live hub.
 */
export async function fetchAllCompanies(accountId) {
    const all = [];
    let offset = 0;
    const limit = 100;
    // Cap to prevent runaway loops on misbehaving APIs
    for (let i = 0; i < 100; i++) {
        const page = await accFetch(`/hq/v1/accounts/${accountId}/companies`, { query: { limit, offset } });
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (page.length < limit) break;
        offset += limit;
    }
    return all;
}
