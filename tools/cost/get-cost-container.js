import { z } from "zod";
import { costApiCall } from "./cost-helpers.js";
import { ACC_COST_CONTAINER_ID } from "../../config.js";

export const getCostContainerTool = {
    title: "Get Cost Container",
    description:
        "Resolve and verify the ACC Cost Management container ID for a project. " +
        "The container ID is required by all other cost tools. " +
        "In many cases the project ID (without 'b.' prefix) is the container ID. " +
        "If ACC_COST_CONTAINER_ID is set in the environment, it will be used automatically.",
    inputSchema: {
        projectId: z
            .string()
            .nonempty()
            .describe("ACC project ID (with or without 'b.' prefix)"),
        containerId: z
            .string()
            .optional()
            .describe("Explicit container ID if already known (skips resolution)"),
    },
    callback: async ({ projectId, containerId }) => {
        // Build candidate list in priority order
        const candidates = [];

        if (containerId) {
            candidates.push({ id: containerId, source: "explicit parameter" });
        }
        if (ACC_COST_CONTAINER_ID) {
            candidates.push({ id: ACC_COST_CONTAINER_ID, source: "ACC_COST_CONTAINER_ID env var" });
        }

        const stripped = projectId.replace("b.", "");
        candidates.push({ id: stripped, source: "projectId (b. prefix stripped)" });

        if (stripped !== projectId) {
            candidates.push({ id: projectId, source: "projectId (as-is with b. prefix)" });
        }

        // Try each candidate until one works
        const tried = [];
        for (const candidate of candidates) {
            const result = await costApiCall("GET", candidate.id, "properties");
            if (!result.error) {
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                `Cost container resolved successfully.\n` +
                                `Container ID: ${candidate.id}\n` +
                                `Source: ${candidate.source}\n` +
                                `Use this containerId with all other cost tools.`,
                        },
                    ],
                    structuredContent: {
                        containerId: candidate.id,
                        source: candidate.source,
                        properties: result.data,
                    },
                };
            }
            tried.push(`  - ${candidate.id} (${candidate.source}): ${result.status} — ${result.message}`);
        }

        // All candidates failed
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Could not resolve a valid Cost container for project ${projectId}.\n\n` +
                        `Tried:\n${tried.join("\n")}\n\n` +
                        `Troubleshooting:\n` +
                        `1. Is the Cost Management module activated on this project?\n` +
                        `2. Does the service account have Cost permissions in ACC Admin > Custom Integrations?\n` +
                        `3. Is the x-ads-region correct? (Currently: ${process.env.ACC_ADS_REGION || "not set"})\n` +
                        `4. Try providing an explicit containerId if you know it.`,
                },
            ],
            structuredContent: { error: true, tried },
        };
    },
};
