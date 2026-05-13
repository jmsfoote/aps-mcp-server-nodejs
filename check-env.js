import dotenv from "dotenv";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const requiredVars = ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "SSA_ID", "SSA_KEY_ID", "SSA_KEY_PATH", "ACC_ACCOUNT_ID"];
const optionalVars = ["ACC_REGION", "ACC_ADS_REGION", "ACC_COST_CONTAINER_ID"];
const secretVars = new Set(["APS_CLIENT_SECRET", "SSA_KEY_PATH"]);
let allGood = true;

for (const v of requiredVars) {
    const val = process.env[v];
    if (!val || val.includes("PASTE_YOUR")) {
        console.log(`MISSING: ${v}`);
        allGood = false;
    } else if (secretVars.has(v)) {
        console.log(`OK: ${v} is set`);
    } else {
        console.log(`OK: ${v} = ${val.substring(0, 8)}...`);
    }
}

for (const v of optionalVars) {
    const val = process.env[v];
    console.log(val && !val.includes("PASTE_YOUR") ? `OK: ${v} is set` : `OPTIONAL: ${v} not set`);
}

const pemPath = process.env.SSA_KEY_PATH;
if (pemPath && !pemPath.includes("PASTE_YOUR")) {
    if (fs.existsSync(pemPath)) {
        console.log(`OK: .pem file exists at ${pemPath}`);
    } else {
        console.log(`MISSING: .pem file NOT found at ${pemPath}`);
        allGood = false;
    }
}

if (allGood) {
    console.log("\nAll checks passed! Ready to connect.");
} else {
    console.log("\nSome checks failed - fix the issues above.");
    process.exitCode = 1;
}
