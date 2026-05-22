import { getAccessToken } from "../../utils.js";
import { ACC_ADS_REGION } from "../../config.js";

const COST_API_BASE = "https://developer.api.autodesk.com/cost/v1/containers";

/**
 * Make an authenticated call to the ACC Cost Management API.
 * @param {string} method - HTTP method (GET, POST, PATCH, etc.)
 * @param {string} containerId - Cost container ID
 * @param {string} path - Endpoint path after /containers/{id}/ (e.g., "budgets")
 * @param {object} [queryParams] - URL query parameters
 * @param {object} [body] - JSON request body for POST/PATCH/PUT (omitted on GET/DELETE)
 * @returns {Promise<{data?: any[], error?: boolean, status?: number, message?: string}>}
 */
export async function costApiCall(method, containerId, path, queryParams = {}, body) {
    const token = await getAccessToken();
    const url = new URL(`${COST_API_BASE}/${containerId}/${path}`);
    for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
    };
    if (ACC_ADS_REGION) headers["x-ads-region"] = ACC_ADS_REGION;

    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const resp = await fetch(url.toString(), init);

    if (!resp.ok) {
        const body = await resp.text();
        if (resp.status === 404) {
            return {
                error: true,
                status: 404,
                message:
                    `Cost API ${method} ${path} returned 404. ` +
                    `This usually means the Cost module is not activated on this project, ` +
                    `the container ID is wrong, or the x-ads-region header is missing. ` +
                    `Check ACC Admin > Project > Modules > Cost Management.`,
            };
        }
        if (resp.status === 403) {
            return {
                error: true,
                status: 403,
                message:
                    `Cost API ${method} ${path} returned 403. ` +
                    `The service account may not have Cost Management permissions. ` +
                    `Check ACC Admin > Custom Integrations and ensure Cost is enabled for the app.`,
            };
        }
        return { error: true, status: resp.status, message: body };
    }

    if (resp.status === 204) return { data: [] };
    // Some endpoints return 200 with an empty body — notably
    // POST /budgets-contracts:link, observed during M7a-full D2 Phase 0
    // (2026-05-22). Treat the same as 204 to avoid SyntaxError on resp.json().
    const text = await resp.text();
    if (!text || text.trim().length === 0) return { data: [] };
    const json = JSON.parse(text);
    return { data: extractItems(json) };
}

/**
 * Handle Autodesk's inconsistent response wrapping.
 * Response may be a bare array, or wrapped in { data: [...] } or { results: [...] }.
 */
function extractItems(json) {
    if (Array.isArray(json)) return json;
    if (json.data && Array.isArray(json.data)) return json.data;
    if (json.results && Array.isArray(json.results)) return json.results;
    return [json];
}

/**
 * Paginate through a cost endpoint, fetching all pages.
 * Stops when a page returns fewer items than the limit.
 * @param {string} containerId - Cost container ID
 * @param {string} path - Endpoint path (e.g., "budgets")
 * @param {object} [queryParams] - Additional query parameters
 * @param {number} [limit=200] - Items per page (max 200)
 * @param {number} [maxPages=20] - Safety cap on page count
 * @returns {Promise<{data?: any[], error?: boolean, status?: number, message?: string}>}
 */
export async function costApiFetchAll(containerId, path, queryParams = {}, limit = 200, maxPages = 20) {
    const allItems = [];
    for (let page = 0; page < maxPages; page++) {
        const result = await costApiCall("GET", containerId, path, {
            ...queryParams,
            limit,
            offset: page * limit,
        });
        if (result.error) return result;
        allItems.push(...result.data);
        if (result.data.length < limit) break;
    }
    return { data: allItems };
}

/**
 * Get the first non-undefined value from an object for a list of candidate keys.
 * Handles Autodesk's inconsistent field naming across API versions.
 * @param {object} obj - Source object
 * @param {...string} keys - Candidate field names in priority order
 * @returns {*} First found value, or undefined
 */
export function getFirst(obj, ...keys) {
    for (const key of keys) {
        if (obj[key] !== undefined) return obj[key];
    }
    return undefined;
}

/**
 * Render a Cost API error result ({error: true, status, message}) as a
 * human-readable one-liner for MCP tool `content`. Write-endpoint errors come
 * back as a JSON envelope like:
 *   { "error": { "errors": [{ "code", "title", "detail" }], "name", "title", ... } }
 * or the legacy non-nested form. This helper handles both.
 * @param {{status?: number, message?: string}} result
 * @returns {string}
 */
export function formatCostApiError(result) {
    const status = result.status ?? "?";
    const raw = result.message ?? "";
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const envelope = parsed?.error ?? parsed;
    const errs = envelope?.errors;
    if (Array.isArray(errs) && errs.length) {
        const lines = errs.map((e) =>
            `[${e.code ?? "?"}] ${e.title ?? ""}${e.detail ? ` — ${e.detail}` : ""}`.trim()
        );
        return `Cost API error (status ${status}): ${lines.join("; ")}`;
    }
    if (envelope?.title || envelope?.detail) {
        return `Cost API error (status ${status}): ${envelope.title ?? ""}${envelope.detail ? ` — ${envelope.detail}` : ""}`.trim();
    }
    return `Cost API error (status ${status}): ${raw || "unknown error"}`;
}

/**
 * Safely convert an API value to a number.
 * The Cost API returns monetary amounts as strings like "350000.0000".
 * Using + or reduce with these strings causes concatenation instead of addition.
 * @param {*} v - Value from API (string, number, null, undefined)
 * @returns {number} Parsed number, or 0 if invalid/missing
 */
export function numVal(v) {
    if (v === undefined || v === null || v === "") return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
}
