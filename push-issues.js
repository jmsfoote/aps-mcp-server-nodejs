// Push issues wave 3 — reads 17 issues from the populated XLSX and creates
// each one in ADG Project Template via createIssueTool. All 17 are typed
// General/General per James decision, assignee admin@jdhdevelopmentswa.com.au
// which ACC has registered to Joshua Hill.
//
// Pacing: 1.5s between calls (per learning #11 from JDH_DELIVERY_LOG —
// avoids both 423 LOCKED and 429 quota issues for bulk ACC writes).

import xlsx from "xlsx";
import { createIssueTool } from "./tools/create-issue.js";

const PROJECT_ID = "33ff324d-a2a7-468d-b855-da9144175c2f"; // ADG Project Template, NO b. prefix (Issues is Account Admin API)
const XLSX_PATH = "/Users/jamesfoote/Documents/PTP/Construction/Clients/JDH Developments/ACC/PTP-Project-Setup-JDH_Development-POPULATED.xlsx";

// General/General is universal — present on every ACC project by default.
// Subtype ID confirmed via getIssueTypesTool earlier in the JDH delivery.
const GENERAL_GENERAL_SUBTYPE_ID = "fefd5e2a-c722-43ff-80c1-3f9f9182ded1";

// Assignee email → Autodesk ID. From getProjectUsersTool 2026-05-05:
// admin@jdhdevelopmentswa.com.au resolves to Joshua Hill (note: James said
// it's Nicole's email, but ACC has it registered to Joshua — they share
// the mailbox. Issues land assigned to Joshua. Nicole/Josh resolve in
// the backend later).
const EMAIL_TO_AUTODESK_ID = {
    "admin@jdhdevelopmentswa.com.au": "HPM2YVLFM37MV7LX",
};

// --- Read issues from XLSX ---
const wb = xlsx.readFile(XLSX_PATH);
const ws = wb.Sheets["Issues"];
const range = xlsx.utils.decode_range(ws["!ref"]);

// Find header row by scanning for "Issue Title" in column A
let headerRow = null;
for (let r = 0; r <= Math.min(15, range.e.r); r++) {
    const v = ws[xlsx.utils.encode_cell({ r, c: 0 })]?.v;
    if (v === "Issue Title") {
        headerRow = r;
        break;
    }
}
if (headerRow === null) throw new Error("Could not find 'Issue Title' header in Issues sheet");

const issues = [];
for (let r = headerRow + 1; r <= range.e.r; r++) {
    const title = ws[xlsx.utils.encode_cell({ r, c: 0 })]?.v;
    if (!title) continue;
    issues.push({
        title: String(title).trim(),
        description: String(ws[xlsx.utils.encode_cell({ r, c: 1 })]?.v ?? "").trim(),
        type: String(ws[xlsx.utils.encode_cell({ r, c: 2 })]?.v ?? "").trim(),
        subtype: String(ws[xlsx.utils.encode_cell({ r, c: 3 })]?.v ?? "").trim(),
        status: String(ws[xlsx.utils.encode_cell({ r, c: 4 })]?.v ?? "open").trim(),
        assigneeEmail: String(ws[xlsx.utils.encode_cell({ r, c: 5 })]?.v ?? "").trim(),
        dueDate: String(ws[xlsx.utils.encode_cell({ r, c: 6 })]?.v ?? "").trim(),
    });
}

console.log(`Read ${issues.length} issues from XLSX`);
console.log(`Verifying — all 17 should be General/General:`);
const typeCount = {};
for (const i of issues) {
    const k = `${i.type}/${i.subtype}`;
    typeCount[k] = (typeCount[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(typeCount)) console.log(`  ${k}: ${n}`);

if (process.argv.includes("--dry-run")) {
    console.log("\n--dry-run set — exiting");
    process.exit(0);
}

// --- Push ---
console.log("\n=== Pushing ===");
const errors = [];
let succeeded = 0;
let i = 0;

for (const issue of issues) {
    i++;
    const autodeskId = EMAIL_TO_AUTODESK_ID[issue.assigneeEmail];
    if (!autodeskId) {
        const msg = `No Autodesk ID for assignee ${issue.assigneeEmail}`;
        errors.push({ title: issue.title, error: msg });
        console.log(`[${i}/${issues.length}] ✗ ${issue.title}: ${msg}`);
        continue;
    }

    const args = {
        projectId: PROJECT_ID,
        title: issue.title,
        issueSubtypeId: GENERAL_GENERAL_SUBTYPE_ID,
        description: issue.description || undefined,
        status: issue.status || undefined,
        assignedTo: autodeskId,
        assignedToType: "user",
        dueDate: issue.dueDate || undefined,
    };

    try {
        await createIssueTool.callback(args);
        succeeded++;
        console.log(`[${i}/${issues.length}] ✓ ${issue.title}`);
    } catch (e) {
        const msg = e.message || String(e);
        errors.push({ title: issue.title, error: msg });
        console.log(`[${i}/${issues.length}] ✗ ${issue.title}: ${msg}`);
    }

    // 1.5s pacing per learning #11
    await new Promise((r) => setTimeout(r, 1500));
}

// --- Result ---
console.log("\n=== Result ===");
console.log(`Succeeded: ${succeeded}/${issues.length}`);
console.log(`Errors:    ${errors.length}`);
if (errors.length) {
    for (const e of errors) console.log(`  ${e.title}: ${e.error}`);
}
