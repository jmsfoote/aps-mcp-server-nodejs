import { z } from "zod";
import { issuesClient } from "../utils.js";

export const getIssueTypesTool = {
    title: "Get Issue Types",
    description: `
        Retrieves all configured issue types available in an Autodesk Construction Cloud (ACC) project.
        Requires a projectId parameter. Returns the list of issue types with their IDs, titles, and subtypes.
    `,
    inputSchema: {
        projectId: z.string().nonempty()
    },
    callback: async ({ projectId }) => {
        const issueTypes = await issuesClient.getIssuesTypes(projectId.replace("b.", ""), { include: "subtypes" }).then(res => res.results || []);
        const result = {
            issueTypes: issueTypes.map(t => ({
                id: t.id,
                title: t.title,
                subtypes: (t.subtypes || []).map(s => ({ id: s.id, title: s.title }))
            }))
        };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    }
};
