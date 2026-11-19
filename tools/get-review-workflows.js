import { z } from "zod";
import {
    reviewsApiCall, reviewsProjectId, reviewsQuery, fetchAllReviewsPages,
    incompleteNote, mergedPagination, formatWorkflow, REVIEWS_PAGE_SIZE,
} from "./reviews-helpers.js";

const STATUS_FILTER = { active: "ACTIVE", inactive: "INACTIVE" };
const SORT_FIELDS = ["name", "status", "updatedAt"];

/**
 * Every workflow of a project, all pages merged.
 *
 * status: undefined → Autodesk's default (ACTIVE only), no filter sent; "active" / "inactive" → that filter;
 * "all" → the ACTIVE listing followed by the INACTIVE listing (the API has no "both" filter).
 * Returns the merged listing in the shape of fetchAllReviewsPages; with "all", `complete` is true only when
 * both listings completed, and `totalResults` is their sum (null when either total is unknown).
 */
export async function fetchAllReviewWorkflows(projectId, { status, sort, initiatorOnly } = {}) {
    const listOne = (apiStatus) => fetchAllReviewsPages((offset, limit) => reviewsApiCall(
        "GET",
        `/projects/${projectId}/workflows` + reviewsQuery([
            ["limit", limit],
            ["offset", offset],
            ["filter[status]", apiStatus],
            ["filter[initiator]", initiatorOnly ? "true" : undefined],
            ["sort", sort],
        ]),
    ));

    if (status !== "all") return listOne(STATUS_FILTER[status]);

    const active = await listOne("ACTIVE");
    const inactive = await listOne("INACTIVE");
    const complete = active.complete && inactive.complete;
    const firstIncomplete = active.complete ? inactive : active;
    return {
        results: [...active.results, ...inactive.results],
        totalResults: active.totalResults === null || inactive.totalResults === null ? null : active.totalResults + inactive.totalResults,
        pages: active.pages + inactive.pages,
        pageSize: REVIEWS_PAGE_SIZE,
        complete,
        ...(complete ? {} : { stoppedBecause: firstIncomplete.stoppedBecause }),
    };
}

export const getReviewWorkflowsTool = {
    title: "Get Review Workflows",
    description: `List the review (approval) workflows of an ACC / Forma project. Read-only.
Pages through the Reviews API (50 per page, its maximum) until every workflow has been returned.
The projectId is the project UUID; the "b." prefix is accepted and optional.

status: omit it for Autodesk's default, which is ACTIVE workflows only. "active" / "inactive" filter explicitly;
"all" returns active and inactive together (two listings merged). A workflow switched off in Forma is INACTIVE and
is NOT in the default listing — use "all" when checking whether a name already exists.
sort: "name", "status" or "updatedAt", optionally followed by " desc" (not available with status "all").
initiatorOnly: true lists only workflows the calling account may start reviews with (Autodesk ignores it for
project admins, and it cannot be combined with status).

Text output per workflow: name, id, status, every step (type, step id, who may act with ids, time allowed and
whether working or calendar days, group review), the copy-on-approval destination, and any extra approval statuses.
structuredContent.result = { results: [every workflow, all pages merged], pagination: { totalResults, limit,
offset, nextUrl, pages, complete } }. If the listing could not be completed (page cap, a server that ignored
offset, or no total reported) the text says INCOMPLETE, pagination.complete is false and
pagination.stoppedBecause says why — do not treat an incomplete listing as the whole set.

A workflow cannot be changed, switched off or deleted through this server (Autodesk offers no such endpoint):
that is done by hand in Forma. A 404 means the Reviews module is not activated on the project.`,
    inputSchema: {
        projectId: reviewsProjectId()
            .describe('The project UUID, with or without the "b." prefix, e.g. "b.9dbb160e-b904-458b-bc5c-ed184687592d"'),
        status: z.enum(["active", "inactive", "all"]).optional()
            .describe('Which workflows to list. Omit for Autodesk\'s default (active only). "all" = active and inactive.'),
        sort: z.string().optional()
            .describe('Sort field: "name", "status" or "updatedAt", optionally with " desc" (e.g. "name desc").'),
        initiatorOnly: z.boolean().optional()
            .describe("true = only workflows the calling account may start reviews with. Cannot be combined with status."),
    },
    callback: async ({ projectId, status, sort, initiatorOnly }) => {
        if (initiatorOnly && status) {
            throw new Error("getReviewWorkflowsTool: initiatorOnly cannot be combined with status (Autodesk rejects filter[initiator] together with filter[status]).");
        }
        if (sort !== undefined) {
            const [field, direction, ...rest] = sort.trim().split(/\s+/);
            if (!SORT_FIELDS.includes(field) || rest.length || (direction !== undefined && direction !== "desc")) {
                throw new Error(`getReviewWorkflowsTool: sort must be one of ${SORT_FIELDS.join(", ")}, optionally followed by " desc" (got "${sort}").`);
            }
            if (status === "all") {
                throw new Error('getReviewWorkflowsTool: sort is not available with status "all" (two listings are merged). List "active" and "inactive" separately to sort.');
            }
            sort = direction ? `${field} desc` : field;
        }

        const listing = await fetchAllReviewWorkflows(projectId, { status, sort, initiatorOnly });
        const workflows = listing.results;

        const header = `Found ${workflows.length} review workflow(s)${incompleteNote(listing)}`;
        const text = workflows.length ? `${header}:\n${workflows.map(formatWorkflow).join("\n")}` : header;

        return {
            content: [{ type: "text", text }],
            structuredContent: { result: { results: workflows, pagination: mergedPagination(listing) } },
        };
    },
};
