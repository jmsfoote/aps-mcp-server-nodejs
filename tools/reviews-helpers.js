import { z } from "zod";
import { getAccessToken } from "../utils.js";
import { ACC_ADS_REGION } from "../config.js";

const REVIEWS_BASE = "https://developer.api.autodesk.com/construction/reviews/v1";

/** Page size for every Reviews list endpoint: the API maximum (limit=51 is a 400, observed 2026-11-19). */
export const REVIEWS_PAGE_SIZE = 50;
/** Hard stop on pages fetched for one listing: 100 × 50 = 5,000 rows. */
export const REVIEWS_MAX_PAGES = 100;

/** Waits between attempts of a READ that failed with 429 or 5xx. A write is never retried. */
export const REVIEWS_READ_RETRY_DELAYS_MS = [500, 1500];
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Test hook: replace the wait between read retries. Returns the previous function. */
export function setReviewsRetrySleep(fn) {
    const previous = sleep;
    sleep = fn;
    return previous;
}

// The Reviews API takes the project id "with or without the b. prefix" (reference pages; both observed live).
// Checking the shape also keeps path-altering values ("../", "#", "?", "/") out of the URL built below.
const REVIEWS_PROJECT_ID = /^(b\.)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const reviewsProjectId = () => z.string().nonempty().regex(REVIEWS_PROJECT_ID, {
    message: 'projectId must be the project UUID, with or without the "b." prefix (e.g. "b.9dbb160e-b904-458b-bc5c-ed184687592d")',
});
export const reviewsUuid = (name) => z.string().uuid({ message: `${name} must be a UUID` });

/**
 * Make an authenticated request to the ACC Reviews API.
 *
 * A GET that fails with 429 or 5xx is retried (REVIEWS_READ_RETRY_DELAYS_MS). Any other method is sent
 * exactly once: a workflow or a review cannot be deleted through the API, so a blind re-send could leave
 * a duplicate behind.
 *
 * @param {string} method - HTTP method
 * @param {string} path - Path after /v1 (e.g., /projects/{pid}/workflows)
 * @param {object} [body] - Request body for POST
 * @param {{ notFoundMessage?: string }} [opts] - notFoundMessage replaces the default 404 sentence (by-id reads,
 *   where a 404 means "no such id", not "module off").
 * @returns {Promise<object>} Parsed JSON response
 */
export async function reviewsApiCall(method, path, body = null, opts = {}) {
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

    const retryDelays = method === "GET" ? REVIEWS_READ_RETRY_DELAYS_MS : [];
    let response;
    for (let attempt = 0; ; attempt += 1) {
        response = await fetch(url, options);
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= retryDelays.length) break;
        await sleep(retryDelays[attempt]);
    }

    if (!response.ok) {
        const errorText = await response.text();
        let error;
        if (response.status === 404) {
            // The default sentence is matched word for word by mortgage-study-rag's acc_delivery.py
            // (_REVIEWS_MODULE_OFF_MARKER = "Reviews module is not activated"). Do not reword it.
            error = new Error(opts.notFoundMessage ??
                `Reviews API ${method} ${path} returned 404. ` +
                `This usually means the Reviews module is not activated on this project. ` +
                `Enable it in ACC Admin > Project > Modules > Reviews, then retry.`
            );
        } else {
            error = new Error(
                `Reviews API ${method} ${path} failed (${response.status}): ${errorText}`
            );
        }
        error.status = response.status;
        error.responseText = errorText;
        throw error;
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) return {};
    return response.json();
}

/** The 404 sentence for a read by id. It must NOT contain the module-off marker the list call uses. */
export function notFoundById(method, path, what, id) {
    return `Reviews API ${method} ${path} returned 404. No ${what} with id ${id} was found in this project ` +
        `(check the id; a 404 here can also mean Reviews is not switched on for the project).`;
}

/** Build "?a=b&c=d" from an ordered list of [key, value] pairs. Keys are sent as given (the API's own
 * "filter[status]" bracket form is what works live); values are URL-encoded. Undefined values are skipped. */
export function reviewsQuery(pairs) {
    const parts = [];
    for (const [key, value] of pairs) {
        if (value === undefined || value === null || value === "") continue;
        parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * Fetch every page of a Reviews list endpoint (workflows, reviews, progress, versions, approval statuses).
 *
 * `fetchPage(offset, limit)` performs one GET and resolves to `{ results: [...], pagination: { totalResults } }`.
 * Pages are merged in order and de-duplicated by `idOf(row)` when it returns a value. Rows without an id
 * (a review's progress rows have none) are kept as they come; for those a page identical to the one before
 * it is what reveals a server that ignored offset.
 *
 * The listing is `complete` only when Autodesk reported a total AND that many distinct rows were collected.
 * Otherwise `complete` is false and `stoppedBecause` says why:
 *   "max_pages"          — the page cap was reached
 *   "repeated_page"      — a page added nothing new (the server ignored offset)
 *   "no_total"           — Autodesk never reported pagination.totalResults, so "all of them" cannot be confirmed
 *   "ended_before_total" — the pages ran out before the reported total was reached
 * It never loops without end and never reports a partial list as whole.
 *
 * @returns {Promise<{ results: any[], totalResults: number|null, pages: number, pageSize: number, complete: boolean, stoppedBecause?: string }>}
 */
export async function fetchAllReviewsPages(fetchPage, { pageSize = REVIEWS_PAGE_SIZE, maxPages = REVIEWS_MAX_PAGES, idOf = (row) => row?.id } = {}) {
    const results = [];
    const seen = new Set();
    let totalResults;
    let pages = 0;
    let offset = 0;
    let ended = false;
    let stoppedBecause;
    let previousPage;

    while (pages < maxPages) {
        const res = await fetchPage(offset, pageSize);
        pages += 1;
        const batch = Array.isArray(res?.results) ? res.results : [];
        const reported = res?.pagination?.totalResults;
        if (Number.isInteger(reported)) totalResults = reported;

        if (batch.length === 0) { ended = true; break; }
        const thisPage = JSON.stringify(batch);
        if (thisPage === previousPage) { stoppedBecause = "repeated_page"; break; }
        previousPage = thisPage;

        let added = 0;
        for (const row of batch) {
            const id = idOf(row);
            if (id !== undefined && id !== null) {
                if (seen.has(id)) continue;
                seen.add(id);
            }
            results.push(row);
            added += 1;
        }
        offset += batch.length;

        if (added === 0) { stoppedBecause = "repeated_page"; break; }
        const reachedEnd = totalResults !== undefined ? offset >= totalResults : batch.length < pageSize;
        if (reachedEnd) { ended = true; break; }
    }

    if (!stoppedBecause) {
        if (!ended) stoppedBecause = "max_pages";
        else if (totalResults === undefined) stoppedBecause = "no_total";
        else if (results.length < totalResults) stoppedBecause = "ended_before_total";
    }
    const complete = stoppedBecause === undefined;
    return { results, totalResults: totalResults ?? null, pages, pageSize, complete, ...(complete ? {} : { stoppedBecause }) };
}

const STOP_REASONS = {
    max_pages: "the page cap was reached",
    repeated_page: "the server repeated a page (it ignored offset)",
    no_total: "Autodesk reported no total, so it cannot be confirmed that this is all of them",
    ended_before_total: "the pages ran out before the total Autodesk reported",
};

/** " — INCOMPLETE: …" for a listing that could not be completed; "" for a complete one. */
export function incompleteNote(listing) {
    if (listing.complete) return "";
    const total = listing.totalResults === null ? "no total" : `${listing.totalResults} in total`;
    return ` — INCOMPLETE: stopped after ${listing.pages} page(s) (${STOP_REASONS[listing.stoppedBecause] ?? listing.stoppedBecause}); ` +
        `Autodesk reports ${total}, ${listing.results.length} listed`;
}

/** The pagination object the list tools return: Autodesk's keys where callers already read them, plus ours. */
export function mergedPagination(listing) {
    return {
        totalResults: listing.totalResults,
        offset: 0,
        limit: listing.pageSize,
        nextUrl: "",
        pages: listing.pages,
        complete: listing.complete,
        ...(listing.complete ? {} : { stoppedBecause: listing.stoppedBecause }),
    };
}

// ---------------------------------------------------------------------------
// Text formatting shared by the workflow tools
// ---------------------------------------------------------------------------

const DAY_WORDS = { WORKDAY: "working day(s)", CALENDAR_DAY: "calendar day(s)" };

function formatBucket(label, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return `${label} ${rows.map((r) => (r?.name ? `${r.name} (${r.autodeskId})` : String(r?.autodeskId))).join(", ")}`;
}

/** "users A (id), B (id); roles R (id); companies C (id)" — or "nobody" for an empty step. */
export function formatCandidates(candidates) {
    const parts = [
        formatBucket("users", candidates?.users),
        formatBucket("roles", candidates?.roles),
        formatBucket("companies", candidates?.companies),
    ].filter(Boolean);
    return parts.length ? parts.join("; ") : "nobody";
}

export function formatGroupReview(groupReview) {
    if (!groupReview?.enabled) return "group review: off (one reviewer acts)";
    if (groupReview.type === "ALL") return "group review: ALL assigned reviewers must respond";
    if (groupReview.type === "MINIMUM") return `group review: at least ${groupReview.min ?? "?"} must respond`;
    return `group review: on (${groupReview.type ?? "type not given"})`;
}

export function formatCopyOptions(copy) {
    if (!copy) return "copy on approval: not reported";
    if (!copy.enabled) return "copy on approval: OFF";
    const bits = [
        copy.condition === "ALL" ? "only when ALL files are approved" : copy.condition === "ANY" ? "when ANY file is approved" : `condition ${copy.condition ?? "not reported"}`,
        copy.includeMarkups ? "with markups" : "without markups",
        copy.allowOverride ? "the submitter may change the folder" : "the submitter may not change the folder",
    ];
    if (copy.disableOverrideMarkupSetting) bits.push("markup setting locked");
    return `copy on approval: ON → folder ${copy.folderUrn ?? "(no folder reported)"} (${bits.join("; ")})`;
}

/** One workflow as indented text lines: identity, each step (type, who, time, group review), the copy destination. */
export function formatWorkflow(w) {
    const lines = [`- "${w?.name ?? "?"}" — id ${w?.id ?? "?"} — ${w?.status ?? "status not reported"}`];
    for (const s of Array.isArray(w?.steps) ? w.steps : []) {
        let line = `    ${s.type ?? "?"} "${s.name ?? ""}" [${s.id ?? "no step id"}]: ${formatCandidates(s.candidates)}`;
        if (s.type !== "INITIATOR") {
            if (s.duration === undefined && !s.dueDateType) {
                line += " — time allowed not reported";
            } else {
                const days = DAY_WORDS[s.dueDateType] ?? (s.dueDateType ? s.dueDateType : "day type not reported");
                line += ` — ${s.duration ?? "?"} ${days}`;
            }
        }
        if (s.type === "REVIEWER") line += ` — ${formatGroupReview(s.groupReview)}`;
        lines.push(line);
    }
    lines.push(`    ${formatCopyOptions(w?.copyFilesOptions)}`);
    const custom = (Array.isArray(w?.approvalStatusOptions) ? w.approvalStatusOptions : []).filter((o) => !o.builtIn);
    if (custom.length) lines.push(`    extra approval statuses: ${custom.map((o) => `"${o.label}" (${o.value})`).join(", ")}`);
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Text formatting shared by the review tools
// ---------------------------------------------------------------------------

const person = (p) => (p?.name ? `${p.name} (${p.autodeskId})` : p?.autodeskId ? String(p.autodeskId) : null);
const day = (iso) => (typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null);

/** Who has to act next on a review: the people who claimed the step, else the step's candidates. */
export function formatNextActionBy(nextActionBy) {
    if (!nextActionBy) return "nobody (no step is waiting)";
    const claimed = (nextActionBy.claimedBy ?? []).map(person).filter(Boolean);
    if (claimed.length) return `claimed by ${claimed.join(", ")}`;
    const text = formatCandidates(nextActionBy.candidates);
    return text === "nobody" ? "nobody (no step is waiting)" : text;
}

/** One review as indented text lines: number, name, id, status, workflow, the waiting step and who acts next. */
export function formatReview(r) {
    const lines = [`- #${r?.sequenceId ?? "?"} "${r?.name ?? "?"}" — id ${r?.id ?? "?"} — ${r?.status ?? "status not reported"}${r?.archived ? " (archived)" : ""}`];
    lines.push(`    workflow ${r?.workflowId ?? "?"} | created ${day(r?.createdAt) ?? "?"} by ${person(r?.createdBy) ?? "?"}` +
        (day(r?.finishedAt) ? ` | finished ${day(r.finishedAt)}` : ""));
    if (r?.status === "OPEN") {
        lines.push(`    waiting at step ${r?.currentStepId ?? "?"}${day(r?.currentStepDueDate) ? ` (due ${day(r.currentStepDueDate)})` : ""}: ${formatNextActionBy(r?.nextActionBy)}`);
    }
    const approver = person(r?.approvedBy);
    if (approver) lines.push(`    final decision by ${approver}${day(r?.approvedAt) ? ` on ${day(r.approvedAt)}` : ""}`);
    return lines.join("\n");
}
