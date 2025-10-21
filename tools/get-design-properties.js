import yaml from "yaml";
import { z } from "zod";
import { modelDerivativeClient } from "../utils.js";

async function getProperties(versionUrn, guid) {
    let response = await modelDerivativeClient.getAllProperties(versionUrn, guid);
    while (response.isProcessing) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        response = await modelDerivativeClient.getAllProperties(versionUrn, guid);
    }
    return response.data.collection;
}

export const getDesignPropertiesTool = {
    title: "Get Design Properties",
    description: `
        Retrieves all properties of a specific design version within an Autodesk Construction Cloud (ACC) project.
        Requires versionUrn parameter.
        Returns a structured list of properties in YAML format.
    `,
    inputSchema: {
        versionUrn: z.string().nonempty(),
    },
    callback: async ({ versionUrn }) => {
        const views = await modelDerivativeClient.getModelViews(versionUrn).then(res => res.data.metadata);
        if (!views || views.length === 0) {
            throw new Error("No views found for the provided version URN.");
        }
        const properties = await getProperties(versionUrn, views[0].guid);
        return {
            content: [{ type: "text", text: yaml.stringify(properties) }],
            structuredContent: { properties }
        };
    }
};
