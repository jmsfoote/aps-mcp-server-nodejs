// Fixture-replay test. Reads the Phase 0 capture artefacts under
// tests/cost/fixtures/phase0/ and asserts the tools' error parsers cope with
// the exact envelopes the live API returned during verification.
//
// This is the audit gate: if Autodesk ever changes the error envelope shape
// upstream, a future verify-run can re-capture and this test will fail until
// the parser is updated. Until then, these are the contracts we built against.

import "../setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { formatCostApiError } from "../../tools/cost/cost-helpers.js";

const FIXTURES = path.join(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "fixtures",
    "phase0"
);

async function loadFixture(name) {
    return JSON.parse(await readFile(path.join(FIXTURES, name), "utf-8"));
}

test("formatCostApiError handles the Phase 0 'Contract locked' envelope (import :3.1 lock)", async () => {
    const fx = await loadFixture("import-budgets-locked.response.json");
    const out = formatCostApiError({ status: 400, message: JSON.stringify(fx) });
    assert.match(out, /status 400/);
    assert.match(out, /450046/);
    assert.match(out, /Contract locked/);
});

test("formatCostApiError handles the Phase 0 'Code length not matched' envelope (create 409)", async () => {
    const fx = await loadFixture("create-budget-code-length.response.json");
    const out = formatCostApiError({ status: 409, message: JSON.stringify(fx) });
    assert.match(out, /status 409/);
    assert.match(out, /450407/);
    assert.match(out, /length not matched/);
});

test("formatCostApiError handles the Phase 0 flat 'Missing required property' envelope (create 400)", async () => {
    const fx = await loadFixture("create-budget-no-code.response.json");
    const out = formatCostApiError({ status: 400, message: JSON.stringify(fx) });
    assert.match(out, /status 400/);
    assert.match(out, /45007/);
    assert.match(out, /Missing required property: code/);
});

test("formatCostApiError handles the Phase 0 INVALID_TYPE envelope (import bare-array reject)", async () => {
    const fx = await loadFixture("import-bare-array.response.json");
    const out = formatCostApiError({ status: 400, message: JSON.stringify(fx) });
    assert.match(out, /status 400/);
    assert.match(out, /45007/);
    assert.match(out, /INVALID_TYPE/);
    assert.match(out, /Expected type object but found type array/);
});
