import { AuthenticationClient } from "@aps_sdk/authentication";
import { DataManagementClient } from "@aps_sdk/data-management";
import { ModelDerivativeClient } from "@aps_sdk/model-derivative";
import { APS_CLIENT_ID, APS_CLIENT_SECRET } from "./config.js";

class AuthenticationProvider {
    constructor(scopes) {
        this._accessToken = null;
        this._expiresAt = 0;
        this._scopes = scopes;
    }

    async getAccessToken() {
        if (!this._accessToken || this._expiresAt < Date.now()) {
            const authenticationClient = new AuthenticationClient();
            const credentials = await authenticationClient.getTwoLeggedToken(APS_CLIENT_ID, APS_CLIENT_SECRET, this._scopes);
            this._accessToken = credentials.access_token;
            this._expiresAt = credentials.expires_at;
        }
        return this._accessToken;
    }
}

const authenticationProvider = new AuthenticationProvider(["data:read"]);
export const dataManagementClient = new DataManagementClient({ authenticationProvider });
export const modelDerivativeClient = new ModelDerivativeClient({ authenticationProvider });
