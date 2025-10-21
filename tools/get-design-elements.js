import yaml from "yaml";
import { z } from "zod";
import { modelDerivativeClient } from "../utils.js";

async function getObjectTree(versionUrn, guid) {
    let response = await modelDerivativeClient.getObjectTree(versionUrn, guid);
    while (response.isProcessing) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        response = await modelDerivativeClient.getObjectTree(versionUrn, guid);
    }
    return response.data.objects;
}

export const getDesignElementsTool = {
    title: "Get Design Elements",
    description: `
        Retrieves the object tree of a specific design version within an Autodesk Construction Cloud (ACC) project.
        Requires versionUrn parameter.
        Returns a structured list of design elements in YAML format.
    `,
    inputSchema: {
        versionUrn: z.string().nonempty(),
    },
    callback: async ({ versionUrn }) => {
        const views = await modelDerivativeClient.getModelViews(versionUrn).then(res => res.data.metadata);
        if (!views || views.length === 0) {
            throw new Error("No views found for the provided version URN.");
        }
        const objects = await getObjectTree(versionUrn, views[0].guid);
        return {
            content: [{ type: "text", text: yaml.stringify(objects) }],
            structuredContent: { objects }
        };
    }
};
