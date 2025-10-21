import { z } from "zod";
import { dataManagementClient } from "../utils.js";

export const getDesignVersionsTool = {
    title: "Get Design Versions",
    description: `
        Retrieves all versions of a specific design within an Autodesk Construction Cloud (ACC) project.
        Requires projectId and designId parameters.
        Returns a structured list of versions with their last modified time and URN.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        designId: z.string().nonempty()
    },
    callback: async ({ projectId, designId }) => {
        const versions = await dataManagementClient.getItemVersions(projectId, designId).then(res => res.data || []);
        const lines = versions.map(version => {
            const urn = version.relationships?.derivatives?.data?.id || "N/A";
            return `- Version: ${version.attributes.lastModifiedTime} (URN: ${urn})`;
        });
        return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: { versions }
        };
    }
};
