import { z } from "zod";
import { getAccessToken } from "../utils.js";

export const getProjectRolesTool = {
    title: "Get Project Roles",
    description: `
        Retrieves all configured project roles (industry roles) for an Autodesk Construction Cloud (ACC) project.
        Returns the full role catalogue including roles with no assigned users — distinct from getProjectUsersTool,
        which only surfaces roles that have at least one user assigned.

        Requires accountId and projectId (both WITHOUT the "b." prefix — these are HQ v2 endpoint IDs).
        Returns each role's id (used as subjectId for setFolderPermissionsTool when subjectType="ROLE"),
        name (matches Permissions sheet role names in the PTP project setup template), and status.

        Backed by the legacy HQ v2 industry_roles endpoint, which fills the gap left by the ACC Admin SDK
        not exposing project-role enumeration directly. Uses the standard SSA bearer token.
    `,
    inputSchema: {
        accountId: z.string().trim().min(1).refine((v) => !v.startsWith("b."), {
            message: 'accountId must be an HQ v2 ID without the "b." prefix'
        }),
        projectId: z.string().trim().min(1).refine((v) => !v.startsWith("b."), {
            message: 'projectId must be an HQ v2 ID without the "b." prefix'
        })
    },
    callback: async ({ accountId, projectId }) => {
        const url = `https://developer.api.autodesk.com/hq/v2/accounts/${accountId}/projects/${projectId}/industry_roles`;
        const token = await getAccessToken();
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`getProjectRolesTool: HTTP ${res.status} ${res.statusText}: ${body}`);
        }
        const roles = await res.json();
        if (!Array.isArray(roles)) {
            throw new Error(`getProjectRolesTool: unexpected response shape (expected array, got ${typeof roles})`);
        }
        const rolesArray = roles;
        const lines = rolesArray.map((r) => {
            const status = r.status && r.status !== "active" ? `  [${r.status}]` : "";
            return `- ${r.name} (ID: ${r.id})${status}`;
        });
        const text = `Found ${rolesArray.length} role(s):\n${lines.join("\n")}`;
        return {
            content: [{ type: "text", text }],
            structuredContent: { roles: rolesArray }
        };
    }
};
