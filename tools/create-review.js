import { z } from "zod";
import { reviewsApiCall } from "./reviews-helpers.js";

export const createReviewTool = {
    title: "Create Review",
    description: `Attach a review workflow to a specific document version in ACC Docs.
This starts the review process — the first step's candidates will be notified.
The projectId MUST include the "b." prefix.
Use getReviewWorkflowsTool first to get the workflowId.`,
    inputSchema: {
        projectId: z.string().nonempty()
            .describe('The project ID with "b." prefix'),
        workflowId: z.string().nonempty()
            .describe("The review workflow ID to attach"),
        name: z.string().nonempty()
            .describe("Review name, e.g. 'PA-001 Review'"),
        description: z.string().optional()
            .describe("Description of what's being reviewed"),
        documentVersionId: z.string().nonempty()
            .describe("The document version ID to attach the review to"),
    },
    callback: async ({ projectId, workflowId, name, description, documentVersionId }) => {
        const body = {
            workflowId,
            name,
            description: description || "",
            documentVersionId,
        };

        const result = await reviewsApiCall(
            "POST",
            `/projects/${projectId}/reviews`,
            body
        );

        return {
            content: [{
                type: "text",
                text: `Created review "${name}" using workflow ${workflowId}. Review ID: ${result.id || "see structuredContent"}`,
            }],
            structuredContent: { result },
        };
    },
};