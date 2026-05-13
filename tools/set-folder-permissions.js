import { z } from "zod";
import { getAccessToken } from "../utils.js";

export const setFolderPermissionsTool = {
    title: "Set Folder Permissions",
    description: `
        Sets folder permissions for one or more users/roles/companies in an ACC project.
        Requires projectId (with "b." prefix), folderId, and a permissions array.
        Each permission entry needs: subjectId (user's project member ID), subjectType ("USER", "ROLE", or "COMPANY"), and actions array.

        Available actions (combine as needed):
        - View Only: ["VIEW", "COLLABORATE"]
        - View + Download: ["VIEW", "DOWNLOAD", "COLLABORATE"]
        - View + Download + Upload + Edit: ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "EDIT"]
        - Full Control: ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "EDIT", "CONTROL"]

        Note: ACC requires EDIT whenever PUBLISH (upload) is included. "Upload Only" and
        "View + Download + Upload" are not valid — use "View + Download + Upload + Edit" instead.

        Use getProjectUsers to find the user's project member ID (the "id" field).
        Cannot modify root folder permissions.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        folderId: z.string().nonempty(),
        permissions: z.array(z.object({
            subjectId: z.string().nonempty(),
            subjectType: z.enum(["USER", "ROLE", "COMPANY"]),
            actions: z.array(z.string().nonempty())
        }))
    },
    callback: async ({ projectId, folderId, permissions }) => {
        // Validate: PUBLISH requires EDIT (ACC constraint)
        for (const p of permissions) {
            if (p.actions.includes("PUBLISH") && !p.actions.includes("EDIT")) {
                throw new Error(
                    `Invalid permission set for subject ${p.subjectId}: PUBLISH (upload) requires EDIT. ` +
                    `Use "View + Download + Upload + Edit" instead of "View + Download + Upload".`
                );
            }
        }

        const token = await getAccessToken();
        const baseUrl = `https://developer.api.autodesk.com/bim360/docs/v1/projects/${projectId}/folders/${folderId}`;
        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        };

        // Check if any permission entry needs EDIT or CONTROL
        const needsUpdate = permissions.some(p =>
            p.actions.includes("EDIT") || p.actions.includes("CONTROL")
        );

        if (needsUpdate) {
            // Two-step: batch-create doesn't support EDIT/CONTROL,
            // so first create with safe actions, then batch-update to full set.

            // Step 1: Create with safe actions to establish the permission entry
            // Note: batch-create uses UPLOAD; batch-update uses PUBLISH
            const safePerms = permissions.map(p => ({
                ...p,
                actions: ["VIEW", "DOWNLOAD", "COLLABORATE", "UPLOAD"]
            }));
            const createResp = await fetch(`${baseUrl}/permissions:batch-create`, {
                method: "POST",
                headers,
                body: JSON.stringify(safePerms)
            });
            if (!createResp.ok) {
                // Ignore create errors — the permission entry may already exist.
                // We proceed to batch-update regardless.
                await createResp.text(); // consume the response body
            }

            // Step 2: Update to the full action set with EDIT/CONTROL
            // batch-update uses PUBLISH instead of UPLOAD
            const updatePerms = permissions.map(p => ({
                ...p,
                actions: p.actions.map(a => a === "UPLOAD" ? "PUBLISH" : a)
            }));
            const updateResp = await fetch(`${baseUrl}/permissions:batch-update`, {
                method: "POST",
                headers,
                body: JSON.stringify(updatePerms)
            });
            if (!updateResp.ok) {
                const err = await updateResp.text();
                throw new Error(`Failed to update permissions (${updateResp.status}): ${err}`);
            }
            const result = await updateResp.json();
            const count = result.results?.length || 0;

            return {
                content: [{ type: "text", text: `Successfully set permissions for ${count} subject(s) (created + updated to EDIT/CONTROL level).` }],
                structuredContent: { result }
            };
        } else {
            // Direct create — no EDIT/CONTROL needed
            const resp = await fetch(`${baseUrl}/permissions:batch-create`, {
                method: "POST",
                headers,
                body: JSON.stringify(permissions)
            });
            if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`Failed to set folder permissions (${resp.status}): ${err}`);
            }
            const result = await resp.json();
            const count = result.results?.length || 0;

            return {
                content: [{ type: "text", text: `Successfully set permissions for ${count} subject(s).` }],
                structuredContent: { result }
            };
        }
    }
};
