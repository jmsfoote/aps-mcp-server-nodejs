import { z } from "zod";
import { dataManagementClient } from "../utils.js";

export const getFolderContentsTool = {
    title: "Get Folder Contents",
    description: `
        Retrieves the contents of a folder within an Autodesk Construction Cloud (ACC) project.
        Requires projectId (Data Management form, with the "b." prefix). If folderId (a folder URN) is provided, returns
        that folder's contents and accountId is not needed. If no folderId is provided, returns the top-level folders of
        the project — accountId (the hub id, with or without the "b." prefix) is required for that case only.
        Returns the list of folders and files with their IDs and names.
    `,
    inputSchema: {
        accountId: z.string().optional(),
        projectId: z.string().nonempty(),
        folderId: z.string().optional()
    },
    callback: async ({ accountId, projectId, folderId }) => {
        let contents;
        if (folderId) {
            contents = await dataManagementClient.getFolderContents(projectId, folderId).then(res => res.data || []);
        } else {
            if (!accountId) {
                throw new Error("getFolderContentsTool: accountId is required when folderId is not provided (needed to list the project's top-level folders).");
            }
            const hubId = accountId.startsWith("b.") ? accountId : `b.${accountId}`;
            contents = await dataManagementClient.getProjectTopFolders(hubId, projectId).then(res => res.data || []);
        }
        const output = contents.map((item) => `- ${item.type === "folders" ? "Folder" : "File"}: ${item.attributes.displayName} (ID: ${item.id})`).join("\n");
        return {
            content: [{ type: "text", text: output }],
            structuredContent: { contents }
        };
    }
}
