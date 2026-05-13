// Rename all 141 folders in ADG Project Template to use the hierarchical
// numbering scheme (1.1., 2.5.1., etc.). Pairs the pre-renumber backup XLSX
// with the post-renumber populated XLSX to determine old_path → new_path,
// looks up URNs via folder-id-map.json, and renames via patchFolder.
//
// Top-level folders (1. Acquisition, 2. Finance, …) already had numbers and
// don't need renaming — only the 134 child folders that gained numeric prefixes.
//
// After successful renames, folder-id-map.json is rewritten with new_path keys.

import xlsx from "xlsx";
import fs from "node:fs/promises";
import { renameFolderTool } from "./tools/rename-folder.js";

const PROJECT_ID = "b.33ff324d-a2a7-468d-b855-da9144175c2f"; // ADG Project Template, WITH b. prefix
const XLSX_CURRENT = "/Users/jamesfoote/Documents/PTP/Construction/Clients/JDH Developments/ACC/PTP-Project-Setup-JDH_Development-POPULATED.xlsx";
const XLSX_BACKUP = "/Users/jamesfoote/Documents/PTP/Construction/Clients/JDH Developments/ACC/PTP-Project-Setup-JDH_Development-POPULATED.xlsx.bak-pre-renumber-20260501-092453";
const FOLDER_MAP_PATH = "./folder-id-map.json";

// --- Read paired old/new paths ---
function readFolderPaths(xlsxPath) {
    const wb = xlsx.readFile(xlsxPath);
    const ws = wb.Sheets["Folders"];
    const range = xlsx.utils.decode_range(ws["!ref"]);
    const paths = [];
    // Header row 8 (1-indexed) = idx 7; data starts row 9 = idx 8
    for (let r = 8; r <= range.e.r; r++) {
        const v = ws[xlsx.utils.encode_cell({ r, c: 0 })]?.v;
        if (v) paths.push(String(v).trim());
    }
    return paths;
}

const oldPaths = readFolderPaths(XLSX_BACKUP);
const newPaths = readFolderPaths(XLSX_CURRENT);
if (oldPaths.length !== newPaths.length) {
    throw new Error(`Row count mismatch: backup has ${oldPaths.length}, current has ${newPaths.length}`);
}

// --- Load URN map ---
const folderIdMap = JSON.parse(await fs.readFile(FOLDER_MAP_PATH, "utf-8"));

// --- Build rename plan ---
const renames = [];
const oldToNew = new Map();
for (let i = 0; i < oldPaths.length; i++) {
    const oldPath = oldPaths[i];
    const newPath = newPaths[i];
    oldToNew.set(oldPath, newPath);

    const urn = folderIdMap[oldPath];
    if (!urn) {
        console.warn(`No URN for old path: ${oldPath} — skipping`);
        continue;
    }
    const oldLeaf = oldPath.split("/").pop();
    const newLeaf = newPath.split("/").pop();
    if (oldLeaf !== newLeaf) {
        renames.push({ urn, oldLeaf, newLeaf, oldPath, newPath });
    }
}

console.log(`Total folders in XLSX: ${oldPaths.length}`);
console.log(`Renames needed (leaf changed): ${renames.length}`);
console.log(`Unchanged (top-level folders already numbered): ${oldPaths.length - renames.length}`);

if (process.argv.includes("--dry-run")) {
    console.log("\n--dry-run set — exiting before API calls.");
    console.log("\nFirst 10 renames:");
    for (const { oldLeaf, newLeaf } of renames.slice(0, 10)) {
        console.log(`  "${oldLeaf}" → "${newLeaf}"`);
    }
    process.exit(0);
}

// --- Apply renames with proper retry logic ---
//
// Two distinct failure modes observed on the first run:
//   - 423 LOCKED: parent folder locked while it's being renamed in the
//     previous call. The parent's first 1–3 children fail with 423 if pacing
//     is too fast. Fix: 1.5s base delay + retry-on-423 with 3s sleep.
//   - 429 quota: APS rate limit kicked in after ~75 calls, then the SDK's
//     internal circuit breaker opened and prevented all further calls. Fix:
//     pace at <1 call/sec average, sleep 60s on 429 to let breaker close.
//
// Idempotency: re-naming a folder to its current name returns success silently
// (PATCH semantics — same value is a no-op). Already-successful renames from a
// previous run will pass through cleanly on a re-run.

console.log("\n=== Applying renames ===");
const errors = [];
let succeeded = 0;
let i = 0;

async function patchOnce(urn, newLeaf) {
    return await renameFolderTool.callback({
        projectId: PROJECT_ID,
        folderId: urn,
        newName: newLeaf,
    });
}

for (const { urn, oldLeaf, newLeaf } of renames) {
    i++;
    let attempts = 0;
    let lastErr = null;
    while (attempts < 3) {
        attempts++;
        try {
            await patchOnce(urn, newLeaf);
            succeeded++;
            process.stdout.write(`[${i}/${renames.length}] ✓ ${oldLeaf} → ${newLeaf}${attempts > 1 ? ` (after ${attempts} attempts)` : ""}\n`);
            lastErr = null;
            break;
        } catch (e) {
            lastErr = e;
            const msg = e.message || String(e);
            if (/423|locked/i.test(msg) && attempts < 3) {
                process.stdout.write(`[${i}/${renames.length}] … 423 LOCKED on ${oldLeaf}, sleeping 3s and retrying\n`);
                await new Promise((r) => setTimeout(r, 3000));
                continue;
            }
            if (/429|too many|quota|circuit breaker/i.test(msg)) {
                process.stdout.write(`[${i}/${renames.length}] … 429/breaker on ${oldLeaf}, sleeping 60s and retrying\n`);
                await new Promise((r) => setTimeout(r, 60000));
                continue;
            }
            // Non-retryable
            break;
        }
    }
    if (lastErr) {
        errors.push({ oldLeaf, newLeaf, error: lastErr.message || String(lastErr) });
        process.stdout.write(`[${i}/${renames.length}] ✗ ${oldLeaf}: ${lastErr.message || lastErr}\n`);
    }
    // Pace at 1.5s between calls — well under the rate limit, gives parent
    // locks time to release between sibling renames
    await new Promise((r) => setTimeout(r, 1500));
}

// --- Update folder-id-map.json ---
console.log("\n=== Updating folder-id-map.json ===");
const newMap = {};
for (const [oldPath, urn] of Object.entries(folderIdMap)) {
    if (oldPath === "Project Files") {
        newMap[oldPath] = urn;
        continue;
    }
    const newPath = oldToNew.get(oldPath);
    newMap[newPath ?? oldPath] = urn;
}
await fs.writeFile(FOLDER_MAP_PATH, JSON.stringify(newMap, null, 2));
console.log(`Wrote ${Object.keys(newMap).length} entries to ${FOLDER_MAP_PATH}`);

// --- Result ---
console.log("\n=== Result ===");
console.log(`Succeeded: ${succeeded}/${renames.length}`);
console.log(`Errors:    ${errors.length}`);
if (errors.length) {
    console.log("\nErrors detail:");
    for (const e of errors) console.log(`  ${e.oldLeaf}: ${e.error}`);
}
