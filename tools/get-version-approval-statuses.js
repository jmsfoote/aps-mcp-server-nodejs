import { z } from "zod";
import {
    reviewsApiCall, reviewsProjectId, reviewsQuery, fetchAllReviewsPages, incompleteNote, mergedPagination,
} from "./reviews-helpers.js";

const FILE_VERSION_URN = /^urn:adsk\.[^:]+:fs\.file:vf\.[^?\s]+\?version=\d+$/;

/** One approval status of a file version: the status and the review it came from. */
export function formatApprovalStatus(row) {
    const status = row?.approvalStatus ? `"${row.approvalStatus.label}" (${row.approvalStatus.value})` : "?";
    const review = row?.review ? `review #${row.review.sequenceId ?? "?"} (${row.review.status ?? "?"}) id ${row.review.id ?? "?"}` : "review ?";
    return `- ${status} — ${review}`;
}

export const getVersionApprovalStatusesTool = {
    title: "Get File Version Approval Statuses",
    description: `Read the approval status of ONE file version across every review it has been in: approved,
rejected or still in review, and which review each status came from. Read-only.
The projectId is the project UUID; the "b." prefix is accepted and optional. versionUrn is one file-version URN,
"urn:adsk.…:fs.file:vf.…?version=N" — the urn of a file in getReviewVersionsTool, or a file's tip version id.
One file version per call.

Row values: APPROVED, REJECTED or IN_REVIEW, with the workflow's own label (e.g. "Approved with comments").
A file version that was never in a review returns no rows. Pages until complete; says INCOMPLETE if it could not.
structuredContent.result = { results: [{ approvalStatus: { id, label, value }, review: { id, sequenceId, status } }],
pagination: { totalResults, pages, complete, … } }.`,
    inputSchema: {
        projectId: reviewsProjectId().describe('The project UUID, with or without the "b." prefix'),
        versionUrn: z.string().regex(FILE_VERSION_URN, { message: 'versionUrn must be a file-version URN: "urn:adsk.…:fs.file:vf.…?version=N"' })
            .describe('One file-version URN, e.g. "urn:adsk.wipprod:fs.file:vf.Ibsc4cPuQEqBHRJdBjhr6w?version=2"'),
    },
    callback: async ({ projectId, versionUrn }) => {
        // The URN goes into the path URL-encoded (":" "?" "=" would otherwise break it).
        const path = `/projects/${projectId}/versions/${encodeURIComponent(versionUrn)}/approval-statuses`;
        const listing = await fetchAllReviewsPages(
            (offset, limit) => reviewsApiCall("GET", path + reviewsQuery([["limit", limit], ["offset", offset]]), null, {
                notFoundMessage: `Reviews API GET ${path} returned 404. No file version ${versionUrn} was found in this project ` +
                    `(check the URN; a 404 here can also mean Reviews is not switched on for the project).`,
            }),
            { idOf: (row) => row?.review?.id },
        );
        const header = `File version ${versionUrn}: ${listing.results.length} approval status(es)${incompleteNote(listing)}`;
        const text = listing.results.length ? `${header}:\n${listing.results.map(formatApprovalStatus).join("\n")}` : header;
        return {
            content: [{ type: "text", text }],
            structuredContent: { result: { results: listing.results, pagination: mergedPagination(listing) } },
        };
    },
};
