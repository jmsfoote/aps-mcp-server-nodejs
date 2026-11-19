import { z } from "zod";
import { reviewsApiCall, reviewsProjectId, reviewsUuid, formatReview } from "./reviews-helpers.js";
import { bucketCandidates, CandidateSchema, MAX_NAME, MAX_TEXT } from "./create-review-workflow.js";

// Request contract: https://aps.autodesk.com/en/docs/acc/v1/reference/http/reviews-createreview-POST/
//   { name, fileVersions: [{ urn }], workflowId, notes?, workflowOptions?: { copyFilesOptions: { folderUrn },
//     steps: [{ id, candidates: { users, roles, companies } }] } }
// Until 2026-11 this tool sent { workflowId, name, description, documentVersionId }, which is not that
// contract. `documentVersionId` and `description` are still accepted as inputs and mapped onto it.

export const MAX_FILE_VERSIONS = 1000;
const FILE_VERSION_URN = /^urn:adsk\.[^:]+:fs\.file:vf\.[^?\s]+\?version=\d+$/;
const FOLDER_URN = /^urn:adsk\.[^:]+:fs\.folder:/;

const WorkflowOptionsSchema = z.object({
    copyFilesOptions: z.object({ folderUrn: z.string().nonempty() }).strict().optional(),
    steps: z.array(z.object({
        id: z.string().nonempty(),
        candidates: z.array(CandidateSchema).nonempty(),
    }).strict()).nonempty().optional(),
}).strict();

function refuse(text) {
    throw new Error(text);
}

/**
 * Build the POST body from the tool's arguments, or throw a refusal naming the field that is wrong.
 * Pure: no network.
 */
export function buildReviewRequest({ workflowId, name, notes, description, fileVersionUrns, documentVersionId, workflowOptions }) {
    if (typeof name !== "string" || name.length === 0) refuse(`Review name is required; nothing was sent to Autodesk.`);
    if (name.length > MAX_NAME) refuse(`Review name is ${name.length} characters; the limit is ${MAX_NAME}. Nothing was sent to Autodesk.`);

    // notes is Autodesk's field (shown as "Description" in Forma); description is this tool's older name for it.
    if (notes !== undefined && description !== undefined && notes !== description) {
        refuse(`Pass notes or description, not both with different text (description is the older name for notes). Nothing was sent to Autodesk.`);
    }
    const text = notes ?? description;
    if (text !== undefined && text.length > MAX_TEXT) refuse(`notes is ${text.length} characters; the limit is ${MAX_TEXT}. Nothing was sent to Autodesk.`);

    if (fileVersionUrns !== undefined && documentVersionId !== undefined) {
        refuse(`Pass fileVersionUrns or documentVersionId, not both (documentVersionId is the older, single-file form). Nothing was sent to Autodesk.`);
    }
    const urns = fileVersionUrns ?? (documentVersionId !== undefined ? [documentVersionId] : []);
    if (urns.length === 0) refuse(`No file was given: pass fileVersionUrns (one or more file-version URNs). Nothing was sent to Autodesk.`);
    if (urns.length > MAX_FILE_VERSIONS) refuse(`${urns.length} file versions were given; one review takes at most ${MAX_FILE_VERSIONS}. Nothing was sent to Autodesk.`);
    const seen = new Set();
    urns.forEach((urn, i) => {
        if (typeof urn !== "string" || !FILE_VERSION_URN.test(urn)) {
            refuse(
                `File ${i + 1}: "${urn}" is not a file-version URN. Expected "urn:adsk.…:fs.file:vf.…?version=N" ` +
                `(a file's tip version id, not the file's lineage id "urn:adsk.…:dm.lineage:…"). Nothing was sent to Autodesk.`
            );
        }
        if (seen.has(urn)) refuse(`File ${i + 1}: "${urn}" is listed twice. Nothing was sent to Autodesk.`);
        seen.add(urn);
    });

    const body = { name, fileVersions: urns.map((urn) => ({ urn })), workflowId };
    if (text !== undefined && text !== "") body.notes = text;

    if (workflowOptions !== undefined && workflowOptions !== null) {
        const options = {};
        const folderUrn = workflowOptions.copyFilesOptions?.folderUrn;
        if (folderUrn !== undefined) {
            if (!FOLDER_URN.test(folderUrn)) {
                refuse(`workflowOptions.copyFilesOptions.folderUrn "${folderUrn}" is not a folder URN (expected "urn:adsk.…:fs.folder:co.…"). Nothing was sent to Autodesk.`);
            }
            options.copyFilesOptions = { folderUrn };
        }
        if (workflowOptions.steps !== undefined) {
            const stepIds = new Set();
            options.steps = workflowOptions.steps.map((step, i) => {
                if (stepIds.has(step.id)) refuse(`workflowOptions.steps[${i}]: step id "${step.id}" is listed twice. Nothing was sent to Autodesk.`);
                stepIds.add(step.id);
                return { id: step.id, candidates: bucketCandidates(step.candidates, `workflowOptions.steps[${i}] ("${step.id}")`) };
            });
        }
        if (Object.keys(options).length) body.workflowOptions = options;
    }
    return body;
}

const INPUT_SHAPE = {
    projectId: reviewsProjectId()
        .describe('The project UUID, with or without the "b." prefix'),
    workflowId: reviewsUuid("workflowId")
        .describe("The id of the review workflow to run (from getReviewWorkflowsTool)"),
    name: z.string().nonempty()
        .describe("Review name (max 255), e.g. 'PA-001 Review'. Names need not be unique: calling twice starts two reviews."),
    fileVersionUrns: z.array(z.string()).optional()
        .describe('The file versions to review, 1 to 1000: each a file-version URN "urn:adsk.…:fs.file:vf.…?version=N" (a file\'s tip version id from getFolderContentsTool\'s structuredContent, not the lineage id).'),
    notes: z.string().optional()
        .describe('Text shown to reviewers, labelled "Description" in Forma (max 4096).'),
    workflowOptions: WorkflowOptionsSchema.optional()
        .describe('Per-review overrides. {"copyFilesOptions": {"folderUrn": "urn:adsk.…:fs.folder:co.…"}} changes where approved files are copied (the workflow must allow it). {"steps": [{"id": "<step id from getReviewWorkflowTool>", "candidates": [{"type": "user"|"role"|"company", "id": "…"}]}]} replaces who acts on that step for this review only (role / company ids are member-group ids).'),
    documentVersionId: z.string().optional()
        .describe("Older single-file input, kept for compatibility: one file-version URN. Prefer fileVersionUrns. Do not pass both."),
    description: z.string().optional()
        .describe("Older name for notes, kept for compatibility. Do not pass both with different text."),
};

export const createReviewTool = {
    title: "Create Review",
    description: `Start a review of one or more file versions with an existing review workflow, in an ACC / Forma project.
THIS WRITES, SENDS REAL NOTIFICATIONS, AND CANNOT BE UNDONE FROM HERE: the first step's candidates are notified by
Autodesk at once, and a review cannot be voided, closed, edited or deleted through this server (Autodesk offers no
such endpoint) — only by hand in Forma. Nor can a step be claimed, approved or rejected from here.

The projectId is the project UUID; the "b." prefix is accepted and optional.
Use getReviewWorkflowsTool to get the workflowId, and getReviewWorkflowTool for step ids if you override a step.
The live proof (2026-11-19) started a review with the service account listed among the workflow's initiator
candidates; whether Autodesk lets an account that is not an initiator candidate start one was not tested.

Review names are not unique: calling this twice starts two reviews and notifies twice. The create is sent exactly
once and never retried; a refused input or an Autodesk error fails the call (isError).

Output: the new review's number, id, status, the step it is waiting at and who acts next.
structuredContent.result = Autodesk's review record. Track it with getReviewTool, getReviewProgressTool and
getReviewVersionsTool.`,
    // A strict object, not a bare shape: an unknown or misspelt input is refused instead of silently dropped.
    inputSchema: z.object(INPUT_SHAPE).strict(),
    callback: async (input) => {
        // Parsed again here so a direct call (tests, scripts) gets the same checks the MCP server applies.
        const args = createReviewTool.inputSchema.parse(input);
        const body = buildReviewRequest(args);

        const result = await reviewsApiCall(
            "POST",
            `/projects/${args.projectId}/reviews`,
            body
        );

        const fileCount = body.fileVersions.length;
        const warning = result?.status && result.status !== "OPEN"
            ? `\nWARNING — Autodesk reports this review's status as ${result.status}, not OPEN.`
            : "";
        return {
            content: [{
                type: "text",
                text:
                    `Created review "${args.name}" using workflow ${args.workflowId}. Review ID: ${result.id || "see structuredContent"}\n` +
                    `${fileCount} file version(s) sent.${warning}\n${formatReview(result)}`,
            }],
            structuredContent: { result },
        };
    },
};
