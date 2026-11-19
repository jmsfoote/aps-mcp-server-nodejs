// Shared fixtures for the Reviews tool tests: an in-memory stand-in for Autodesk's Reviews API, shaped on
// the live responses captured from the PTP sandbox project on 2026-11-19 (see the PR body).
import { stubFetch } from "./setup.mjs";
import { setReviewsRetrySleep } from "../tools/reviews-helpers.js";

export const BASE = "https://developer.api.autodesk.com/construction/reviews/v1";
export const PROJECT = "b.aaaaaaaa-0000-4000-8000-000000000000";
export const FOLDER_URN = "urn:adsk.wipprodanz:fs.folder:co.TESTfolder000000000000";

/** A stored workflow record in Autodesk's response shape (no groupReview key when it is off; null folderUrn when copy is off). */
export function workflowRecord(i, extra = {}) {
    return {
        name: `Workflow ${i}`,
        description: "",
        notes: null,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        status: "ACTIVE",
        approvalStatusOptions: [
            { label: "Approved", value: "APPROVED", id: "s-a", builtIn: true },
            { label: "Rejected", value: "REJECTED", id: "s-r", builtIn: true },
        ],
        steps: [
            { name: "Initiator", type: "INITIATOR", id: `Lane_i${i}`, candidates: { companies: [], roles: [], users: [{ name: "Ann", autodeskId: "USERANN" }] } },
            { name: "Check", type: "REVIEWER", duration: 2, dueDateType: "CALENDAR_DAY", id: `Lane_r${i}`, candidates: { companies: [], roles: [], users: [{ name: "Ann", autodeskId: "USERANN" }] } },
            { name: "Sign-off", type: "APPROVER", duration: 2, dueDateType: "CALENDAR_DAY", id: `Lane_a${i}`, candidates: { companies: [], roles: [], users: [{ name: "Bob", autodeskId: "USERBOB" }] } },
        ],
        copyFilesOptions: { enabled: false, allowOverride: false, condition: "ANY", folderUrn: null, includeMarkups: false, disableOverrideMarkupSetting: false },
        attachedAttributes: [],
        updateAttributesOptions: { updateSourceAndCopiedFiles: false, enableAttachedAttributes: false, allowApproverToUpdateRejectedFiles: false },
        additionalOptions: { allowInitiatorToEdit: false, approverEditPermissions: [], initiatorEditPermissions: ["CLOSED_REVIEW_TITLE", "START_OWN_REVIEW"] },
        createdAt: "2026-11-19T00:00:00.000Z",
        updatedAt: "2026-11-19T00:00:00.000Z",
        ...extra,
    };
}

/** What Autodesk stores for a create request, as observed live: ids and names added, defaults filled in. */
export function storeAsAutodeskDoes(body, id = "99999999-9999-4999-8999-999999999999") {
    const named = (rows) => (rows ?? []).map((r) => ({ name: `Name of ${r.autodeskId}`, autodeskId: r.autodeskId }));
    return {
        name: body.name,
        description: body.description ?? "",
        notes: body.notes ?? null,
        id,
        status: "ACTIVE",
        approvalStatusOptions: [
            { label: "Approved", value: "APPROVED", id: "s-a", builtIn: true },
            { label: "Rejected", value: "REJECTED", id: "s-r", builtIn: true },
            ...(body.additionalApprovalStatusOptions ?? []).map((o, i) => ({ ...o, id: `s-c${i}`, builtIn: false })),
        ],
        steps: body.steps.map((s, i) => {
            const stored = { name: s.name, type: s.type };
            if (s.type !== "INITIATOR") { stored.duration = s.duration; stored.dueDateType = s.dueDateType; }
            if (s.groupReview?.enabled) stored.groupReview = { ...s.groupReview };
            stored.id = `Lane_${i}`;
            stored.candidates = { companies: named(s.candidates.companies), roles: named(s.candidates.roles), users: named(s.candidates.users) };
            return stored;
        }),
        copyFilesOptions: { folderUrn: null, ...body.copyFilesOptions },
        attachedAttributes: (body.attachedAttributes ?? []).map((a) => ({ id: a.id, required: Boolean(a.required) })),
        updateAttributesOptions: { updateSourceAndCopiedFiles: false, enableAttachedAttributes: false, allowApproverToUpdateRejectedFiles: false, ...(body.updateAttributesOptions ?? {}) },
        additionalOptions: { allowInitiatorToEdit: false, approverEditPermissions: [], initiatorEditPermissions: ["CLOSED_REVIEW_TITLE", "START_OWN_REVIEW"], ...(body.additionalOptions ?? {}) },
        createdAt: "2026-11-19T00:00:00.000Z",
        updatedAt: "2026-11-19T00:00:00.000Z",
    };
}

/**
 * Stub fetch with an in-memory Reviews API for one project.
 *
 * GET  …/workflows            — honours limit, offset and filter[status] (default ACTIVE), like the live API
 * GET  …/workflows/{id}       — the record, or 404
 * POST …/workflows            — 409 when the name exists (any status), else stores via `store(body)` and returns 201
 *
 * Options: ignoreOffset (every page is page one), omitTotal (no pagination.totalResults), listStatus (answer every
 * list call with this HTTP status), createStatus (answer every POST with this HTTP status), store (override what
 * is stored for a create — e.g. to drop a setting).
 * Returns the stub ({ calls, restore }) plus helpers: gets() / posts() / listCalls().
 */
export function reviewsServer(t, { workflows = [], ignoreOffset = false, omitTotal = false, listStatus, createStatus, store = storeAsAutodeskDoes } = {}) {
    const all = [...workflows];
    const previousSleep = setReviewsRetrySleep(async () => {});
    const listPath = `${BASE}/projects/${PROJECT}/workflows`;
    const stub = stubFetch(async (url, init = {}) => {
        const u = new URL(url);
        const method = init.method ?? "GET";
        const plain = `${u.origin}${u.pathname}`;
        if (method === "GET" && plain === listPath) {
            if (listStatus) return { status: listStatus, body: { detail: `stubbed ${listStatus}` } };
            const status = u.searchParams.get("filter[status]") ?? "ACTIVE";
            const limit = Number(u.searchParams.get("limit") ?? 50);
            const offset = Number(u.searchParams.get("offset") ?? 0);
            if (limit > 50) return { status: 400, body: { code: "ERR_BAD_INPUT", detail: "query.limit should be <= 50" } };
            const matching = all.filter((w) => w.status === status);
            const start = ignoreOffset ? 0 : offset;
            const results = matching.slice(start, start + limit);
            const pagination = omitTotal ? { offset, limit, nextUrl: "" } : { totalResults: matching.length, offset, limit, nextUrl: "" };
            return { status: 200, body: { results, pagination } };
        }
        if (method === "GET" && plain.startsWith(`${listPath}/`)) {
            const id = plain.slice(listPath.length + 1);
            const found = all.find((w) => w.id === id);
            return found ? { status: 200, body: found } : { status: 404, body: { detail: "not found" } };
        }
        if (method === "POST" && plain === listPath) {
            if (createStatus) return { status: createStatus, body: { detail: `stubbed ${createStatus}` } };
            const body = JSON.parse(init.body);
            if (all.some((w) => w.name === body.name)) {
                // Autodesk's real 409 body, captured live 2026-11-19 (project id replaced).
                return { status: 409, body: { code: "ERR_WORKFLOW_ALREADY_EXIST", title: "Workflow name and project id conflict", detail: "The workflow is not created in project aaaaaaaa-0000-4000-8000-000000000000." } };
            }
            const stored = store(body);
            all.push(stored);
            return { status: 201, body: stored };
        }
        throw new Error(`unexpected call ${method} ${url}`);
    });
    t.after(() => { stub.restore(); setReviewsRetrySleep(previousSleep); });
    return {
        ...stub,
        get calls() { return stub.calls; },
        posts: () => stub.calls.filter((c) => c.method === "POST"),
        gets: () => stub.calls.filter((c) => c.method === "GET"),
        listCalls: () => stub.calls.filter((c) => c.method === "GET").map((c) => {
            const u = new URL(c.url);
            return { status: u.searchParams.get("filter[status]"), limit: u.searchParams.get("limit"), offset: u.searchParams.get("offset"), sort: u.searchParams.get("sort"), initiator: u.searchParams.get("filter[initiator]") };
        }),
    };
}
