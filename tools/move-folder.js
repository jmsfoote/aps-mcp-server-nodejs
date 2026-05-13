import { z } from "zod";
import { dataManagementClient } from "../utils.js";

export const moveFolderTool = {
    title: "Move Folder",
    description: `
        Moves a folder to a new parent folder within the same ACC project.
        Requires projectId, folderId (the folder to move), and targetFolderId (the destination parent folder).
        Returns confirmation of the move operation.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        folderId: z.string().nonempty(),
        targetFolderId: z.string().nonempty()
    },
    callback: async ({ projectId, folderId, targetFolderId }) => {
        const payload = {
            jsonapi: { version: "1.0" },
            data: {
                type: "folders",
                id: folderId,
                relationships: {
                    parent: {
                        data: {
                            type: "folders",
                            id: targetFolderId
                        }
                    }
                }
            }
        };

        const result = await dataManagementClient.patchFolder(projectId, folderId, payload);
        const name = result.data?.attributes?.displayName || result.data?.attributes?.name || folderId;
        return {
            content: [{ type: "text", text: `Folder "${name}" moved successfully.` }],
            structuredContent: { result }
        };
    }
};
