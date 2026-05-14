import { z } from "zod";
import { reviewsApiCall } from "./reviews-helpers.js";

export const getReviewWorkflowsTool = {
    title: "Get Review Workflows",
    description: `List all review workflows configured for an ACC project.
Returns workflow names, descriptions, and step details.
The projectId MUST include the "b." prefix.`,
    inputSchema: {
        projectId: z.string().nonempty()
            .describe('The project ID with "b." prefix, e.g. "b.abc123"'),
    },
    callback: async ({ projectId }) => {
        const result = await reviewsApiCall(
            "GET",
            `/projects/${projectId}/workflows`
        );

        const workflows = result.results || result;
        const summary = Array.isArray(workflows)
            ? `Found ${workflows.length} review workflow(s)`
            : "Retrieved review workflows";

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { result },
        };
    },
};