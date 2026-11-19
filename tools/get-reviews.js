import { z } from "zod";
import {
    reviewsApiCall, reviewsProjectId, reviewsUuid, reviewsQuery, fetchAllReviewsPages,
    incompleteNote, mergedPagination, formatReview,
} from "./reviews-helpers.js";

const STATUSES = ["OPEN", "CLOSED", "VOID", "FAILED"];
const SORT_FIELDS = ["name", "status", "sequenceId", "currentStepDueDate", "createdAt", "finishedAt"];
const DATE_RANGE_FILTERS = ["currentStepDueDate", "createdAt", "updatedAt", "finishedAt", "approvedAt", "archivedAt"];
// "start..end", both ISO 8601 (a date or a date-time), as the reference page gives it: 2023-06-01..2023-06-30
const DATE_RANGE = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2})?)?\.\.\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

const dateRange = (name) => z.string().optional()
    .describe(`Only reviews whose ${name} falls in a range, as "start..end" in ISO 8601, e.g. "2026-11-01..2026-11-30".`);

export const getReviewsTool = {
    title: "Get Reviews",
    description: `List the reviews in an ACC / Forma project, with every filter the Reviews API offers. Read-only.
Pages through the API (50 per page, its maximum) until every matching review has been returned.
The projectId is the project UUID; the "b." prefix is accepted and optional.

status: "open", "closed", "void" or "failed" (any letter case); "all" or omitted = no status filter.
Archived reviews are NOT included unless archived is true (then ONLY archived reviews are listed).
Other filters: workflowId; name (contains, case-insensitive); sequenceId (the number shown in Forma);
nextActionByUser / nextActionByRole / nextActionByCompany (who has to act next); approvedBy (up to 10 user ids);
archivedBy (with archived: true); date ranges "start..end" for createdAt, updatedAt, finishedAt, approvedAt,
currentStepDueDate and archivedAt (with archived: true). sort: name, status, sequenceId, currentStepDueDate,
createdAt or finishedAt, optionally followed by " desc".

Text output per review: number, name, id (the UUID the other review tools need), status, workflow id, when and by
whom it was created, and for an open review the step it is waiting at and who acts next.
structuredContent.result = { results: [every review, all pages merged], pagination: { totalResults, limit,
offset, nextUrl, pages, complete } }. If the listing could not be completed the text says INCOMPLETE and
pagination.complete is false — do not treat it as the whole set.

A review cannot be voided, closed, edited or advanced through this server; that is done in Forma.`,
    inputSchema: {
        projectId: reviewsProjectId()
            .describe('The project UUID, with or without the "b." prefix'),
        status: z.string().optional()
            .describe("Filter by status: 'open', 'closed', 'void', 'failed' (any case), or 'all' (default: all)"),
        workflowId: reviewsUuid("workflowId").optional()
            .describe("Only reviews started with this workflow"),
        name: z.string().optional()
            .describe("Only reviews whose name contains this text (case-insensitive)"),
        sequenceId: z.number().int().positive().optional()
            .describe("The review number shown in Forma (Autodesk matches it partially)"),
        nextActionByUser: z.string().optional().describe("Only reviews waiting on this user (Autodesk user id)"),
        nextActionByRole: z.string().optional().describe("Only reviews waiting on this role (member-group id)"),
        nextActionByCompany: z.string().optional().describe("Only reviews waiting on this company (member-group id)"),
        archived: z.boolean().optional()
            .describe("true = ONLY archived reviews; false or omitted = only reviews that are not archived"),
        archivedBy: z.string().optional().describe("Only reviews archived by this user (needs archived: true)"),
        approvedBy: z.array(z.string().nonempty()).min(1).max(10).optional()
            .describe("Only reviews given their final decision by one of these users (up to 10 Autodesk user ids)"),
        createdAt: dateRange("createdAt"),
        updatedAt: dateRange("updatedAt"),
        finishedAt: dateRange("finishedAt"),
        approvedAt: dateRange("approvedAt"),
        currentStepDueDate: dateRange("currentStepDueDate"),
        archivedAt: dateRange("archivedAt (needs archived: true)"),
        sort: z.string().optional()
            .describe('Sort field: name, status, sequenceId, currentStepDueDate, createdAt or finishedAt, optionally with " desc"'),
    },
    callback: async (args) => {
        const { projectId, status, archived, sort } = args;

        let apiStatus;
        if (status !== undefined && status !== null && status !== "") {
            const upper = String(status).trim().toUpperCase();
            if (upper !== "ALL") {
                if (!STATUSES.includes(upper)) {
                    throw new Error(`getReviewsTool: status "${status}" is not one of open, closed, void, failed or all.`);
                }
                apiStatus = upper;
            }
        }
        for (const field of ["archivedBy", "archivedAt"]) {
            if (args[field] !== undefined && archived !== true) {
                throw new Error(`getReviewsTool: ${field} only applies to archived reviews — pass archived: true with it.`);
            }
        }
        for (const field of DATE_RANGE_FILTERS) {
            if (args[field] !== undefined && !DATE_RANGE.test(args[field])) {
                throw new Error(`getReviewsTool: ${field} must be a range "start..end" in ISO 8601, e.g. "2026-11-01..2026-11-30" (got "${args[field]}").`);
            }
        }
        let apiSort;
        if (sort !== undefined) {
            const [field, direction, ...rest] = sort.trim().split(/\s+/);
            if (!SORT_FIELDS.includes(field) || rest.length || (direction !== undefined && direction !== "desc")) {
                throw new Error(`getReviewsTool: sort must be one of ${SORT_FIELDS.join(", ")}, optionally followed by " desc" (got "${sort}").`);
            }
            apiSort = direction ? `${field} desc` : field;
        }

        const filters = [
            ["filter[status]", apiStatus],
            ["filter[workflowId]", args.workflowId],
            ["filter[name]", args.name],
            ["filter[sequenceId]", args.sequenceId],
            ["filter[nextActionByUser]", args.nextActionByUser],
            ["filter[nextActionByRole]", args.nextActionByRole],
            ["filter[nextActionByCompany]", args.nextActionByCompany],
            ["filter[archived]", archived === undefined ? undefined : String(archived)],
            ["filter[archivedBy]", args.archivedBy],
            ["filter[approvedBy]", args.approvedBy?.join(",")],
            ...DATE_RANGE_FILTERS.map((field) => [`filter[${field}]`, args[field]]),
            ["sort", apiSort],
        ];

        const listing = await fetchAllReviewsPages((offset, limit) => reviewsApiCall(
            "GET",
            `/projects/${projectId}/reviews` + reviewsQuery([["limit", limit], ["offset", offset], ...filters]),
        ));
        const reviews = listing.results;

        const header = `Found ${reviews.length} review(s)${incompleteNote(listing)}`;
        const text = reviews.length ? `${header}:\n${reviews.map(formatReview).join("\n")}` : header;

        return {
            content: [{ type: "text", text }],
            structuredContent: { result: { results: reviews, pagination: mergedPagination(listing) } },
        };
    },
};
