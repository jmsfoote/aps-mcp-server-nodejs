import {
    reviewsApiCall, reviewsProjectId, reviewsUuid, reviewsQuery, notFoundById, fetchAllReviewsPages,
    incompleteNote, mergedPagination, formatCandidates,
} from "./reviews-helpers.js";

const person = (p) => (p?.name ? `${p.name} (${p.autodeskId})` : p?.autodeskId ? String(p.autodeskId) : null);

/** One progress row: the step, its state, who claimed or acted, when, and any note left. */
export function formatProgressRow(p) {
    const who = person(p?.actionBy) ? `by ${person(p.actionBy)}` : person(p?.claimedBy) ? `claimed by ${person(p.claimedBy)}` : `open to ${formatCandidates(p?.candidates)}`;
    const when = typeof p?.endTime === "string" ? ` at ${p.endTime}` : "";
    const notes = p?.notes ? ` — note: "${p.notes}"` : "";
    return `- ${p?.stepName ?? "?"} [${p?.stepId ?? "?"}]: ${p?.status ?? "?"} ${who}${when}${notes}`;
}

export const getReviewProgressTool = {
    title: "Get Review Progress",
    description: `Read the step-by-step progress of ONE review: which steps were submitted, claimed, left unclaimed
or voided, by whom and when. Read-only. Most recent action first; Autodesk returns the current round only (a review
sent back to its initiator starts a new round).
The projectId is the project UUID; the "b." prefix is accepted and optional. reviewId is the review's UUID, not the
number shown in Forma.

Row status: SUBMITTED (the step was completed — approved, rejected or passed on), CLAIMED (someone has taken it),
UNCLAIMED (waiting, nobody has taken it), VOID. Pages until complete; says INCOMPLETE if it could not.
structuredContent.result = { results: [...], pagination: { totalResults, pages, complete, … } }.

This only reads. A step cannot be claimed, completed, approved or rejected through this server.`,
    inputSchema: {
        projectId: reviewsProjectId().describe('The project UUID, with or without the "b." prefix'),
        reviewId: reviewsUuid("reviewId").describe("The review's id (UUID), from getReviewsTool"),
    },
    callback: async ({ projectId, reviewId }) => {
        const path = `/projects/${projectId}/reviews/${reviewId}/progress`;
        const listing = await fetchAllReviewsPages(
            (offset, limit) => reviewsApiCall("GET", path + reviewsQuery([["limit", limit], ["offset", offset]]), null, {
                notFoundMessage: notFoundById("GET", path, "review", reviewId),
            }),
            { idOf: () => undefined }, // progress rows carry no id of their own
        );
        const header = `Review ${reviewId}: ${listing.results.length} progress row(s)${incompleteNote(listing)}`;
        const text = listing.results.length ? `${header}:\n${listing.results.map(formatProgressRow).join("\n")}` : header;
        return {
            content: [{ type: "text", text }],
            structuredContent: { result: { results: listing.results, pagination: mergedPagination(listing) } },
        };
    },
};
