import { z } from "zod";
import {
    reviewsApiCall, reviewsProjectId, reviewsUuid, notFoundById, fetchAllReviewsPages,
    incompleteNote, mergedPagination,
} from "./reviews-helpers.js";

/** One file in a review: its name, version URN, approval status and where the approved copy went. */
export function formatReviewVersion(v) {
    const status = v?.approveStatus ? `"${v.approveStatus.label}" (${v.approveStatus.value})` : "no decision yet";
    const copied = v?.copiedFileVersionUrn ? `copied to ${v.copiedFileVersionUrn}` : "no copy made";
    return `- ${v?.name ?? v?.reviewContent?.name ?? "?"} — ${v?.urn ?? "?"}\n    approval: ${status} | ${copied}`;
}

export const getReviewVersionsTool = {
    title: "Get Review Files",
    description: `List the file versions in ONE review, each with its approval status and — when the workflow copies
approved files — the URN of the copy that was made. Read-only. Autodesk returns the latest round only.
The projectId is the project UUID; the "b." prefix is accepted and optional. reviewId is the review's UUID, not the
number shown in Forma.

approveStatusLabels (optional): only files whose approval status has one of these LABELS as defined in the workflow
(e.g. "Approved", "Rejected", "Approved with comments") — the label, not APPROVED / REJECTED.

Text output per file: name, version URN, approval status (label and value), and "copied to <urn>" or "no copy
made". A file with no decision yet has no approval status. Pages until complete; says INCOMPLETE if it could not.
structuredContent.result = { results: [...], pagination: { totalResults, pages, complete, … } }; each result
has urn, itemUrn, name, approveStatus, reviewContent and (if copied) copiedFileVersionUrn.

This only reads. Files cannot be added to or removed from a review through this server.`,
    inputSchema: {
        projectId: reviewsProjectId().describe('The project UUID, with or without the "b." prefix'),
        reviewId: reviewsUuid("reviewId").describe("The review's id (UUID), from getReviewsTool"),
        approveStatusLabels: z.array(z.string().nonempty()).min(1).optional()
            .describe('Only files with one of these approval status labels, e.g. ["Approved", "Approved with comments"]'),
    },
    callback: async ({ projectId, reviewId, approveStatusLabels }) => {
        const path = `/projects/${projectId}/reviews/${reviewId}/versions`;
        // Autodesk takes one filter[approveStatus] per label (a repeated key).
        const labels = (approveStatusLabels ?? []).map((label) => `&filter[approveStatus]=${encodeURIComponent(label)}`).join("");
        const listing = await fetchAllReviewsPages(
            (offset, limit) => reviewsApiCall("GET", `${path}?limit=${limit}&offset=${offset}${labels}`, null, {
                notFoundMessage: notFoundById("GET", path, "review", reviewId),
            }),
            { idOf: (v) => v?.urn },
        );
        const header = `Review ${reviewId}: ${listing.results.length} file version(s)${incompleteNote(listing)}`;
        const text = listing.results.length ? `${header}:\n${listing.results.map(formatReviewVersion).join("\n")}` : header;
        return {
            content: [{ type: "text", text }],
            structuredContent: { result: { results: listing.results, pagination: mergedPagination(listing) } },
        };
    },
};
