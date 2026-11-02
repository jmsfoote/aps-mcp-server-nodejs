import { z } from "zod";
import { getAccessToken } from "../utils.js";

// Documented action vocabulary for the Document Management folder-permission
// endpoints (permissions:batch-create / permissions:batch-update / GET permissions).
// Source (JavaScript-rendered page — read it in a browser):
// https://aps.autodesk.com/en/docs/bim360/v1/reference/http/document-management-projects-project_id-folders-folder_id-permissionsbatch-create-POST/
// The API accepts these in any documented combination; the level tables below are
// the documented presets, NOT a constraint this tool enforces.
export const FOLDER_PERMISSION_ACTIONS = Object.freeze([
    "VIEW", "DOWNLOAD", "COLLABORATE", "PUBLISH", "PUBLISH_MARKUP", "EDIT", "CONTROL"
]);

// Permission level → actions for Forma / ACC projects (APS reference, six levels).
export const FORMA_PERMISSION_LEVELS = Object.freeze({
    "View Only": ["VIEW", "COLLABORATE"],
    "View/Download": ["VIEW", "DOWNLOAD", "COLLABORATE"],
    "View/Download+PublishMarkups": ["VIEW", "DOWNLOAD", "COLLABORATE", "PUBLISH_MARKUP"],
    "View/Download+PublishMarkups+Upload": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "PUBLISH_MARKUP"],
    "View/Download+PublishMarkups+Upload+Edit": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "PUBLISH_MARKUP", "EDIT"],
    "Full controller": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "PUBLISH_MARKUP", "EDIT", "CONTROL"]
});

// Permission level → actions for legacy BIM 360 Document Management projects (six levels).
export const BIM360_PERMISSION_LEVELS = Object.freeze({
    "View Only": ["VIEW", "COLLABORATE"],
    "View/Download": ["VIEW", "DOWNLOAD", "COLLABORATE"],
    "Upload Only": ["PUBLISH"],
    "View/Download+Upload": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE"],
    "View/Download+Upload+Edit": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "EDIT"],
    "Full controller": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "EDIT", "CONTROL"]
});

const subjectKey = (p) => `${p.subjectType}:${String(p.subjectId).toLowerCase()}`;

/**
 * Split the requested grants between the two endpoints the API requires.
 *
 *  - A subject that already holds DIRECT `actions` on this folder goes to
 *    permissions:batch-update ("replaces the permissions that were previously
 *    assigned to the user for this folder").
 *  - Every other subject — no entry at all, or `inheritActions` only — goes to
 *    permissions:batch-create ("if the user has not been assigned any permissions
 *    for the folder, you need to use the Assign permissions endpoint").
 *
 * `existing` is the GET …/permissions body: an array of
 * { subjectId, subjectType, actions, inheritActions, … }. Pure (no I/O), so the
 * routing can be checked against a live read-back without writing anything.
 */
export function planFolderPermissionWrites(existing, permissions) {
    const direct = new Set(
        (Array.isArray(existing) ? existing : [])
            .filter((row) => Array.isArray(row.actions) && row.actions.length > 0)
            .map(subjectKey)
    );
    const create = [];
    const update = [];
    for (const p of permissions) {
        (direct.has(subjectKey(p)) ? update : create).push(p);
    }
    return { create, update };
}

// Only the documented request fields reach the API (callers such as
// push-permissions.js carry bookkeeping keys on their entries). `actions` is
// forwarded exactly as given — same values, same order.
function toRequestBody(permissions) {
    return permissions.map(({ subjectId, subjectType, actions, autodeskId }) => ({
        subjectId,
        subjectType,
        ...(autodeskId ? { autodeskId } : {}),
        actions: [...actions]
    }));
}

export const setFolderPermissionsTool = {
    title: "Set Folder Permissions",
    description: `
        Sets folder permissions for one or more users, roles or companies on a folder in an ACC / Forma (or legacy BIM 360) project.
        Requires projectId (with "b." prefix), folderId (the folder URN) and a permissions array.
        Each entry needs: subjectId, subjectType ("USER", "ROLE" or "COMPANY") and actions (array); autodeskId is optional.

        actions are sent to the API exactly as given. The only validation is against the documented vocabulary:
        VIEW, DOWNLOAD, COLLABORATE, PUBLISH, PUBLISH_MARKUP, EDIT, CONTROL. Any documented combination is accepted —
        in particular PUBLISH without EDIT (Forma "View/Download+PublishMarkups+Upload"), and EDIT / CONTROL go to
        permissions:batch-create directly (no create-then-update two-step).

        Permission levels → actions (APS reference for permissions:batch-create):
        Forma / ACC projects:
        - View Only:                                VIEW, COLLABORATE
        - View/Download:                            VIEW, DOWNLOAD, COLLABORATE
        - View/Download+PublishMarkups:             VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP
        - View/Download+PublishMarkups+Upload:      PUBLISH, VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP
        - View/Download+PublishMarkups+Upload+Edit: PUBLISH, VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP, EDIT
        - Full controller:                          PUBLISH, VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP, EDIT, CONTROL
        Legacy BIM 360 Document Management projects:
        - View Only:                 VIEW, COLLABORATE
        - View/Download:             VIEW, DOWNLOAD, COLLABORATE
        - Upload Only:               PUBLISH
        - View/Download+Upload:      PUBLISH, VIEW, DOWNLOAD, COLLABORATE
        - View/Download+Upload+Edit: PUBLISH, VIEW, DOWNLOAD, COLLABORATE, EDIT
        - Full controller:           PUBLISH, VIEW, DOWNLOAD, COLLABORATE, EDIT, CONTROL

        How it writes: the tool first reads GET …/permissions for the folder. Subjects that already hold direct actions
        there are sent to permissions:batch-update (which replaces their set); every other subject — including ones that
        only inherit from a parent folder — is sent to permissions:batch-create. Returns a per-subject result with the
        operation used, the outcome, and the actions echoed by the API. If any subject was rejected, not echoed, or its
        request failed before a response was read (unconfirmed), the tool throws and the error message carries the full
        per-subject report. A subject's effective permissions are its direct actions plus inheritActions from parent
        folders; sub-folders inherit and cannot be set below the parent's level. Cannot modify root folder permissions.

        Subject ids: USER = project member id from getProjectUsersTool; ROLE = role id from getProjectRolesTool;
        COMPANY = company id from accCompanyListTool. The endpoints are "user context optional" (2-legged or SSA token):
        on an AUS-region hub, GET …/permissions returned 200 with both tokens and the batch-create writes used the SSA
        token, with no region path segment or header (verified 2026-11-02).
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        folderId: z.string().nonempty(),
        permissions: z.array(z.object({
            subjectId: z.string().nonempty(),
            subjectType: z.enum(["USER", "ROLE", "COMPANY"]),
            autodeskId: z.string().optional(),
            actions: z.array(z.enum(FOLDER_PERMISSION_ACTIONS)).nonempty()
        })).nonempty()
    },
    callback: async ({ projectId, folderId, permissions }) => {
        const token = await getAccessToken();
        const baseUrl = `https://developer.api.autodesk.com/bim360/docs/v1/projects/${projectId}/folders/${folderId}`;
        const authHeaders = { "Authorization": `Bearer ${token}` };

        // 1. The folder's current entries decide which endpoint each subject needs.
        const getResp = await fetch(`${baseUrl}/permissions`, { headers: authHeaders });
        if (!getResp.ok) {
            const err = await getResp.text();
            throw new Error(`Failed to read existing folder permissions (${getResp.status}): ${err}`);
        }
        const existing = await getResp.json();
        const { create, update } = planFolderPermissionWrites(existing, permissions);

        // 2. One POST per endpoint. Both are attempted even if the first failed, so the
        //    per-subject report reflects what the API actually did.
        const outcomes = new Map(); // subjectKey → { operation, status, actions?, httpStatus?, error? }
        const runBatch = async (operation, group) => {
            if (group.length === 0) return;
            const endpoint = operation === "update" ? "permissions:batch-update" : "permissions:batch-create";
            let resp;
            let body;
            try {
                resp = await fetch(`${baseUrl}/${endpoint}`, {
                    method: "POST",
                    headers: { ...authHeaders, "Content-Type": "application/json" },
                    body: JSON.stringify(toRequestBody(group))
                });
                body = resp.ok ? await resp.json() : await resp.text();
            } catch (e) {
                // The request itself failed (network error, dropped connection, unreadable
                // body): the API may or may not have applied this batch. Say so per subject
                // and let the other batch run, so the report still covers every subject.
                for (const p of group) {
                    outcomes.set(subjectKey(p), { operation, status: "unconfirmed", httpStatus: resp?.status ?? null, error: `${endpoint} request failed before a response was read (${e?.message ?? e}) — the API may or may not have applied this subject; read the folder back with getFolderPermissionsTool` });
                }
                return;
            }
            if (!resp.ok) {
                for (const p of group) {
                    outcomes.set(subjectKey(p), { operation, status: "error", httpStatus: resp.status, error: `${endpoint} failed (${resp.status}): ${body}` });
                }
                return;
            }
            const echoed = new Map((body?.results ?? []).map((r) => [String(r.subjectId).toLowerCase(), r]));
            for (const p of group) {
                const r = echoed.get(String(p.subjectId).toLowerCase());
                outcomes.set(subjectKey(p), r
                    ? { operation, status: "ok", httpStatus: resp.status, actions: r.actions }
                    : { operation, status: "not_echoed", httpStatus: resp.status, error: `${endpoint} returned ${resp.status} but its results did not include this subject — read the folder back with getFolderPermissionsTool` });
            }
        };
        await runBatch("create", create);
        await runBatch("update", update);

        const results = permissions.map((p) => ({
            subjectId: p.subjectId,
            subjectType: p.subjectType,
            requestedActions: [...p.actions],
            ...outcomes.get(subjectKey(p))
        }));
        const applied = results.filter((r) => r.status === "ok").length;
        const failed = results.filter((r) => r.status !== "ok");
        const summary = `Set permissions for ${applied} of ${permissions.length} subject(s) on folder ${folderId} ` +
            `(${create.length} via permissions:batch-create, ${update.length} via permissions:batch-update).`;
        if (failed.length > 0) {
            // The subjects that did go through are still applied. MCP clients only ever
            // see error.message (the SDK forwards nothing else), so the message carries
            // the complete per-subject report, successes included; direct callers
            // (push-permissions.js) also get it as properties on the error.
            const error = new Error(`${summary} ${failed.length} subject(s) failed or unconfirmed. Per-subject results: ${JSON.stringify(results)}`);
            error.results = results;
            error.applied = applied;
            error.requested = permissions.length;
            throw error;
        }
        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { applied, requested: permissions.length, created: create.length, updated: update.length, results }
        };
    }
};
