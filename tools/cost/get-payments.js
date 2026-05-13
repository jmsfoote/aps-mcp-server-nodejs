import { z } from "zod";
import { costApiFetchAll, getFirst, numVal } from "./cost-helpers.js";

export const getPaymentsTool = {
    title: "Get Payments",
    description:
        "List payment applications/progress claims in ACC Cost Management. " +
        "Returns payment numbers, amounts, dates, and billing period details. " +
        "Use getCostContainerTool first to resolve the containerId.",
    inputSchema: {
        containerId: z
            .string()
            .nonempty()
            .describe("Cost container ID (from getCostContainerTool)"),
        limit: z
            .number()
            .optional()
            .default(200)
            .describe("Items per page (max 200)"),
    },
    callback: async ({ containerId, limit }) => {
        const result = await costApiFetchAll(containerId, "payments", {}, limit);

        if (result.error) {
            return {
                content: [{ type: "text", text: `Error fetching payments: ${result.message}` }],
                structuredContent: result,
            };
        }

        const payments = result.data.map((p) => ({
            id: getFirst(p, "id", "paymentId"),
            number: getFirst(p, "number", "paymentNumber", "payment_no"),
            title: getFirst(p, "title", "name", "description"),
            status: getFirst(p, "status", "state"),
            amount: numVal(getFirst(p, "amount", "totalAmount", "paymentAmount", "grossAmount")),
            paid: numVal(getFirst(p, "paid", "paidAmount", "amountPaid")),
            currency: getFirst(p, "currency", "currencyCode"),
            paymentDate: getFirst(p, "paymentDate", "date", "paidAt", "createdAt"),
            startDate: p.startDate,
            endDate: p.endDate,
            dueDate: p.dueDate,
        }));

        const totalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const totalPaid = payments.reduce((s, p) => s + (p.paid || 0), 0);

        const lines = payments.map(
            (p) =>
                `- ${p.number || "—"} | ${p.title || "—"} | ` +
                `Amount: ${fmt(p.amount)} | Paid: ${fmt(p.paid)} | ` +
                `Date: ${p.paymentDate || "—"} | ${p.status || "—"}`
        );

        const summary =
            `${payments.length} payment(s) found.\n` +
            `Totals — Amount: ${fmt(totalAmount)}, Paid: ${fmt(totalPaid)}\n\n` +
            lines.join("\n");

        return {
            content: [{ type: "text", text: summary }],
            structuredContent: { payments, totals: { amount: totalAmount, paid: totalPaid } },
        };
    },
};

function fmt(n) {
    if (n === undefined || n === null) return "—";
    return `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
