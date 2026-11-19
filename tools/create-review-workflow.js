import { z } from "zod";
import { reviewsApiCall, reviewsProjectId, incompleteNote, formatWorkflow } from "./reviews-helpers.js";
import { fetchAllReviewWorkflows } from "./get-review-workflows.js";

// ---------------------------------------------------------------------------
// ACC / Forma Reviews — creating an approval workflow
// ---------------------------------------------------------------------------
//
// Request contract: https://aps.autodesk.com/en/docs/acc/v1/reference/http/reviews-createworkflow-POST/
//
// Candidates. Every step takes { candidates: { users: [...], roles: [...], companies: [...] } }, each entry
// { autodeskId }. Observed live on the PTP sandbox project, 2026-11-19:
//   - users:     the member's Autodesk id (e.g. "3LH2T8GTP97JA9SM") — getProjectUsersTool `autodeskId`.
//   - roles:     the role's MEMBER-GROUP id (numeric, e.g. "542830447") — getProjectRolesTool `member_group_id`.
//   - companies: the company's MEMBER-GROUP id (numeric, e.g. "542830416") — accProjectCompanyListTool
//                `member_group_id`.
//   A request with a company as the only INITIATOR candidate, a role on a REVIEWER step, WORKDAY steps, group
//   review (ALL and MINIMUM) and copy-on-approval was stored exactly as sent; so was a company as the only
//   candidate of a REVIEWER step and beside a user on the APPROVER step. The role / company UUIDs (what
//   an earlier version of this comment recommended, from the docs alone) were never observed to work; the
//   tool refuses them rather than risk a workflow that cannot be deleted.
//
// Day type. Autodesk's values are CALENDAR_DAY and WORKDAY. "BUSINESS_DAY" (what this tool sent until
// 2026-11) is refused with HTTP 400 "data.steps[n].dueDateType should be equal to one of the allowed values".
//
// A workflow cannot be edited, deactivated or deleted through the API. So: the request is checked before it
// is sent, a POST is sent exactly once (reviewsApiCall), and what Autodesk stored is compared with what was
// asked.
// ---------------------------------------------------------------------------

const ROLE_MAP = { reviewer: "REVIEWER", approver: "APPROVER" };
const DAY_TYPE_MAP = {
    business_days: "WORKDAY", business_day: "WORKDAY", working_days: "WORKDAY", working_day: "WORKDAY", workday: "WORKDAY",
    calendar_days: "CALENDAR_DAY", calendar_day: "CALENDAR_DAY",
};
const DEFAULT_DAY_TYPE = "WORKDAY"; // the tool's default has always meant working days
const KNOWN_STEP_KEYS = new Set(["name", "step_name", "role", "candidates", "timeAllowed", "time_allowed", "dayType", "day_type", "groupReview"]);
// Accepted on a step and not used: the push runbook's example carries it. Steps are created in the order listed.
const TOLERATED_STEP_KEYS = new Set(["stepOrder"]);
const KNOWN_CANDIDATE_KEYS = new Set(["type", "id", "userId"]);
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUILT_IN_STATUS_LABELS = ["Approved", "Rejected"];

export const MAX_NAME = 255;
export const MAX_TEXT = 4096;
export const MAX_EXTRA_STATUSES = 50;
export const MAX_GROUP_REVIEWERS = 30;

// A candidate accepts either the legacy `{userId}` shape (treated as user) or
// the typed `{type, id}` shape that supports user/role/company.
export const CandidateSchema = z.object({
    type: z.enum(["user", "role", "company"]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    userId: z.string().optional(), // backwards compat: implies type="user"
}).strict().refine(
    (c) => Boolean(c.id || c.userId),
    { message: "Each candidate needs either {type, id} or {userId} (legacy)." }
);

const CopyFilesOptionsSchema = z.object({
    enabled: z.boolean(),
    folderUrn: z.string().optional(),
    condition: z.enum(["ANY", "ALL"]).optional(),
    includeMarkups: z.boolean().optional(),
    allowOverride: z.boolean().optional(),
    disableOverrideMarkupSetting: z.boolean().optional(),
}).strict();

const ApprovalStatusOptionSchema = z.object({
    label: z.string(),
    value: z.enum(["APPROVED", "REJECTED"]),
}).strict();

const AttachedAttributeSchema = z.object({
    id: z.number().int(),
    required: z.boolean().optional(),
}).strict();

const UpdateAttributesOptionsSchema = z.object({
    enableAttachedAttributes: z.boolean().optional(),
    updateSourceAndCopiedFiles: z.boolean().optional(),
    allowApproverToUpdateRejectedFiles: z.boolean().optional(),
}).strict();

const AdditionalOptionsSchema = z.object({
    initiatorEditPermissions: z.array(z.enum(["REVIEWER_ASSIGNMENTS_AND_DURATION", "APPROVERS", "CLOSED_REVIEW_TITLE", "START_OWN_REVIEW"])).optional(),
    approverEditPermissions: z.array(z.enum(["APPROVERS"])).optional(),
    allowInitiatorToEdit: z.boolean().optional(),
}).strict();

/** A refused input fails the same way an Autodesk failure does: it throws, and the MCP server returns isError. */
function refuse(text) {
    throw new Error(text);
}

/** An id as the string Autodesk takes, or undefined when it is blank or not a string / finite number. */
function cleanId(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
}

function normaliseCandidate(c) {
    if (c === null || typeof c !== "object") return { type: undefined, id: undefined };
    const id = c.id ?? c.userId;
    return { type: c.type ?? "user", id };
}

/**
 * Sort a candidate list into Autodesk's three buckets, refusing anything that would be dropped or mis-sent.
 * requireType: an entry given as {id} must also say its type (the legacy {userId} names a user by itself).
 */
export function bucketCandidates(rawCandidates, where, { requireType = false } = {}) {
    const buckets = { users: [], roles: [], companies: [] };
    rawCandidates.forEach((raw, i) => {
        const at = `${where} candidate ${i + 1}`;
        if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
            // A key that is not read would otherwise vanish: {"Type": "company", "id": …} would be sent as a user.
            const unknown = Object.keys(raw).filter((k) => !KNOWN_CANDIDATE_KEYS.has(k));
            if (unknown.length) {
                refuse(`${at} has unknown key(s) ${unknown.join(", ")}. A candidate's keys are type and id (or the legacy userId). Nothing was sent to Autodesk.`);
            }
            if (requireType && (raw.type === undefined || raw.type === null) && (raw.userId === undefined || raw.userId === null)) {
                refuse(`${at} has no type. Say whether the id is a "user", a "role" or a "company": {"type": …, "id": …}. Nothing was sent to Autodesk.`);
            }
        }
        const c = normaliseCandidate(raw);
        const id = cleanId(c.id);
        if (id === undefined) {
            refuse(`${at} has no id. Each candidate needs {type, id} (or the legacy {userId}) with the id as text or a number; nothing was sent to Autodesk.`);
        }
        if (c.type === "user") {
            buckets.users.push({ autodeskId: id });
        } else if (c.type === "role" || c.type === "company") {
            if (UUID_SHAPE.test(id)) {
                refuse(
                    `${at}: "${id}" is the ${c.type}'s UUID. The Reviews API takes the ${c.type}'s member-group id ` +
                    `(a short number such as "542830447"): ` +
                    (c.type === "role"
                        ? "member_group_id from getProjectRolesTool."
                        : "member_group_id from accProjectCompanyListTool.") +
                    ` Nothing was sent to Autodesk.`
                );
            }
            (c.type === "role" ? buckets.roles : buckets.companies).push({ autodeskId: id });
        } else {
            refuse(`${at} has type "${c.type}". A candidate type is "user", "role" or "company"; nothing was sent to Autodesk.`);
        }
    });
    return buckets;
}

const candidateCount = (b) => b.users.length + b.roles.length + b.companies.length;

function mapDayType(raw, stepLabel) {
    if (raw === undefined || raw === null || raw === "") return DEFAULT_DAY_TYPE;
    const key = String(raw).trim().toLowerCase();
    const mapped = Object.hasOwn(DAY_TYPE_MAP, key) ? DAY_TYPE_MAP[key] : undefined;
    if (!mapped) {
        refuse(`${stepLabel} has dayType "${raw}". Use "business_days" (working days) or "calendar_days"; nothing was sent to Autodesk.`);
    }
    return mapped;
}

function buildGroupReview(raw, stepLabel, type, buckets) {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "object" || Array.isArray(raw)) {
        refuse(`${stepLabel} groupReview must be an object {enabled, type, min}; nothing was sent to Autodesk.`);
    }
    const unknown = Object.keys(raw).filter((k) => !["enabled", "type", "min"].includes(k));
    if (unknown.length) refuse(`${stepLabel} groupReview has unknown key(s) ${unknown.join(", ")}; the keys are enabled, type, min. Nothing was sent to Autodesk.`);
    if (typeof raw.enabled !== "boolean") refuse(`${stepLabel} groupReview.enabled must be true or false; nothing was sent to Autodesk.`);
    // Off = today's proven request: no groupReview key at all (Autodesk stores none when it is off).
    if (!raw.enabled) return undefined;
    if (type !== "REVIEWER") {
        refuse(`${stepLabel} is an ${type} step: group review applies to reviewer steps only. Nothing was sent to Autodesk.`);
    }
    const kind = typeof raw.type === "string" ? raw.type.trim().toUpperCase() : raw.type;
    if (kind === "ALL") {
        if (candidateCount(buckets) > MAX_GROUP_REVIEWERS) {
            refuse(`${stepLabel} has ${candidateCount(buckets)} candidates: group review type ALL allows at most ${MAX_GROUP_REVIEWERS}. Nothing was sent to Autodesk.`);
        }
        return { enabled: true, type: "ALL" };
    }
    if (kind === "MINIMUM") {
        if (!Number.isInteger(raw.min) || raw.min < 1 || raw.min > MAX_GROUP_REVIEWERS) {
            refuse(`${stepLabel} groupReview.min must be a whole number from 1 to ${MAX_GROUP_REVIEWERS} when type is MINIMUM (got ${JSON.stringify(raw.min)}). Nothing was sent to Autodesk.`);
        }
        return { enabled: true, type: "MINIMUM", min: raw.min };
    }
    return refuse(`${stepLabel} groupReview.type must be "ALL" (every assigned reviewer must respond) or "MINIMUM" (got ${JSON.stringify(raw.type)}). Nothing was sent to Autodesk.`);
}

/**
 * Build the POST body from the tool's arguments, or throw a refusal naming the field that is wrong.
 * Pure: no network. With only the original inputs (projectId, name, description, initiatorUserId, steps) the
 * body is what the tool sent before 2026-11, except `dueDateType` (WORKDAY instead of the refused BUSINESS_DAY).
 *
 * @returns {{ body: object, ignoredStepKeys: string[] }}
 */
export function buildWorkflowRequest({
    name, description, initiatorUserId, steps, initiators, copyFilesOptions, notes,
    additionalApprovalStatusOptions, attachedAttributes, updateAttributesOptions, additionalOptions,
}) {
    let parsedSteps;
    try {
        parsedSteps = JSON.parse(steps);
    } catch (e) {
        refuse(`Invalid steps JSON: ${e.message}`);
    }
    if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) {
        refuse(`Invalid steps JSON: expected a non-empty array of workflow steps.`);
    }

    // --- Workflow-level text limits ---
    if (typeof name !== "string" || name.length === 0) refuse(`Workflow name is required; nothing was sent to Autodesk.`);
    if (name.length > MAX_NAME) refuse(`Workflow name is ${name.length} characters; the limit is ${MAX_NAME}. Nothing was sent to Autodesk.`);
    if (description !== undefined && description !== null && description.length > MAX_TEXT) {
        refuse(`description is ${description.length} characters; the limit is ${MAX_TEXT}. Nothing was sent to Autodesk.`);
    }
    if (notes !== undefined && notes !== null && notes.length > MAX_TEXT) {
        refuse(`notes is ${notes.length} characters; the limit is ${MAX_TEXT}. Nothing was sent to Autodesk.`);
    }

    // --- Determine initiator ---
    let initiatorCandidates;
    if (initiators !== undefined && initiators !== null) {
        if (initiatorUserId) {
            refuse(`Pass either initiators or initiatorUserId, not both; nothing was sent to Autodesk.`);
        }
        if (!Array.isArray(initiators) || initiators.length === 0) {
            refuse(`initiators must list at least one user, role or company; nothing was sent to Autodesk.`);
        }
        const b = bucketCandidates(initiators, "initiators", { requireType: true });
        initiatorCandidates = { companies: b.companies, roles: b.roles, users: b.users };
    } else {
        // A blank or whitespace-only id counts as not given, for the explicit and the inferred initiator alike.
        let initiatorAutodeskId = cleanId(initiatorUserId);
        if (!initiatorAutodeskId) {
            // Search step 1 for the first user-type candidate
            const step1 = parsedSteps[0];
            const step1Candidates = Array.isArray(step1?.candidates) ? step1.candidates : [];
            const userCandidate = step1Candidates
                .map(normaliseCandidate)
                .find((c) => c.type === "user");
            if (userCandidate) initiatorAutodeskId = cleanId(userCandidate.id);
        }
        if (!initiatorAutodeskId) {
            const stepNames = parsedSteps.map((s, i) => s?.name || `step ${i + 1}`).join(", ");
            refuse(
                `Cannot create workflow "${name}" — no user candidate found in step 1, ` +
                `and no \`initiatorUserId\` was supplied. ACC's Reviews API requires ` +
                `a user as the workflow initiator. Either add a user candidate to ` +
                `step 1 (alongside any role/company candidates) or pass ` +
                `\`initiatorUserId\` explicitly. Steps: ${stepNames}.`
            );
        }
        initiatorCandidates = { companies: [], roles: [], users: [{ autodeskId: initiatorAutodeskId }] };
    }

    const initiatorStep = {
        name: "Initiator",
        type: "INITIATOR",
        candidates: initiatorCandidates,
    };

    // --- Build review/approver steps ---
    const apiSteps = [initiatorStep];
    const ignored = new Set();
    const given = (v) => v !== undefined && v !== null && v !== "";
    parsedSteps.forEach((step, index) => {
        // `given`, not `||`: a name of 0 or false is a wrong type to refuse below, not "no name".
        const rawStepName = given(step?.name) ? step.name : given(step?.step_name) ? step.step_name : "";
        const stepName = typeof rawStepName === "string" ? rawStepName : "";
        const stepLabel = `Step ${index + 1} ("${stepName || "?"}")`;
        if (!Array.isArray(step?.candidates)) {
            refuse(`Step "${step?.name || "?"}" has invalid candidates. Expected an array.`);
        }
        // ACC requires at least one candidate per step
        if (step.candidates.length === 0) {
            refuse(
                `Step "${step.name || "?"}" has no candidates. ` +
                `ACC requires at least one user, role, or company candidate per step.`
            );
        }
        // An unknown step key is refused, not dropped: a misspelt "groupReview" or "timeAllowed" would otherwise
        // create a workflow without that setting, and the comparison (made against the request as built) could
        // never notice. A workflow cannot be corrected or removed afterwards.
        const unknownKeys = Object.keys(step).filter((key) => !KNOWN_STEP_KEYS.has(key) && !TOLERATED_STEP_KEYS.has(key));
        if (unknownKeys.length) {
            refuse(
                `${stepLabel} has unknown key(s) ${unknownKeys.join(", ")}. A step's keys are name, role, candidates, timeAllowed, dayType, groupReview ` +
                `(stepOrder is accepted and not used: steps are created in the order listed). Nothing was sent to Autodesk.`
            );
        }
        for (const key of Object.keys(step)) if (TOLERATED_STEP_KEYS.has(key)) ignored.add(key);
        const buckets = bucketCandidates(step.candidates, stepLabel);

        if (typeof rawStepName !== "string") {
            refuse(`Step ${index + 1} name must be text (got ${JSON.stringify(rawStepName)}); nothing was sent to Autodesk.`);
        }
        if (stepName.length > MAX_NAME) refuse(`${stepLabel} name is ${stepName.length} characters; the limit is ${MAX_NAME}. Nothing was sent to Autodesk.`);

        const type = (typeof step.role === "string" && Object.hasOwn(ROLE_MAP, step.role) ? ROLE_MAP[step.role] : undefined)
            || (typeof step.role === "string" ? step.role.toUpperCase() : undefined) || "REVIEWER";
        if (type !== "REVIEWER" && type !== "APPROVER") {
            refuse(`${stepLabel} has role "${step.role}". A step's role is "reviewer" or "approver"; nothing was sent to Autodesk.`);
        }

        const rawDuration = given(step.timeAllowed) ? step.timeAllowed : given(step.time_allowed) ? step.time_allowed : 5;
        const duration = typeof rawDuration === "string" && /^\d+$/.test(rawDuration.trim()) ? Number(rawDuration) : rawDuration;
        if (!Number.isInteger(duration) || duration < 1 || duration > 99) {
            refuse(`${stepLabel} timeAllowed is ${JSON.stringify(rawDuration)}; Autodesk accepts a whole number of days from 1 to 99. Nothing was sent to Autodesk.`);
        }

        const apiStep = {
            name: stepName,
            type,
            duration,
            dueDateType: mapDayType(step.dayType || step.day_type, stepLabel),
            candidates: buckets,
        };
        const groupReview = buildGroupReview(step.groupReview, stepLabel, type, buckets);
        if (groupReview) apiStep.groupReview = groupReview;
        apiSteps.push(apiStep);
    });

    // --- Step order: reviewers, then exactly one approver, last ---
    const types = apiSteps.slice(1).map((s) => s.type);
    if (types[types.length - 1] !== "APPROVER") {
        refuse(`The last step must be an approver (Autodesk's order is initiator, reviewer steps, then one approver). The last step given is a ${types[types.length - 1].toLowerCase()}. Nothing was sent to Autodesk.`);
    }
    const earlyApprover = types.slice(0, -1).indexOf("APPROVER");
    if (earlyApprover !== -1) {
        refuse(`Step ${earlyApprover + 1} is an approver but is not the last step. Only the last step may be an approver; the others must be reviewers. Nothing was sent to Autodesk.`);
    }

    // --- Copy on approval ---
    const copy = copyFilesOptions ?? { enabled: false };
    if (copy.enabled && !copy.folderUrn) {
        refuse(`copyFilesOptions.enabled is true but no folderUrn was given: copy-on-approval needs the destination folder's URN. Nothing was sent to Autodesk.`);
    }
    if (copy.folderUrn && !/^urn:adsk\.[^:]+:fs\.folder:/.test(copy.folderUrn)) {
        refuse(`copyFilesOptions.folderUrn "${copy.folderUrn}" is not a folder URN (expected "urn:adsk.…:fs.folder:co.…", the folder id from getFolderContentsTool). Nothing was sent to Autodesk.`);
    }
    const apiCopy = {
        enabled: Boolean(copy.enabled),
        allowOverride: copy.allowOverride ?? false,
        condition: copy.condition ?? "ANY",
        includeMarkups: copy.includeMarkups ?? false,
        disableOverrideMarkupSetting: copy.disableOverrideMarkupSetting ?? false,
    };
    if (copy.folderUrn) apiCopy.folderUrn = copy.folderUrn;

    const body = {
        name,
        description: description || "",
        steps: apiSteps,
        copyFilesOptions: apiCopy,
    };

    // --- Optional settings: sent only when supplied ---
    if (notes !== undefined && notes !== null) body.notes = notes;

    if (additionalApprovalStatusOptions !== undefined && additionalApprovalStatusOptions !== null) {
        if (additionalApprovalStatusOptions.length > MAX_EXTRA_STATUSES) {
            refuse(`additionalApprovalStatusOptions has ${additionalApprovalStatusOptions.length} entries; the limit is ${MAX_EXTRA_STATUSES}. Nothing was sent to Autodesk.`);
        }
        const seen = new Set(BUILT_IN_STATUS_LABELS.map((l) => l.toLowerCase()));
        additionalApprovalStatusOptions.forEach((option, i) => {
            const label = typeof option?.label === "string" ? option.label.trim() : "";
            if (!label) refuse(`additionalApprovalStatusOptions[${i}] has no label; nothing was sent to Autodesk.`);
            if (label.length > MAX_NAME) refuse(`additionalApprovalStatusOptions[${i}].label is ${label.length} characters; the limit is ${MAX_NAME}. Nothing was sent to Autodesk.`);
            if (seen.has(label.toLowerCase())) {
                refuse(`additionalApprovalStatusOptions[${i}].label "${label}" is used twice (labels must be unique, and "Approved" / "Rejected" are built in). Nothing was sent to Autodesk.`);
            }
            seen.add(label.toLowerCase());
        });
        body.additionalApprovalStatusOptions = additionalApprovalStatusOptions.map((o) => ({ label: o.label.trim(), value: o.value }));
    }

    if (attachedAttributes !== undefined && attachedAttributes !== null) {
        body.attachedAttributes = attachedAttributes.map((a) => (a.required === undefined ? { id: a.id } : { id: a.id, required: a.required }));
    }
    if (updateAttributesOptions !== undefined && updateAttributesOptions !== null) body.updateAttributesOptions = { ...updateAttributesOptions };
    if (additionalOptions !== undefined && additionalOptions !== null) body.additionalOptions = { ...additionalOptions };

    return { body, ignoredStepKeys: [...ignored] };
}

// ---------------------------------------------------------------------------
// What Autodesk stored vs what was asked
// ---------------------------------------------------------------------------

const idSet = (rows) => [...new Set((Array.isArray(rows) ? rows : []).map((r) => String(r?.autodeskId)))].sort();
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sortedCopy = (arr) => [...(Array.isArray(arr) ? arr : [])].map(String).sort();

/**
 * Compare a create request with the workflow record Autodesk returned (or an existing workflow).
 * Only what the request asked for is compared: a value Autodesk holds for a setting that was not asked for
 * (for example additionalOptions.initiatorEditPermissions when none was sent) is not a difference.
 *
 * @returns {{ verified: boolean, differences: Array<{ field: string, requested: any, stored: any }> }}
 *   verified is false when the record has no steps to compare against.
 */
export function compareStoredWithRequested(body, stored) {
    const differences = [];
    const diff = (field, requested, storedValue) => differences.push({ field, requested, stored: storedValue ?? null });
    if (!stored || !Array.isArray(stored.steps)) return { verified: false, differences };

    if (stored.name !== body.name) diff("name", body.name, stored.name);
    if ((stored.description ?? "") !== body.description) diff("description", body.description, stored.description);
    if (body.notes !== undefined && (stored.notes ?? "") !== body.notes) diff("notes", body.notes, stored.notes);

    if (stored.steps.length !== body.steps.length) diff("steps.length", body.steps.length, stored.steps.length);
    body.steps.forEach((asked, i) => {
        const got = stored.steps[i];
        const at = `steps[${i}] ("${asked.name}")`;
        if (!got) return;
        if (got.type !== asked.type) diff(`${at}.type`, asked.type, got.type);
        if (got.name !== asked.name) diff(`${at}.name`, asked.name, got.name);
        if (asked.type !== "INITIATOR") {
            if (got.dueDateType !== asked.dueDateType) diff(`${at}.dueDateType`, asked.dueDateType, got.dueDateType);
            if (got.duration !== asked.duration) diff(`${at}.duration`, asked.duration, got.duration);
        }
        const askedGroup = asked.groupReview?.enabled ? asked.groupReview : null;
        const gotGroup = got.groupReview?.enabled ? got.groupReview : null;
        const groupMatches = askedGroup === null
            ? gotGroup === null
            : gotGroup !== null && gotGroup.type === askedGroup.type && (askedGroup.type !== "MINIMUM" || gotGroup.min === askedGroup.min);
        if (!groupMatches) diff(`${at}.groupReview`, askedGroup ?? "off", gotGroup ?? "off");
        for (const bucket of ["users", "roles", "companies"]) {
            const want = idSet(asked.candidates?.[bucket]);
            const have = idSet(got.candidates?.[bucket]);
            if (!sameList(want, have)) diff(`${at}.candidates.${bucket}`, want, have);
            for (const row of got.candidates?.[bucket] ?? []) {
                if (want.includes(String(row?.autodeskId)) && !row?.name) {
                    diff(`${at}.candidates.${bucket} ${row.autodeskId}`, "a known member", "stored with no name — Autodesk did not recognise this id");
                }
            }
        }
    });

    const askedCopy = body.copyFilesOptions;
    const gotCopy = stored.copyFilesOptions ?? {};
    for (const key of Object.keys(askedCopy)) {
        if ((gotCopy[key] ?? null) !== askedCopy[key]) diff(`copyFilesOptions.${key}`, askedCopy[key], gotCopy[key]);
    }

    if (body.additionalApprovalStatusOptions) {
        const custom = (stored.approvalStatusOptions ?? []).filter((o) => !o.builtIn);
        const key = (o) => `${o.label}=${o.value}`;
        const want = body.additionalApprovalStatusOptions.map(key).sort();
        const have = custom.map(key).sort();
        if (!sameList(want, have)) diff("additionalApprovalStatusOptions", want, have);
    }
    if (body.attachedAttributes) {
        const key = (a) => `${a.id}:${Boolean(a.required)}`;
        const want = body.attachedAttributes.map(key).sort();
        const have = (stored.attachedAttributes ?? []).map(key).sort();
        if (!sameList(want, have)) diff("attachedAttributes", want, have);
    }
    if (body.updateAttributesOptions) {
        for (const [key, value] of Object.entries(body.updateAttributesOptions)) {
            if ((stored.updateAttributesOptions?.[key] ?? null) !== value) diff(`updateAttributesOptions.${key}`, value, stored.updateAttributesOptions?.[key]);
        }
    }
    if (body.additionalOptions) {
        for (const [key, value] of Object.entries(body.additionalOptions)) {
            const got = stored.additionalOptions?.[key];
            const matches = Array.isArray(value) ? sameList(sortedCopy(value), sortedCopy(got)) : got === value;
            if (!matches) diff(`additionalOptions.${key}`, value, got);
        }
    }
    return { verified: true, differences };
}

function describeComparison({ verified, differences }, storedLabel) {
    if (!verified) {
        return `NOT VERIFIED: ${storedLabel} did not include the workflow's steps, so what was stored could not be compared with what was asked. Read it back with getReviewWorkflowTool.`;
    }
    if (differences.length === 0) {
        return `Checked against ${storedLabel}: day types, durations, group review, candidates, copy settings and the other requested settings all match what was asked.`;
    }
    const lines = differences.map((d) => `  - ${d.field}: asked ${JSON.stringify(d.requested)}, stored ${JSON.stringify(d.stored)}`);
    return `WARNING — ${storedLabel} differs from what was asked in ${differences.length} place(s):\n${lines.join("\n")}\n` +
        `A workflow cannot be changed through this server; correct it by hand in Forma.`;
}

const INPUT_SHAPE = {
    projectId: reviewsProjectId()
        .describe('The project UUID, with or without the "b." prefix'),
    name: z.string().nonempty()
        .describe("Workflow name (max 255), unique in the project (Autodesk answers a duplicate with HTTP 409). e.g. 'Payment Application Review'"),
    description: z.string().optional()
        .describe("What triggers this review workflow (max 4096)"),
    initiatorUserId: z.string().optional()
        .describe("Optional explicit initiator (Autodesk user ID). If omitted (and initiators is omitted), the first user candidate found in step 1 is used. Do not combine with initiators."),
    steps: z.string().nonempty()
        .describe(
            'JSON string of steps array (reviewer steps in order, then ONE approver step last). Each step: ' +
            '{"name": "PM Review", "role": "reviewer"|"approver", ' +
            '"candidates": [<see candidate shapes>], "timeAllowed": 5, ' +
            '"dayType": "business_days"|"calendar_days", ' +
            '"groupReview": {"enabled": true, "type": "ALL"} | {"enabled": true, "type": "MINIMUM", "min": 2}} ' +
            '— groupReview is optional and for reviewer steps only. Any other key on a step is refused ' +
            '(stepOrder alone is accepted and not used: steps are created in the order listed).'
        ),
    initiators: z.array(CandidateSchema).nonempty().optional()
        .describe('Who may submit files for review with this workflow: a list of candidates in the same shapes as a step\'s (users, roles, companies, or a mix), e.g. [{"type": "company", "id": "542830416"}]. Each entry must state its type (or use the legacy {"userId"}). Replaces the default single-user initiator.'),
    copyFilesOptions: CopyFilesOptionsSchema.optional()
        .describe('Copy approved files to a folder when the review finishes. {"enabled": true, "folderUrn": "urn:adsk.wipprod…:fs.folder:co.…", "condition": "ANY"|"ALL", "includeMarkups": false, "allowOverride": false, "disableOverrideMarkupSetting": false}. folderUrn is required when enabled is true. condition ANY = copy when at least one file is approved; ALL = only when every file is. allowOverride = the submitter may change the folder. Omitted = copy off.'),
    notes: z.string().optional()
        .describe("Notes shown to every reviewer (max 4096)."),
    additionalApprovalStatusOptions: z.array(ApprovalStatusOptionSchema).optional()
        .describe('Extra approval statuses on top of the built-in Approved / Rejected, e.g. [{"label": "Approved with comments", "value": "APPROVED"}]. Up to 50, labels unique.'),
    attachedAttributes: z.array(AttachedAttributeSchema).optional()
        .describe('Custom attributes attached to the workflow: [{"id": 10272, "required": false}] (id = the custom attribute definition id).'),
    updateAttributesOptions: UpdateAttributesOptionsSchema.optional()
        .describe('{"enableAttachedAttributes", "updateSourceAndCopiedFiles", "allowApproverToUpdateRejectedFiles"} — booleans; Autodesk applies them only when the workflow copies files.'),
    additionalOptions: AdditionalOptionsSchema.optional()
        .describe('What may be changed on a running review. {"initiatorEditPermissions": ["REVIEWER_ASSIGNMENTS_AND_DURATION", "APPROVERS", "CLOSED_REVIEW_TITLE", "START_OWN_REVIEW"], "approverEditPermissions": ["APPROVERS"]}. allowInitiatorToEdit is Autodesk\'s deprecated older switch. Omitted = whatever Autodesk applies: on the sandbox, 2026-11-19, workflows created with it omitted were stored with EMPTY permission lists, so pass it explicitly when the permissions matter.'),
    skipIfExists: z.boolean().optional()
        .describe("true = first look the name up among active and inactive workflows; if it exists, create nothing and return the existing workflow (with any differences from what was asked, and a WARNING if it is switched off: check result.status). Makes a re-run safe."),
};

export const createReviewWorkflowTool = {
    title: "Create Review Workflow",
    description: `Create a review (approval) workflow in an ACC / Forma project. THIS WRITES, AND IT CANNOT BE UNDONE FROM HERE:
a workflow cannot be changed, switched off or deleted through this server (Autodesk offers no such endpoint) —
only by hand in Forma. Check the inputs before calling; use skipIfExists on any re-run.

A workflow is: who may submit (the initiator), reviewer steps in order, then one approver step, last.
Each step has candidates (users, roles, or companies — or a mix) and a time limit.
The projectId is the project UUID; the "b." prefix is accepted and optional. The calling service account must be
a project administrator.

**Candidate ID sources:**
  - users: Autodesk account ID (autodeskId field from getProjectUsersTool)
  - roles: the role's member-group id — member_group_id from getProjectRolesTool (NOT the role UUID)
  - companies: the company's member-group id — member_group_id from accProjectCompanyListTool (NOT the company UUID)
A role or company UUID is refused before anything is sent.

**Candidate input shapes (mix freely within one step):**
  - { "type": "user",    "id": "<autodeskId>" }
  - { "type": "role",    "id": "<role member-group id>" }
  - { "type": "company", "id": "<company member-group id>" }
  - { "userId": "<autodeskId>" }   // legacy shape — treated as type="user"
A candidate with any other key (a misspelt "type", say) is refused. In a step, { "id": … } with no type means a
user (legacy); in \`initiators\` the type must be stated.

**Initiator (who may submit):** pass \`initiators\` (users, roles, companies or a mix). Without it, the initiator
is \`initiatorUserId\`, else the first user candidate found in step 1; with neither, the call is refused.

**Time allowed:** timeAllowed 1–99 days (default 5). dayType "business_days" = working days (Autodesk WORKDAY),
"calendar_days" = calendar days; omitted = working days.

**Group review (reviewer steps only):** "groupReview": {"enabled": true, "type": "ALL"} = every assigned reviewer
must respond (at most 30 candidates); {"enabled": true, "type": "MINIMUM", "min": N} = at least N must respond.
Omitted = one reviewer acts.

**Copy on approval:** copyFilesOptions (one destination folder per workflow). **Also:** notes,
additionalApprovalStatusOptions, attachedAttributes, updateAttributesOptions, additionalOptions — see each input.

**What this tool does for you:** it checks the request and refuses, naming the wrong field, before anything is
sent; it sends the create exactly once (never retried); it then compares what Autodesk stored with what was asked
and puts a WARNING in the output if anything differs. A refusal, an Autodesk error and a duplicate name (HTTP 409)
all fail the call (isError). structuredContent = { result: <the workflow record>, created: true|false,
verified, differences: [...] }; with skipIfExists and an existing name, created is false and result is the
existing workflow.

**Why role/company candidates matter:** role-based candidates mean "any user
assigned to this role can perform the review" — when staff turnover happens,
the workflow keeps working without modification. The right pattern for any
template you intend to reuse across projects.`,
    // A strict object, not a bare shape: an unknown or misspelt setting is refused instead of silently dropped.
    inputSchema: z.object(INPUT_SHAPE).strict(),
    callback: async (input) => {
        // Parsed again here so a direct call (tests, scripts) gets the same checks the MCP server applies.
        const args = createReviewWorkflowTool.inputSchema.parse(input);
        const { projectId, name, skipIfExists } = args;
        const { body, ignoredStepKeys } = buildWorkflowRequest(args);
        const ignoredNote = ignoredStepKeys.length
            ? `\nIgnored step key(s) this tool does not use: ${ignoredStepKeys.join(", ")}.`
            : "";

        const existingResult = (existing) => {
            const comparison = compareStoredWithRequested(body, existing);
            // A workflow that is switched off matches by name and settings, yet no review can be started with it.
            const inactiveNote = existing.status === "ACTIVE"
                ? ""
                : `WARNING: this workflow is ${existing.status} (switched off). It cannot be used to start a review, and it cannot be ` +
                  `switched on through this server: that is done by hand in Forma.\n`;
            return {
                content: [{
                    type: "text",
                    text:
                        `Workflow "${name}" already exists (id ${existing.id}, ${existing.status}) — nothing was created.\n${inactiveNote}` +
                        `${describeComparison(comparison, "the existing workflow")}${ignoredNote}\n${formatWorkflow(existing)}`,
                }],
                structuredContent: { result: existing, created: false, skipped: true, ...comparison, ignoredStepKeys },
            };
        };

        if (skipIfExists) {
            const listing = await fetchAllReviewWorkflows(projectId, { status: "all" });
            const existing = listing.results.find((w) => w?.name === name);
            if (existing) return existingResult(existing);
            if (!listing.complete) {
                refuse(
                    `Cannot confirm that no workflow named "${name}" exists: the workflow listing could not be completed` +
                    `${incompleteNote(listing)}. Nothing was created. Retry, or check the name with getReviewWorkflowsTool (status "all").`
                );
            }
        }

        let result;
        try {
            result = await reviewsApiCall(
                "POST",
                `/projects/${projectId}/workflows`,
                body,
            );
        } catch (error) {
            if (error?.status === 409) {
                if (skipIfExists) {
                    // The lookup above found no such name, yet Autodesk says it exists: it was created in the
                    // meantime. Look once more (reads only; the POST is not re-sent) and return it if it is there.
                    const again = await fetchAllReviewWorkflows(projectId, { status: "all" });
                    const existing = again.results.find((w) => w?.name === name);
                    if (existing) return existingResult(existing);
                    refuse(
                        `${error.message} — Autodesk refuses the name "${name}" as a duplicate, but no workflow with exactly that ` +
                        `name is listed (active or inactive). Autodesk may be treating a name that differs only in letter case or ` +
                        `spacing as the same. Nothing was created.`
                    );
                }
                refuse(
                    `${error.message} — A workflow named "${name}" already exists in this project (Autodesk refuses a duplicate name). ` +
                    `Nothing was created. Pass skipIfExists: true to get the existing workflow instead.`
                );
            }
            throw error;
        }

        // Friendly summary text — count by type for diagnostic clarity
        const apiSteps = body.steps;
        const userCount = apiSteps.reduce((n, s) => n + s.candidates.users.length, 0);
        const roleCount = apiSteps.reduce((n, s) => n + s.candidates.roles.length, 0);
        const companyCount = apiSteps.reduce((n, s) => n + s.candidates.companies.length, 0);
        const comparison = compareStoredWithRequested(body, result);

        return {
            content: [{
                type: "text",
                text:
                    `Created review workflow "${name}" with ${apiSteps.length} step(s) ` +
                    `(including initiator). Total candidates across all steps: ` +
                    `${userCount} user(s), ${roleCount} role(s), ${companyCount} company(ies). ` +
                    `Workflow ID: ${result.id || "see structuredContent"}\n` +
                    `${describeComparison(comparison, "Autodesk's response")}${ignoredNote}`,
            }],
            structuredContent: { result, created: true, ...comparison, ignoredStepKeys },
        };
    },
};
