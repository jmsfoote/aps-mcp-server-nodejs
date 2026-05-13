import dotenv from "dotenv";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const vars = ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "SSA_ID", "SSA_KEY_ID", "SSA_KEY_PATH", "ACC_ACCOUNT_ID", "ACC_REGION", "ACC_ADS_REGION"];
let allGood = true;

for (const v of vars) {
    const val = process.env[v];
    if (!val || val.includes("PASTE_YOUR")) {
        console.log(`MISSING: ${v}`);
        allGood = false;
    } else {
        console.log(`OK: ${v} = ${val.substring(0, 8)}...`);
    }
}

const pemPath = process.env.SSA_KEY_PATH;
if (fs.existsSync(pemPath)) {
    console.log(`OK: .pem file exists at ${pemPath}`);
} else {
    console.log(`MISSING: .pem file NOT found at ${pemPath}`);
    allGood = false;
}

console.log(allGood ? "\nAll checks passed! Ready to connect." : "\nSome checks failed - fix the issues above.");
