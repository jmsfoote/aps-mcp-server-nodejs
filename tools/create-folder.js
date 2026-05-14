import { z } from "zod";
import { dataManagementClient } from "../utils.js";

export const createFolderTool = {
    title: "Create Folder",
    description: `
        Creates a new folder within an Autodesk Construction Cloud (ACC) project.
        Requires projectId, folderName, and parentFolderId (the folder to create inside).
        Returns the new folder's ID and name.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        folderName: z.string().nonempty(),
        parentFolderId: z.string().nonempty()
    },
    callback: async ({ projectId, folderName, parentFolderId }) => {
        const payload = {
            jsonapi: { version: "1.0" },
            data: {
                type: "folders",
                attributes: {
                    name: folderName,
                    extension: {
                        type: "folders:autodesk.bim360:Folder",
                        version: "1.0"
                    }
                },
                relationships: {
                    parent: {
                        data: {
                            type: "folders",
                            id: parentFolderId
                        }
                    }
                }
            }
        };

        const result = await dataManagementClient.createFolder(projectId, payload);
        const name = result.data?.attributes?.displayName || result.data?.attributes?.name || folderName;
        const id = result.data?.id;
        return {
            content: [{ type: "text", text: `Folder "${name}" created successfully (ID: ${id}).` }],
            structuredContent: { result }
        };
    }
};
