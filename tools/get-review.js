import { reviewsApiCall, reviewsProjectId, reviewsUuid, notFoundById, formatReview } from "./reviews-helpers.js";

export const getReviewTool = {
    title: "Get Review",
    description: `Read ONE review of an ACC / Forma project by its id. Read-only.
The projectId is the project UUID; the "b." prefix is accepted and optional. reviewId is the review's UUID — NOT
the number shown in Forma (find the UUID with getReviewsTool, e.g. by sequenceId).

Text output: number, name, id, status (OPEN, CLOSED, VOID or FAILED), workflow id, who created it and when, and
for an open review the step it is waiting at and who acts next. structuredContent.result = Autodesk's review
record. For what happened at each step use getReviewProgressTool; for the files and where approved copies went,
getReviewVersionsTool.

A review cannot be voided, closed, edited or advanced through this server; that is done in Forma.`,
    inputSchema: {
        projectId: reviewsProjectId().describe('The project UUID, with or without the "b." prefix'),
        reviewId: reviewsUuid("reviewId").describe("The review's id (UUID), from getReviewsTool — not the number shown in Forma"),
    },
    callback: async ({ projectId, reviewId }) => {
        const path = `/projects/${projectId}/reviews/${reviewId}`;
        const result = await reviewsApiCall("GET", path, null, { notFoundMessage: notFoundById("GET", path, "review", reviewId) });
        return {
            content: [{ type: "text", text: formatReview(result) }],
            structuredContent: { result },
        };
    },
};
