import { z } from "zod";
import { reviewsApiCall } from "./reviews-helpers.js";

export const getReviewsTool = {
    title: "Get Reviews",
    description: `List reviews in an ACC project, optionally filtered by status.
Returns review names, statuses, workflow references, and progress.
The projectId MUST include the "b." prefix.`,
    inputSchema: {
        projectId: z.string().nonempty()
            .describe('The project ID with "b." prefix'),
        status: z.string().optional()
            .describe("Filter by status: 'open', 'closed', 'all' (default: all)"),
    },
    callback: async ({ projectId, status }) => {
        let path = `/projects/${projectId}/reviews`;
        if (status && status !== "all") {
            path += `?filter[status]=${status}`;
        }

        const result = await reviewsApiCall("GET", path);

        const reviews = result.results || result;
        const summary = Array.isArray(reviews)
            ? `Found ${reviews.length} review(s)`
            : "Retrieved reviews";

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { result },
        };
    },
};