import { z } from "zod";
import { adminClient } from "../utils.js";
import { ACC_REGION } from "../config.js";

export const getProjectUsersTool = {
    title: "Get Project Users",
    description: `
        Lists all users in a specific ACC project.
        Requires projectId (without "b." prefix).
        Returns user names, emails, roles, companies, and status.
    `,
    inputSchema: {
        projectId: z.string().nonempty()
    },
    callback: async ({ projectId }) => {
        const result = await adminClient.getProjectUsers(projectId, { region: ACC_REGION || 'AUS', limit: 100 });
        const users = result.results || result || [];
        const lines = users.map(u => {
            const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown';
            return `- ${name} (${u.email}) — ${u.status || 'unknown status'}`;
        });

        return {
            content: [{ type: "text", text: `Found ${lines.length} users:\n${lines.join('\n')}` }],
            structuredContent: { result }
        };
    }
};
