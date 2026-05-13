import { z } from "zod";
import { dataManagementClient } from "../utils.js";

export const renameFolderTool = {
    title: "Rename Folder",
    description: `
        Renames an existing folder in an Autodesk Construction Cloud (ACC) project.
        Wraps PATCH /data/v1/projects/{projectId}/folders/{folderId} on the Data
        Management API. Requires projectId (WITH "b." prefix), folderId (URN —
        the "urn:adsk.wipprodanz:fs.folder:co.XXXX" string), and newName.

        Folder URNs are immutable: renaming does NOT change the folderId, and
        all child folders/items keep their URN references intact. Path strings
        in any external maps (e.g. folder-id-map.json) become stale and should
        be regenerated after a batch of renames.

        Cannot rename the root "Project Files" folder.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        folderId: z.string().nonempty(),
        newName: z.string().nonempty(),
    },
    callback: async ({ projectId, folderId, newName }) => {
        const payload = {
            jsonapi: { version: "1.0" },
            data: {
                type: "folders",
                id: folderId,
                attributes: {
                    name: newName,
                    extension: {
                        type: "folders:autodesk.bim360:Folder",
                        version: "1.0",
                    },
                },
            },
        };
        const result = await dataManagementClient.patchFolder(projectId, folderId, payload);
        const name = result.data?.attributes?.displayName || result.data?.attributes?.name || newName;
        const id = result.data?.id;
        return {
            content: [{ type: "text", text: `Folder renamed to "${name}" (ID: ${id}).` }],
            structuredContent: { result },
        };
    },
};
