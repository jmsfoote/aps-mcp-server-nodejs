import path from "node:path";
import url from "node:url";
import dotenv from "dotenv";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env"), quiet: true });
const { APS_CLIENT_ID, APS_CLIENT_SECRET, SSA_ID, SSA_KEY_ID, SSA_KEY_PATH, ACC_ACCOUNT_ID, ACC_REGION, ACC_ADS_REGION, ACC_COST_CONTAINER_ID } = process.env;
if (!APS_CLIENT_ID || !APS_CLIENT_SECRET || !SSA_ID || !SSA_KEY_ID || !SSA_KEY_PATH) {
    console.error("Missing one or more required environment variables: APS_CLIENT_ID, APS_CLIENT_SECRET, SSA_ID, SSA_KEY_ID, SSA_KEY_PATH");
    console.error("Copy .env.example to .env and fill in your values.");
    process.exit(1);
}
if (!ACC_ACCOUNT_ID) {
    console.error("Missing ACC_ACCOUNT_ID in .env — required for project setup operations.");
    console.error("Find it in ACC Admin > Account Settings, or via the getProjects MCP tool.");
    process.exit(1);
}

export {
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    SSA_ID,
    SSA_KEY_ID,
    SSA_KEY_PATH,
    ACC_ACCOUNT_ID,
    ACC_REGION,
    ACC_ADS_REGION,
    ACC_COST_CONTAINER_ID
}
