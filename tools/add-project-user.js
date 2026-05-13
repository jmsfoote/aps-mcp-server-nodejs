import { z } from "zod";
import { adminClient } from "../utils.js";
import { ACC_REGION } from "../config.js";

export const addProjectUserTool = {
    title: "Add Project User",
    description: `
        Adds a user to a specific ACC project. The user must already exist in the account (use addAccountUser first).
        Requires projectId and email. Optional: roleIds (array of role IDs), products (array of product access objects).
        The projectId should NOT include the "b." prefix.
        If no products are specified, defaults to Document Management with member-level access.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        email: z.string().nonempty(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        companyId: z.string().optional(),
        roleIds: z.array(z.string()).optional()
    },
    callback: async ({ projectId, email, firstName, lastName, companyId, roleIds }) => {
        const user = { email };
        if (firstName) user.firstName = firstName;
        if (lastName) user.lastName = lastName;
        if (companyId) user.companyId = companyId;
        if (roleIds) user.roleIds = roleIds;

        // Default product access: Docs (Document Management) at member level
        user.products = [{
            key: 'docs',
            access: 'member'
        }];

        const payload = { users: [user] };

        const result = await adminClient.importProjectUsers(projectId, payload, { region: ACC_REGION || 'AUS' });
        const successCount = result.success || 0;
        const failureCount = result.failure || 0;

        let text;
        if (successCount > 0) {
            text = `User "${email}" added to project successfully.`;
        } else {
            const errors = result.success_items?.[0]?.errors || result.failure_items?.[0]?.errors || [];
            text = `Failed to add user "${email}". Errors: ${JSON.stringify(errors)}`;
        }

        return {
            content: [{ type: "text", text }],
            structuredContent: { result }
        };
    }
};
