import { getAccessToken } from "../utils.js";
import { ACC_ADS_REGION } from "../config.js";

const REVIEWS_BASE = "https://developer.api.autodesk.com/construction/reviews/v1";

/**
 * Make an authenticated request to the ACC Reviews API.
 * @param {string} method - HTTP method
 * @param {string} path - Path after /v1 (e.g., /projects/{pid}/workflows)
 * @param {object} [body] - Request body for POST/PATCH
 * @returns {Promise<object>} Parsed JSON response
 */
export async function reviewsApiCall(method, path, body = null) {
    const token = await getAccessToken();
    const url = `${REVIEWS_BASE}${path}`;

    const options = {
        method,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "x-ads-region": ACC_ADS_REGION || "APAC",
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
            throw new Error(
                `Reviews API ${method} ${path} returned 404. ` +
                `This usually means the Reviews module is not activated on this project. ` +
                `Enable it in ACC Admin > Project > Modules > Reviews, then retry.`
            );
        }
        throw new Error(
            `Reviews API ${method} ${path} failed (${response.status}): ${errorText}`
        );
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) return {};
    return response.json();
}