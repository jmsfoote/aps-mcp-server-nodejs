// Push role-based folder permissions for the JDH/ADG delivery (push wave 2).
//
// Reads the populated XLSX, the persisted folder-id-map.json, and the live
// role list from ADG. Skips role names per James's decisions captured in
// JDH_DELIVERY_LOG.md. Calls the existing setFolderPermissionsTool callback
// path so the EDIT/CONTROL two-step workaround is reused (not reimplemented).

import xlsx from "xlsx";
import fs from "node:fs/promises";
import { setFolderPermissionsTool } from "./tools/set-folder-permissions.js";

const PROJECT_ID = "b.33ff324d-a2a7-468d-b855-da9144175c2f"; // ADG Project Template, WITH b. prefix
const ACCOUNT_ID = "07151d39-3f61-42ff-b204-d9519124058a"; // ADG hub
const XLSX_PATH = "/Users/jamesfoote/Documents/PTP/Construction/Clients/JDH Developments/ACC/PTP-Project-Setup-JDH_Development-POPULATED.xlsx";
const FOLDER_MAP_PATH = "./folder-id-map.json";

// Roles to skip per James decisions 2026-04-30 (see JDH_DELIVERY_LOG.md):
//   - Executive, Executive Admin: covered by Administrator role on project
//   - Funder, Settlement Agent: niche, defer until Nicole pushes back
//   - Certifier, Construction Manager, Contract Administrator, Site Manager:
//     defer until Nicole pushes back
const SKIP_ROLES = new Set([
    "Executive",
    "Executive Admin",
    "Funder",
    "Settlement Agent",
    "Certifier",
    "Construction Manager",
    "Contract Administrator",
    "Site Manager",
]);

const PERMISSION_LEVEL_MAP = {
    "View Only": ["VIEW", "COLLABORATE"],
    "View + Download": ["VIEW", "DOWNLOAD", "COLLABORATE"],
    "View + Download + Upload + Edit": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "EDIT"],
    "Full Control": ["PUBLISH", "VIEW", "DOWNLOAD", "COLLABORATE", "EDIT", "CONTROL"],
};

// --- Load supporting data ---
const folderMap = JSON.parse(await fs.readFile(FOLDER_MAP_PATH, "utf-8"));

// Fetch live role list (hub-scoped) for name → ID lookup
import { getAccessToken } from "./utils.js";
const rolesUrl = `https://developer.api.autodesk.com/hq/v2/accounts/${ACCOUNT_ID}/projects/${PROJECT_ID.replace(/^b\./, "")}/industry_roles`;
const rolesRes = await fetch(rolesUrl, {
    headers: { Authorization: `Bearer ${await getAccessToken()}`, Accept: "application/json" },
});
if (!rolesRes.ok) {
    throw new Error(`Failed to fetch project roles: ${rolesRes.status} ${await rolesRes.text()}`);
}
const rolesList = await rolesRes.json();
const roleNameToId = new Map(rolesList.map((r) => [r.name, r.id]));
console.log(`Loaded ${roleNameToId.size} ACC roles.`);

// --- Read Permissions sheet ---
const wb = xlsx.readFile(XLSX_PATH);
const ws = wb.Sheets["Permissions"];
const range = xlsx.utils.decode_range(ws["!ref"]);
// Header row 14 (1-indexed) = idx 13; data row 15 = idx 14
const rows = [];
for (let r = 14; r <= range.e.r; r++) {
    const role = ws[xlsx.utils.encode_cell({ r, c: 0 })]?.v;
    const folder = ws[xlsx.utils.encode_cell({ r, c: 1 })]?.v;
    const level = ws[xlsx.utils.encode_cell({ r, c: 2 })]?.v;
    if (!role || !folder || !level) continue;
    rows.push({ role: String(role).trim(), folder: String(folder).trim(), level: String(level).trim() });
}
console.log(`Read ${rows.length} permission rows from XLSX.`);

// --- Categorise + group by folder ---
const groupedByFolder = new Map(); // folderId → [{subjectId, subjectType, actions}]
const skipped = { intentional: [], unmapped_role: [], unmapped_folder: [], unmapped_level: [] };

for (const row of rows) {
    if (SKIP_ROLES.has(row.role)) {
        skipped.intentional.push(row);
        continue;
    }
    const roleId = roleNameToId.get(row.role);
    if (!roleId) {
        skipped.unmapped_role.push(row);
        continue;
    }
    const folderId = folderMap[row.folder];
    if (!folderId) {
        skipped.unmapped_folder.push(row);
        continue;
    }
    const actions = PERMISSION_LEVEL_MAP[row.level];
    if (!actions) {
        skipped.unmapped_level.push(row);
        continue;
    }
    if (!groupedByFolder.has(folderId)) groupedByFolder.set(folderId, []);
    groupedByFolder.get(folderId).push({
        subjectId: roleId,
        subjectType: "ROLE",
        actions,
        _meta: { role: row.role, folder: row.folder, level: row.level },
    });
}

console.log(`\n=== Pre-push summary ===`);
console.log(`Permission rows ready to apply: ${[...groupedByFolder.values()].flat().length}`);
console.log(`Folders affected: ${groupedByFolder.size}`);
console.log(`Skipped (intentional): ${skipped.intentional.length}`);
console.log(`Skipped (role not in ACC): ${skipped.unmapped_role.length}`);
console.log(`Skipped (folder not in map): ${skipped.unmapped_folder.length}`);
console.log(`Skipped (permission level unknown): ${skipped.unmapped_level.length}`);
for (const cat of ["unmapped_role", "unmapped_folder", "unmapped_level"]) {
    if (skipped[cat].length) {
        console.log(`\n  ${cat} details:`);
        for (const r of skipped[cat].slice(0, 5)) console.log(`    ${r.role} | ${r.folder} | ${r.level}`);
        if (skipped[cat].length > 5) console.log(`    ... and ${skipped[cat].length - 5} more`);
    }
}

if (process.argv.includes("--dry-run")) {
    console.log("\n--dry-run flag set — exiting without making API calls.");
    process.exit(0);
}

// --- Push ---
console.log(`\n=== Pushing ===`);
let applied = 0;
const errors = [];

for (const [folderId, perms] of groupedByFolder) {
    // Strip _meta before sending to ACC
    const cleanPerms = perms.map(({ _meta, ...p }) => p);
    const folderPath = perms[0]?._meta?.folder ?? "?";
    const roleNames = perms.map((p) => p._meta.role).join(", ");
    process.stdout.write(`  ${folderPath} ← [${roleNames}] `);
    try {
        await setFolderPermissionsTool.callback({
            projectId: PROJECT_ID,
            folderId,
            permissions: cleanPerms,
        });
        applied += perms.length;
        process.stdout.write(`✓\n`);
    } catch (e) {
        errors.push({ folderPath, roleNames, error: e.message || String(e) });
        process.stdout.write(`✗ ${e.message || e}\n`);
    }
}

console.log(`\n=== Result ===`);
console.log(`Applied: ${applied} permission grants across ${groupedByFolder.size - errors.length} folders`);
console.log(`Errors:  ${errors.length}`);
if (errors.length) {
    for (const e of errors) console.log(`  - ${e.folderPath}: ${e.error}`);
}
