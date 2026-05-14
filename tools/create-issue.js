import { z } from "zod";
import { issuesClient } from "../utils.js";
import { ACC_ADS_REGION } from "../config.js";

export const createIssueTool = {
    title: "Create Issue",
    description: `
        Creates a new issue within an Autodesk Construction Cloud (ACC) project.

        Required: projectId, title, issueSubtypeId.

        Optional fields:
        - description: free-text body, max 10000 chars
        - status: defaults to "open" (other values per project config — use getIssueTypesTool to discover what's enabled)
        - assignedTo + assignedToType: assignee identifier and its type. assignedToType is one of "user" / "company" / "role". For "user", assignedTo must be an Autodesk account ID (autodeskId from getProjectUsersTool). For "company", a company UUID from accCompanyListTool. For "role", a role UUID from getProjectRolesTool. The XLSX template terminology "member" maps to "user" here.
        - dueDate: ISO 8601 date string (YYYY-MM-DD)
        - startDate: ISO 8601 date string (YYYY-MM-DD)
        - locationDetails: plain-text location description, max 8300 chars (free-form; for structured LBS location lookup use a future getLocationsTool, not yet available)

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
        dueDate: z.string().optional(),
        startDate: z.string().optional(),
        locationDetails: z.string().optional()
    },
    callback: async ({ projectId, title, issueSubtypeId, description, status, assignedTo, assignedToType, dueDate, startDate, locationDetails }) => {
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
        if (startDate) payload.startDate = startDate;
        if (locationDetails) payload.locationDetails = locationDetails;

        const result = await issuesClient.createIssue(projectId, payload, { xAdsRegion: ACC_ADS_REGION || 'APAC' });
        return {
            content: [{ type: "text", text: `Issue "${result.title}" created successfully (ID: ${result.id}, #${result.displayId}).` }],
            structuredContent: { result }
        };
    }
};
