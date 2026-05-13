import { z } from "zod";
import { issuesClient } from "../utils.js";
import { ACC_ADS_REGION } from "../config.js";

export const createIssueTool = {
    title: "Create Issue",
    description: `
        Creates a new issue within an Autodesk Construction Cloud (ACC) project.
        Requires projectId, title, and issueSubtypeId.
        Optional: description, status (default: open), assignedTo, assignedToType (default: 'user'), dueDate.
        Note: Do NOT pass issueTypeId — it is inferred from the subtypeId.
        Use getIssueTypesTool first to find valid issueSubtypeId values.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        title: z.string().nonempty(),
        issueSubtypeId: z.string().nonempty(),
        description: z.string().optional(),
        status: z.string().optional(),
        assignedTo: z.string().optional(),
        assignedToType: z.enum(["user", "company", "role"]).optional(),
        dueDate: z.string().optional()
    },
    callback: async ({ projectId, title, issueSubtypeId, description, status, assignedTo, assignedToType, dueDate }) => {
        const payload = {
            title,
            issueSubtypeId,
            status: status || "open",
            published: true
        };
        if (description) payload.description = description;
        if (assignedTo) {
            payload.assignedTo = assignedTo;
            payload.assignedToType = assignedToType || "user";
        }
        if (dueDate) payload.dueDate = dueDate;

        const result = await issuesClient.createIssue(projectId, payload, { xAdsRegion: ACC_ADS_REGION || 'APAC' });
        return {
            content: [{ type: "text", text: `Issue "${result.title}" created successfully (ID: ${result.id}, #${result.displayId}).` }],
            structuredContent: { result }
        };
    }
};
