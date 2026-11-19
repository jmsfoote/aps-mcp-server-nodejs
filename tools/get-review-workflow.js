import { reviewsApiCall, reviewsProjectId, reviewsUuid, notFoundById, formatWorkflow } from "./reviews-helpers.js";

export const getReviewWorkflowTool = {
    title: "Get Review Workflow",
    description: `Read ONE review (approval) workflow of an ACC / Forma project in full, by its id. Read-only.
Use getReviewWorkflowsTool to list workflows and find the id.
The projectId is the project UUID; the "b." prefix is accepted and optional. workflowId is the workflow's UUID.

Text output: name, id, status, every step (type, step id, who may act with ids, time allowed and whether working
or calendar days, group review), the copy-on-approval destination, and any extra approval statuses.
structuredContent.result = Autodesk's workflow record (name, description, notes, id, status, steps[],
copyFilesOptions, approvalStatusOptions, attachedAttributes, updateAttributesOptions, additionalOptions,
createdAt, updatedAt). A step carries no groupReview key when group review is off. The step ids here are what
createReviewTool needs to override who acts on a step.

A workflow cannot be changed, switched off or deleted through this server: that is done by hand in Forma.`,
    inputSchema: {
        projectId: reviewsProjectId()
            .describe('The project UUID, with or without the "b." prefix'),
        workflowId: reviewsUuid("workflowId")
            .describe("The workflow's id (UUID), from getReviewWorkflowsTool"),
    },
    callback: async ({ projectId, workflowId }) => {
        const path = `/projects/${projectId}/workflows/${workflowId}`;
        const result = await reviewsApiCall("GET", path, null, {
            notFoundMessage: notFoundById("GET", path, "workflow", workflowId),
        });
        return {
            content: [{ type: "text", text: formatWorkflow(result) }],
            structuredContent: { result },
        };
    },
};
