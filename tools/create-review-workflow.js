import { z } from "zod";
import { reviewsApiCall } from "./reviews-helpers.js";

// ---------------------------------------------------------------------------
// ACC Reviews — workflow candidate types
// ---------------------------------------------------------------------------
//
// The ACC Reviews API accepts three buckets of candidates per step:
//   { candidates: { users: [...], roles: [...], companies: [...] } }
// Each candidate object uses the same field name across all three types:
//   { autodeskId: "<id>" }
// — for users this is the Autodesk account ID (e.g. "3LH2T8GTP97JA9SM"),
// for roles the role UUID from `GET /hq/v2/.../industry_roles`,
// for companies the company UUID from `GET /hq/v1/.../companies`.
//
// Empirically confirmed against APS docs 2026-05-01 (see JDH_DELIVERY_LOG
// learning #14). Mixing types within one step is fully supported — the doc
// explicitly says: "At least one of users, roles, or companies must be
// provided" (not exactly one).
//
// **Initiator step:** every published example uses a user candidate for the
// INITIATOR. The schema doesn't strictly forbid roles/companies there, but
// it's untested — this tool defaults to user-as-initiator and will surface
// a clear error if no user candidate exists in step 1.
// ---------------------------------------------------------------------------

const ROLE_MAP = { reviewer: "REVIEWER", approver: "APPROVER" };
const DAY_TYPE_MAP = { business_days: "BUSINESS_DAY", calendar_days: "CALENDAR_DAY" };

// A candidate accepts either the legacy `{userId}` shape (treated as user) or
// the typed `{type, id}` shape that supports user/role/company.
const CandidateSchema = z.object({
    type: z.enum(["user", "role", "company"]).optional(),
    id: z.string().optional(),
    userId: z.string().optional(), // backwards compat: implies type="user"
}).refine(
    (c) => Boolean(c.id || c.userId),
    { message: "Each candidate needs either {type, id} or {userId} (legacy)." }
);

function normaliseCandidate(c) {
    if (c.userId && !c.type) return { type: "user", id: c.userId };
    return { type: c.type ?? "user", id: c.id };
}

export const createReviewWorkflowTool = {
    title: "Create Review Workflow",
    description: `Create a review workflow in an ACC project.
A workflow defines a sequence of review/approval steps (minimum 2 steps).
Each step has candidates (users, roles, or companies — or a mix) and a time limit.
The projectId MUST include the "b." prefix.

**Candidate ID sources:**
  - users: Autodesk account ID (autodeskId field from getProjectUsersTool)
  - roles: role UUID from \`hq/v2/.../industry_roles\` (see ptp-acc-mcp/list-roles.js)
  - companies: company UUID from accCompanyListTool

**Candidate input shapes (mix freely within one step):**
  - { "type": "user",    "id": "<autodeskId>" }
  - { "type": "role",    "id": "<role-uuid>" }
  - { "type": "company", "id": "<company-uuid>" }
  - { "userId": "<autodeskId>" }   // legacy shape — treated as type="user"

**Initiator:** auto-added from the first user candidate found in step 1
(or via the explicit \`initiatorUserId\` parameter). If neither is available,
the tool returns an error — ACC's Reviews API needs a user as initiator.

**Why role/company candidates matter:** role-based candidates mean "any user
assigned to this role can perform the review" — when staff turnover happens,
the workflow keeps working without modification. The right pattern for any
template you intend to reuse across projects.`,
    inputSchema: {
        projectId: z.string().nonempty()
            .describe('The project ID with "b." prefix'),
        name: z.string().nonempty()
            .describe("Workflow name, e.g. 'Payment Application Review'"),
        description: z.string().optional()
            .describe("What triggers this review workflow"),
        initiatorUserId: z.string().optional()
            .describe("Optional explicit initiator (Autodesk user ID). If omitted, the first user candidate found in step 1 is used."),
        steps: z.string().nonempty()
            .describe(
                'JSON string of steps array. Each step: ' +
                '{"name": "PM Review", "role": "reviewer"|"approver", ' +
                '"candidates": [<see candidate shapes>], "timeAllowed": 5, ' +
                '"dayType": "business_days"|"calendar_days"}'
            ),
    },
    callback: async ({ projectId, name, description, initiatorUserId, steps }) => {
        let parsedSteps;
        try {
            parsedSteps = JSON.parse(steps);
        } catch (e) {
            return {
                content: [{ type: "text", text: `Invalid steps JSON: ${e.message}` }],
            };
        }

        // --- Determine initiator ---
        let initiatorAutodeskId = initiatorUserId;
        if (!initiatorAutodeskId) {
            // Search step 1 for the first user-type candidate
            const step1 = parsedSteps[0];
            const userCandidate = (step1?.candidates ?? [])
                .map(normaliseCandidate)
                .find((c) => c.type === "user");
            if (userCandidate) initiatorAutodeskId = userCandidate.id;
        }
        if (!initiatorAutodeskId) {
            const stepNames = parsedSteps.map((s, i) => s.name || `step ${i + 1}`).join(", ");
            return {
                content: [{
                    type: "text",
                    text:
                        `Cannot create workflow "${name}" — no user candidate found in step 1, ` +
                        `and no \`initiatorUserId\` was supplied. ACC's Reviews API requires ` +
                        `a user as the workflow initiator. Either add a user candidate to ` +
                        `step 1 (alongside any role/company candidates) or pass ` +
                        `\`initiatorUserId\` explicitly. Steps: ${stepNames}.`,
                }],
            };
        }

        const initiatorStep = {
            name: "Initiator",
            type: "INITIATOR",
            candidates: {
                companies: [],
                roles: [],
                users: [{ autodeskId: initiatorAutodeskId }],
            },
        };

        // --- Build review/approver steps ---
        const apiSteps = [initiatorStep];
        for (const step of parsedSteps) {
            const buckets = { users: [], roles: [], companies: [] };
            for (const raw of step.candidates ?? []) {
                const c = normaliseCandidate(raw);
                if (!c.id) continue;
                if (c.type === "user") buckets.users.push({ autodeskId: c.id });
                else if (c.type === "role") buckets.roles.push({ autodeskId: c.id });
                else if (c.type === "company") buckets.companies.push({ autodeskId: c.id });
            }
            // ACC requires at least one candidate per step
            if (
                buckets.users.length === 0 &&
                buckets.roles.length === 0 &&
                buckets.companies.length === 0
            ) {
                return {
                    content: [{
                        type: "text",
                        text:
                            `Step "${step.name || "?"}" has no candidates. ` +
                            `ACC requires at least one user, role, or company candidate per step.`,
                    }],
                };
            }

            apiSteps.push({
                name: step.name || step.step_name || "",
                type: ROLE_MAP[step.role] || step.role?.toUpperCase() || "REVIEWER",
                duration: step.timeAllowed || step.time_allowed || 5,
                dueDateType: DAY_TYPE_MAP[step.dayType || step.day_type] || "BUSINESS_DAY",
                candidates: buckets,
            });
        }

        const body = {
            name,
            description: description || "",
            steps: apiSteps,
            copyFilesOptions: {
                enabled: false,
                allowOverride: false,
                condition: "ANY",
                includeMarkups: false,
                disableOverrideMarkupSetting: false,
            },
        };

        const result = await reviewsApiCall(
            "POST",
            `/projects/${projectId}/workflows`,
            body,
        );

        // Friendly summary text — count by type for diagnostic clarity
        const userCount = apiSteps.reduce((n, s) => n + s.candidates.users.length, 0);
        const roleCount = apiSteps.reduce((n, s) => n + s.candidates.roles.length, 0);
        const companyCount = apiSteps.reduce((n, s) => n + s.candidates.companies.length, 0);

        return {
            content: [{
                type: "text",
                text:
                    `Created review workflow "${name}" with ${apiSteps.length} step(s) ` +
                    `(including initiator). Total candidates across all steps: ` +
                    `${userCount} user(s), ${roleCount} role(s), ${companyCount} company(ies). ` +
                    `Workflow ID: ${result.id || "see structuredContent"}`,
            }],
            structuredContent: { result },
        };
    },
};
