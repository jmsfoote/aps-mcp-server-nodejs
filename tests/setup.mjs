// Shared test setup. Sets dummy env vars BEFORE any tool / utils import so
// config.js doesn't process.exit on missing credentials, and so getAccessToken
// returns a fixed dummy token via the APS_TOKEN_OVERRIDE escape (see utils.js).
//
// Each test file should `import "./setup.mjs";` (or a relative equivalent) as
// its FIRST import — ESM evaluates imports in order, so this guarantees the
// env is populated before the modules under test resolve.

process.env.APS_CLIENT_ID ??= "test-client-id";
process.env.APS_CLIENT_SECRET ??= "test-client-secret";
process.env.SSA_ID ??= "test-ssa-id";
process.env.SSA_KEY_ID ??= "test-ssa-key-id";
process.env.SSA_KEY_PATH ??= "/dev/null";
process.env.ACC_ACCOUNT_ID ??= "00000000-0000-0000-0000-000000000000";
process.env.ACC_REGION ??= "AUS";
process.env.ACC_ADS_REGION ??= "AUS";
process.env.APS_TOKEN_OVERRIDE ??= "test-bearer-token";

/**
 * Replace global fetch with a stub that returns the given Response.
 * Returns a `restore()` that puts the original back — call in t.after().
 * @param {(url: string, init: object) => { status: number, body: any } | Promise<{ status: number, body: any }>} handler
 * @returns {{ restore: () => void, calls: Array<{ url: string, method: string, headers: object, body: any }> }}
 */
export function stubFetch(handler) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const body = init.body !== undefined ? JSON.parse(init.body) : undefined;
        calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body });
        const { status, body: respBody } = await handler(String(url), init);
        const text = typeof respBody === "string" ? respBody : JSON.stringify(respBody);
        return new Response(text, {
            status,
            headers: { "content-type": "application/json" },
        });
    };
    return {
        calls,
        restore() { globalThis.fetch = original; },
    };
}
