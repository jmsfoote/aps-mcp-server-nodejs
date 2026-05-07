import { z } from "zod";
import { dataManagementClient } from "../utils.js";

export const getFolderContentsTool = {
    title: "Get Folder Contents",
    description: `
        Retrieves the contents of a folder within an Autodesk Construction Cloud (ACC) project.
        Requires accountId and projectId parameters. If no folderId is provided, returns the top-level folders of the project.
        Returns the list of folders and files with their IDs and names.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        projectId: z.string().nonempty(),
        folderId: z.string().optional()
    },
    callback: async ({ accountId, projectId, folderId }) => {
        const contents = folderId
            ? await dataManagementClient.getFolderContents(projectId, folderId).then(res => res.data || [])
            : await dataManagementClient.getProjectTopFolders(accountId, projectId).then(res => res.data || []);
        const result = {
            contents: contents.map(item => ({ id: item.id, type: item.type, name: item.attributes.displayName }))
        };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    }
};
