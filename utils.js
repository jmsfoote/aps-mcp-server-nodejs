import fs from "node:fs/promises";
import jwt from "jsonwebtoken";
import { DataManagementClient } from "@aps_sdk/data-management";
import { IssuesClient } from "@aps_sdk/construction-issues";
import { AdminClient } from "@aps_sdk/construction-account-admin";
import { APS_CLIENT_ID, APS_CLIENT_SECRET, SSA_ID, SSA_KEY_ID, SSA_KEY_PATH } from "./config.js";

const TOKEN_ENDPOINT = "https://developer.api.autodesk.com/authentication/v2/token";

class ServiceAccountAuthenticationProvider {
    constructor(scopes) {
        this._accessToken = null;
        this._expiresAt = 0;
        this._scopes = scopes;
    }

    async getAccessToken() {
        if (!this._accessToken || this._expiresAt < Date.now()) {
            const assertion = await this._createAssertion(this._scopes);
            const { access_token, expires_in } = await this._exchangeAccessToken(assertion);
            this._accessToken = access_token;
            this._expiresAt = Date.now() + expires_in * 1000;
        }
        return this._accessToken;
    }

    async _createAssertion(scopes) {
        const expiresAt = Math.floor(Date.now() / 1000) + 300;
        const payload = { iss: APS_CLIENT_ID, sub: SSA_ID, aud: TOKEN_ENDPOINT, exp: expiresAt, scope: scopes };
        const privateKey = await fs.readFile(SSA_KEY_PATH, "utf-8");
        const options = {
            algorithm: "RS256",
            header: { alg: "RS256", kid: SSA_KEY_ID },
            noTimestamp: true
        };
        return jwt.sign(payload, privateKey, options);
    }

    async _exchangeAccessToken(assertion) {
        const headers = {
            "Accept": "application/json",
            "Authorization": `Basic ${Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded"
        };
        const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
        const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers, body });
        if (!response.ok) {
            throw new Error(`Could not generate access token: ${await response.text()}`);
        }
        return response.json();
    }
}

const serviceAccountAuthenticationProvider = new ServiceAccountAuthenticationProvider(["data:read", "data:write", "account:read", "account:write"]);
export const dataManagementClient = new DataManagementClient({ authenticationProvider: serviceAccountAuthenticationProvider });
export const issuesClient = new IssuesClient({ authenticationProvider: serviceAccountAuthenticationProvider });
export const adminClient = new AdminClient({ authenticationProvider: serviceAccountAuthenticationProvider });

// Export a function to get a raw access token for direct REST API calls (e.g., folder permissions)
// APS_TOKEN_OVERRIDE: test-only escape hatch — when BOTH it and NODE_ENV=test are
// set, skip JWT/SSA exchange and return the override verbatim. Requires NODE_ENV=test
// so a stray APS_TOKEN_OVERRIDE in a non-test environment cannot silently bypass auth.
export async function getAccessToken() {
    if (process.env.APS_TOKEN_OVERRIDE && process.env.NODE_ENV === "test") {
        return process.env.APS_TOKEN_OVERRIDE;
    }
    return serviceAccountAuthenticationProvider.getAccessToken();
}

// ---------------------------------------------------------------------------
// 2-legged (client_credentials) token getter — for endpoints that explicitly
// reject SSA/JWT-bearer tokens.
//
// Empirical finding 2026-04-30: the HQ v1 Companies endpoints
// (`/hq/v1/accounts/{id}/companies`) return `1003 — Only support 2 legged
// access token` when called with our SSA-flow token (utils.js getAccessToken).
// They require a pure client_credentials 2LO token. This is a per-endpoint
// quirk — folder, cost, and most other endpoints accept the SSA token fine.
// ---------------------------------------------------------------------------

let _twoLegToken = null;
let _twoLegExpiresAt = 0;

export async function getTwoLeggedToken(scopes = ["account:read", "account:write"]) {
    if (_twoLegToken && _twoLegExpiresAt > Date.now() + 30_000) return _twoLegToken;

    const headers = {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
    };
    const body = new URLSearchParams({ grant_type: "client_credentials", scope: scopes.join(" ") });
    const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers, body });
    if (!response.ok) {
        throw new Error(`2-legged token exchange failed: ${response.status} ${await response.text()}`);
    }
    const { access_token, expires_in } = await response.json();
    _twoLegToken = access_token;
    _twoLegExpiresAt = Date.now() + expires_in * 1000;
    return access_token;
}
