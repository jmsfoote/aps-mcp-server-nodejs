import { z } from "zod";
import { costApiCall, formatCostApiError, getFirst } from "./cost-helpers.js";

// Phase 0 (2026-06-03) verification on Parkside Residences sandbox confirmed:
//   Endpoint: POST /cost/v1/containers/:id/attachments
//             (NOT `documents` — POST to /documents returns 405 Method Not
//             Allowed; `documents` is a read-only association view. `attachments`
//             is the write surface for associating a file with a cost resource.)
//   Required (validation order): associationType → associationId → urn → name.
//   urn is NOT validated: a non-existent OSS urn is accepted (201). The operator
//             / wave handler must upload the PDF first (Data Management / OSS) and
//             pass the resulting object urn; this tool does NOT perform the upload.
//   Targets:  both `Expense` and `ExpenseItem` are valid association types
//             (verified 201 on each). The endpoint is general (GET also accepts
//             CostItem / Contract / MainContract / ChangeOrder /
//             PaymentApplication / FormInstance) but this tool is scoped to the
//             expense resources the Slice-3 wave handler attaches to; broaden the
//             enum in M7b if other resources need attachments.
//   Response: { id, urn, name, type:"Upload", status:"Complete", associationType,
//             associationId, ... }.
export const attachPdfToCostResourceTool = {
    title: "Attach PDF to Cost Resource",
    description:
        "Attach an already-uploaded PDF (or other file) to an ACC Cost Management " +
        "expense or expense line item. Provide the object `urn` of the uploaded " +
        "file — this tool does NOT upload; the file must already exist in OSS/" +
        "Docs. `associationType` is 'Expense' or 'ExpenseItem' and `associationId` " +
        "is that resource's id. The urn is stored as-is and is not validated by " +
        "the API, so pass a real object urn. Use getCostContainerTool first to " +
        "resolve the containerId.",
    inputSchema: {
        containerId: z.string().nonempty().describe("Cost container ID"),
        associationType: z
            .enum(["Expense", "ExpenseItem"])
            .describe("Cost resource type to attach to: 'Expense' or 'ExpenseItem'"),
        associationId: z.string().nonempty().describe("Id of the expense or expense line item to attach to"),
        urn: z
            .string()
            .nonempty()
            .describe("Object urn of the already-uploaded file (e.g. urn:adsk.objects:os.object:...). Not validated by the API."),
        name: z.string().nonempty().describe("File name shown in ACC (e.g. 'invoice.pdf')"),
    },
    callback: async ({ containerId, associationType, associationId, urn, name }) => {
        const body = { associationType, associationId, urn, name };
        const result = await costApiCall("POST", containerId, "attachments", {}, body);
        if (result.error) {
            return {
                content: [{ type: "text", text: formatCostApiError(result) }],
                structuredContent: result,
            };
        }

        const created = result.data?.[0] ?? {};
        const summary = {
            id: getFirst(created, "id", "attachmentId"),
            name: getFirst(created, "name"),
            urn: getFirst(created, "urn"),
            type: getFirst(created, "type"),
            status: getFirst(created, "status"),
            associationType: getFirst(created, "associationType"),
            associationId: getFirst(created, "associationId"),
        };
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Attached "${summary.name ?? name}" to ${summary.associationType ?? associationType} ${summary.associationId ?? associationId}\n` +
                        `Attachment id: ${summary.id ?? "—"} | status: ${summary.status ?? "—"}`,
                },
            ],
            structuredContent: { attachment: created, summary },
        };
    },
};
