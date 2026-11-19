import { reviewsApiCall, reviewsProjectId, reviewsUuid, notFoundById, formatWorkflow } from "./reviews-helpers.js";

export const getReviewWorkflowSnapshotTool = {
    title: "Get Review's Workflow Snapshot",
    description: `Read the workflow AS IT WAS WHEN ONE REVIEW WAS STARTED: the steps, candidates and copy settings that
review is actually running under, including any per-review overrides. Read-only. This can differ from the workflow's
current definition (getReviewWorkflowTool) if the workflow was edited in Forma afterwards or the review overrode a
step or the copy folder.
The projectId is the project UUID; the "b." prefix is accepted and optional. reviewId is the review's UUID, not the
number shown in Forma (NOT a workflow id).

Text output: the workflow's name and id, each step (type, step id, who may act), group review, the copy
destination. Autodesk's snapshot carries no status or dates, and its steps may carry no time allowed or day type.
structuredContent.result = the snapshot record.`,
    inputSchema: {
        projectId: reviewsProjectId().describe('The project UUID, with or without the "b." prefix'),
        reviewId: reviewsUuid("reviewId").describe("The review's id (UUID), from getReviewsTool"),
    },
    callback: async ({ projectId, reviewId }) => {
        const path = `/projects/${projectId}/reviews/${reviewId}/workflow`;
        const result = await reviewsApiCall("GET", path, null, { notFoundMessage: notFoundById("GET", path, "review", reviewId) });
        return {
            content: [{ type: "text", text: `Workflow snapshot for review ${reviewId}:\n${formatWorkflow({ status: "snapshot at review start", ...result })}` }],
            structuredContent: { result },
        };
    },
};
