import { z } from "zod";
import { getAccessToken } from "../utils.js";

export const getFolderPermissionsTool = {
    title: "Get Folder Permissions",
    description: `
        Retrieves the permission assignments for a specific folder in an ACC project.
        Requires projectId (with "b." prefix) and folderId.
        Returns a list of users/roles/companies and their permission actions on the folder.
        Actions include: VIEW, DOWNLOAD, COLLABORATE, PUBLISH, EDIT, CONTROL.
        "actions" are directly assigned; "inheritActions" are inherited from parent folders.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        folderId: z.string().nonempty()
    },
    callback: async ({ projectId, folderId }) => {
        const token = await getAccessToken();
        const url = `https://developer.api.autodesk.com/bim360/docs/v1/projects/${projectId}/folders/${folderId}/permissions`;
        const resp = await fetch(url, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`Failed to get folder permissions (${resp.status}): ${err}`);
        }
        const permissions = await resp.json();

        const lines = permissions.map(p => {
            const direct = p.actions?.length ? p.actions.join(', ') : 'none';
            const inherited = p.inheritActions?.length ? p.inheritActions.join(', ') : 'none';
            return `- ${p.name} (${p.email}) [${p.subjectType}] — direct: ${direct} | inherited: ${inherited}`;
        });

        return {
            content: [{ type: "text", text: `Folder has ${permissions.length} permission entries:\n${lines.join('\n')}` }],
            structuredContent: { permissions }
        };
    }
};
