import { z } from "zod";
import { getTwoLeggedToken } from "../utils.js";

// HQ v2 account and project ids are UUIDs (the hub / project ids from
// getProjectsTool minus the "b." prefix). Checking the shape also keeps
// path-altering values ("../", "#", "?", "/") out of the URL built below.
const HQ_V2_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hqV2Id = (name) => z.string().trim().refine((v) => HQ_V2_UUID.test(v), {
    message: `${name} must be an HQ v2 ID without the "b." prefix (a UUID such as 9dbb160e-b904-458b-bc5c-ed184687592d)`
});

export const getProjectRolesTool = {
    title: "Get Project Roles",
    description: `
        Retrieves all configured project roles (industry roles) for an Autodesk Construction Cloud (ACC) / Forma project.
        Returns the full role catalogue including roles with no assigned users. Distinct from getProjectUsersTool,
        which returns project members (roles surface only as a sub-attribute on each user).

        Requires accountId and projectId (both WITHOUT the "b." prefix — these are HQ v2 endpoint IDs, i.e. plain UUIDs).
        Returns each role's id (used as subjectId for setFolderPermissionsTool when subjectType="ROLE", and as
        assignedTo for createIssueTool when assignedToType="role"), name (matches Permissions sheet role names in the
        PTP project setup template), status, and member_group_id (the role's Autodesk ID).

        Backed by the legacy HQ v2 industry_roles endpoint (scope account:read), which fills the gap left by the
        ACC Admin SDK not exposing project-role enumeration. The APS reference marks it BIM 360-only, but it does
        return the role catalogue for ACC / Forma projects. Authenticates with the 2-legged client-credentials token,
        NOT the SSA token: on an AUS-region ACC hub where the service account is a project admin, the SSA token got
        HTTP 403 {"code":1003,"message":"The user does not have access to this project."} while the 2-legged token
        returned every role on the identical URL (verified 2026-11-02). The plain US-form URI works for that hub —
        no region path segment or Region header needed.
    `,
    inputSchema: {
        accountId: hqV2Id("accountId"),
        projectId: hqV2Id("projectId")
    },
    callback: async ({ accountId, projectId }) => {
        const url = `https://developer.api.autodesk.com/hq/v2/accounts/${accountId}/projects/${projectId}/industry_roles`;
        // 2-legged (client_credentials) token: the SSA token is rejected with 403/1003 on at
        // least one ACC hub where the service account is a project admin (see description).
        const token = await getTwoLeggedToken(["account:read"]);
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
