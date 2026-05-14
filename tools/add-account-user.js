import { z } from "zod";
import { adminClient } from "../utils.js";
import { ACC_REGION } from "../config.js";

export const addAccountUserTool = {
    title: "Add Account User",
    description: `
        Adds a user to the ACC account (hub-level). This makes them available to be assigned to projects.
        Requires accountId and email. Optional: firstName, lastName, companyId.
        The accountId should NOT include the "b." prefix.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        email: z.string().nonempty(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        companyId: z.string().optional()
    },
    callback: async ({ accountId, email, firstName, lastName, companyId }) => {
        const payload = { email };
        if (firstName) payload.first_name = firstName;
        if (lastName) payload.last_name = lastName;
        if (companyId) payload.company_id = companyId;

        const result = await adminClient.createUser(accountId, payload, { region: ACC_REGION || 'AUS' });
        const name = [result.first_name, result.last_name].filter(Boolean).join(' ') || result.email;
        return {
            content: [{ type: "text", text: `User "${name}" (${result.email}) added to account (ID: ${result.id}).` }],
            structuredContent: { result }
        };
    }
};
