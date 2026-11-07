import { z } from "zod";
import { adminClient } from "../utils.js";
import { ACC_REGION } from "../config.js";

/** Page size for GET projects/:projectId/users — the API maximum (its default is 20). */
export const PROJECT_USERS_PAGE_SIZE = 200;
/** Hard stop on pages fetched in one call: 50 × 200 = 10,000 members. */
export const PROJECT_USERS_MAX_PAGES = 50;

/**
 * Fetch every page of a project-member listing.
 *
 * `fetchPage(offset)` performs one request and resolves to the SDK response
 * (`{ pagination: { totalResults, … }, results: [...] }`, or a bare array).
 * Pages are merged in order and de-duplicated by member id. The loop stops when
 * the API's totalResults has been reached, on an empty page, on a short page when
 * no total was reported, on a page that adds no new member (the server ignored
 * offset), or at `maxPages`. The last two leave `complete: false` with
 * `stoppedBecause` set to "repeated_page" or "max_pages".
 *
 * @param {(offset: number) => Promise<any>} fetchPage
 * @param {{ pageSize?: number, maxPages?: number }} [opts]
 * @returns {Promise<{ results: any[], totalResults: number, pages: number, pageSize: number, complete: boolean, stoppedBecause?: string }>}
 */
export async function fetchAllProjectUsers(fetchPage, { pageSize = PROJECT_USERS_PAGE_SIZE, maxPages = PROJECT_USERS_MAX_PAGES } = {}) {
    const results = [];
    const seen = new Set();
    let totalResults;
    let pages = 0;
    let offset = 0;
    let complete = false;
    let stoppedBecause;

    while (pages < maxPages) {
        const res = await fetchPage(offset);
        pages += 1;
        const batch = Array.isArray(res?.results) ? res.results : Array.isArray(res) ? res : [];
        const reported = res?.pagination?.totalResults;
        if (Number.isInteger(reported)) totalResults = reported;

        let added = 0;
        for (const member of batch) {
            const id = member?.id;
            if (id !== undefined && id !== null) {
                if (seen.has(id)) continue;
                seen.add(id);
            }
            results.push(member);
            added += 1;
        }
        offset += batch.length;

        if (batch.length === 0) { complete = true; break; }
        if (added === 0) { stoppedBecause = "repeated_page"; break; }
        const done = totalResults !== undefined ? offset >= totalResults : batch.length < pageSize;
        if (done) { complete = true; break; }
    }
    if (!complete && !stoppedBecause) stoppedBecause = "max_pages";

    return { results, totalResults: totalResults ?? results.length, pages, pageSize, complete, stoppedBecause };
}

function formatRoles(u) {
    if (Array.isArray(u.roles) && u.roles.length) {
        return u.roles.map(r => (r?.name ? `${r.name} (${r.id})` : String(r?.id))).join(", ");
    }
    if (Array.isArray(u.roleIds) && u.roleIds.length) return u.roleIds.join(", ");
    return "none";
}

/** One member as two text lines: identity + status on the first, the ids and roles on the second. */
export function formatProjectUser(u) {
    const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || "Unknown";
    const company = u.companyName ? `, ${u.companyName}` : "";
    return `- ${name} (${u.email ?? "no email"}) — ${u.status || "unknown status"}${company}\n`
        + `    id: ${u.id ?? "—"} | autodeskId: ${u.autodeskId ?? "—"} | roles: ${formatRoles(u)}`;
}

export const getProjectUsersTool = {
    title: "Get Project Users",
    description: `
        Lists the members of an ACC / Forma project, paging through GET projects/:projectId/users (200 per page, the
        API maximum) until every member has been returned. Requires projectId (without the "b." prefix).

        Optional filterRoleIds: one or more role ids (the "id" UUID from getProjectRolesTool — not member_group_id).
        Only members holding at least one of those roles are returned, which makes this the one-call "is this role
        active in the project?" check: setFolderPermissionsTool can only grant to a ROLE that at least one member
        holds (otherwise HTTP 400 ERR_PERMISSION_RESOURCE_NOT_EXIST_OR_NOT_ACTIVE), and an empty result here means
        it is not. The API returns active and pending members by default; deleted members are excluded. A pending holder
        appears to suffice: on the PTP sandbox the only holder of one tested role was listed as pending (2026-11-07) and a
        folder grant to that role had been accepted the day before.

        Text output per member: name, email, status, company, then id (the USER subjectId for
        setFolderPermissionsTool), autodeskId (the assignee id for createIssueTool / createReviewWorkflowTool) and
        the roles held (name + id). structuredContent.result = { pagination: { totalResults, pageSize, pages,
        complete }, results: [every member, all pages merged] }. If the listing could not be completed (page cap
        of 50, or a server that ignored offset) the text says INCOMPLETE and pagination.complete is false.
    `,
    inputSchema: {
        projectId: z.string().nonempty(),
        filterRoleIds: z.array(z.string().uuid()).nonempty().optional(),
    },
    callback: async ({ projectId, filterRoleIds }) => {
        const region = ACC_REGION || "AUS";
        const listing = await fetchAllProjectUsers((offset) => {
            const args = { region, limit: PROJECT_USERS_PAGE_SIZE, offset };
            if (filterRoleIds) args.filterRoleIds = filterRoleIds;
            return adminClient.getProjectUsers(projectId, args);
        });
        const { results, totalResults, pages, pageSize, complete, stoppedBecause } = listing;

        let header;
        if (filterRoleIds) {
            const roles = filterRoleIds.join(", ");
            header = results.length === 0
                ? `No project member holds role(s) ${roles} — not active in this project; folder-permission grants to it `
                  + "will be rejected (HTTP 400 ERR_PERMISSION_RESOURCE_NOT_EXIST_OR_NOT_ACTIVE)"
                : `${results.length} member(s) hold role(s) ${roles}`;
        } else {
            header = `Found ${results.length} users`;
        }
        if (!complete) {
            const why = stoppedBecause === "max_pages" ? `page cap of ${PROJECT_USERS_MAX_PAGES}` : "the server repeated a page";
            header += ` — INCOMPLETE: stopped after ${pages} page(s) (${why}); API reports ${totalResults} in total`;
        }

        const lines = results.map(formatProjectUser);
        return {
            content: [{ type: "text", text: lines.length ? `${header}:\n${lines.join("\n")}` : header }],
            structuredContent: { result: { pagination: { totalResults, pageSize, pages, complete }, results } },
        };
    }
};
