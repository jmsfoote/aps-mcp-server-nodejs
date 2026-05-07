import { dataManagementClient } from "../utils.js";

export const getProjectsTool = {
    title: "Get Accounts & Projects",
    description: `
        Retrieves all Autodesk Construction Cloud (ACC) accounts and their associated projects accessible to the configured service account.
        Returns a structured list of accounts (with account IDs and names) and associated projects (with project IDs and names).
    `,
    inputSchema: {},
    callback: async () => {
        const accounts = await dataManagementClient.getHubs().then(res => res.data || []);
        for (const account of accounts) {
            account.projects = await dataManagementClient.getHubProjects(account.id).then(res => res.data || []);
        }
        const result = {
            accounts: accounts.map(a => ({
                id: a.id,
                name: a.attributes.name,
                projects: (a.projects || []).map(p => ({ id: p.id, name: p.attributes.name }))
            }))
        };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    }
};
