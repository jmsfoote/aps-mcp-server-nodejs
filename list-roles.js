// One-off: list all configured project roles for ADG Project Template.
// Reason: setFolderPermissionsTool needs role IDs (subjectType="ROLE") and the
// MCP doesn't currently expose a getProjectRolesTool. The legacy BIM 360 HQ v2
// industry_roles endpoint returns the full list including unassigned roles.

import { getAccessToken } from "./utils.js";

const ACCOUNT_ID = "07151d39-3f61-42ff-b204-d9519124058a"; // ADG hub, no b. prefix
const PROJECT_ID = "33ff324d-a2a7-468d-b855-da9144175c2f"; // ADG Project Template, no b. prefix

const url = `https://developer.api.autodesk.com/hq/v2/accounts/${ACCOUNT_ID}/projects/${PROJECT_ID}/industry_roles`;

const token = await getAccessToken();
const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
});

if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
}

const roles = await res.json();
console.log(`Total roles: ${Array.isArray(roles) ? roles.length : "(non-array response)"}\n`);
if (Array.isArray(roles)) {
    for (const r of roles) {
        console.log(`  ${r.id}  ${r.name}${r.status && r.status !== "active" ? `  [${r.status}]` : ""}`);
    }
} else {
    console.log(JSON.stringify(roles, null, 2));
}
