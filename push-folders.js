// One-off: push the JDH folder structure (141 folders) to ADG Project Template.
// Reads the populated XLSX, depth-orders the folders, and creates each via the
// dataManagementClient (same path as createFolderTool). Pre-seeds the
// path→folderId map with the 7 depth-0 folders already created via MCP.

import xlsx from "xlsx";
import { dataManagementClient } from "./utils.js";

const PROJECT_ID = "b.33ff324d-a2a7-468d-b855-da9144175c2f"; // ADG Project Template, WITH b. prefix
const XLSX_PATH = "/Users/jamesfoote/Documents/PTP/Construction/Clients/JDH Developments/ACC/PTP-Project-Setup-JDH_Development-POPULATED.xlsx";
const PROJECT_FILES_ROOT = "urn:adsk.wipprodanz:fs.folder:co.WJdlPe1lSH2ZS_91g-qf9Q";

// Pre-seed map with the 7 depth-0 folders already created (via MCP, depth-0 phase)
const SEED_MAP = {
    "Project Files": PROJECT_FILES_ROOT,
    "1. Acquisition": "urn:adsk.wipprodanz:fs.folder:co.GKWAYSEYR1u_d7Wxnb6naQ",
    "2. Finance": "urn:adsk.wipprodanz:fs.folder:co.ilK486WYS16l6wp4HAyKMA",
    "3. Council": "urn:adsk.wipprodanz:fs.folder:co._rkhOINwReOjtggxiwuR9Q",
    "4. Design": "urn:adsk.wipprodanz:fs.folder:co.SoIRrtLUQ6uw27C_tI66fA",
    "5. Construction": "urn:adsk.wipprodanz:fs.folder:co.Mr6laY18QpeItCVT_9JL-w",
    "6. Leasing": "urn:adsk.wipprodanz:fs.folder:co.dX6gSWXgSC-SL0ZfVFKdCw",
    "7. Sale": "urn:adsk.wipprodanz:fs.folder:co.UAUPbffTQIaXGGWQIhrLDA",
};

// --- Read folders from XLSX ---
const wb = xlsx.readFile(XLSX_PATH);
const ws = wb.Sheets["Folders"];
const range = xlsx.utils.decode_range(ws["!ref"]);

const folders = [];
// Header row 8 in 1-indexed = row 7 in 0-indexed; data starts row 9 (idx 8)
for (let r = 8; r <= range.e.r; r++) {
    const pathCell = ws[xlsx.utils.encode_cell({ r, c: 0 })];
    const parentCell = ws[xlsx.utils.encode_cell({ r, c: 1 })];
    if (!pathCell || !pathCell.v) continue;
    const folderPath = String(pathCell.v).trim();
    const parentPath = parentCell ? String(parentCell.v).trim() : "Project Files";
    const parts = folderPath.split("/");
    const folderName = parts[parts.length - 1].trim();
    const depth = parts.length - 1;
    folders.push({ folderPath, folderName, parentPath: parentPath || "Project Files", depth });
}

console.log(`Read ${folders.length} folders from XLSX.`);
const byDepth = {};
for (const f of folders) (byDepth[f.depth] ||= []).push(f);
for (const d of Object.keys(byDepth).sort()) console.log(`  depth ${d}: ${byDepth[d].length}`);

// --- Push folders depth-by-depth ---
const pathToId = { ...SEED_MAP };
const errors = [];
let created = 0;
let skipped = 0;

async function createOne(folder) {
    const parentId = pathToId[folder.parentPath];
    if (!parentId) {
        errors.push(`${folder.folderPath}: parent "${folder.parentPath}" not in map`);
        return null;
    }
    const payload = {
        jsonapi: { version: "1.0" },
        data: {
            type: "folders",
            attributes: {
                name: folder.folderName,
                extension: { type: "folders:autodesk.bim360:Folder", version: "1.0" },
            },
            relationships: { parent: { data: { type: "folders", id: parentId } } },
        },
    };
    try {
        const result = await dataManagementClient.createFolder(PROJECT_ID, payload);
        const id = result.data?.id;
        if (!id) throw new Error("no id in response");
        pathToId[folder.folderPath] = id;
        created++;
        return id;
    } catch (e) {
        // If folder already exists (409 conflict), try to skip gracefully
        const msg = e?.message || String(e);
        if (/already exists|conflict|409/i.test(msg)) {
            skipped++;
            errors.push(`${folder.folderPath}: already exists (skipped)`);
            return null;
        }
        errors.push(`${folder.folderPath}: ${msg}`);
        return null;
    }
}

const depths = Object.keys(byDepth).map(Number).filter(d => d > 0).sort((a, b) => a - b);
for (const depth of depths) {
    const batch = byDepth[depth];
    process.stdout.write(`\nDepth ${depth} (${batch.length} folders): `);
    // Process in serial within depth to be gentle on the API; could parallelise later
    for (const f of batch) {
        const id = await createOne(f);
        process.stdout.write(id ? "." : "x");
    }
}

console.log(`\n\n=== Summary ===`);
console.log(`Created: ${created}`);
console.log(`Skipped (already exists): ${skipped}`);
console.log(`Errors:  ${errors.filter(e => !e.includes("already exists")).length}`);
if (errors.length) {
    console.log(`\nDetails:`);
    for (const e of errors) console.log(`  - ${e}`);
}
console.log(`\nFinal pathToId map size: ${Object.keys(pathToId).length}`);

// Persist the path→id map for the next push wave (permissions need it)
import fs from "node:fs/promises";
const outPath = "/Users/jamesfoote/Documents/PTP/Construction/ptp-acc-mcp/folder-id-map.json";
await fs.writeFile(outPath, JSON.stringify(pathToId, null, 2));
console.log(`Map written to ${outPath}`);
