# Phase 0 — live-API capture artefacts

These JSON files preserve the exact request/response shapes observed when the
three budget write tools were verified against a real Autodesk Cost Management
endpoint, prior to writing the tools.

## Provenance

- **Date:** 2026-05-21
- **Project:** Parkside Residences — PTP Development (PTP sandbox)
- **Container:** Cost container UUID redacted in fixtures as `<CONTAINER_ID>`
- **Auth:** PTP SSA token via `getAccessToken()` (utils.js)
- **Headers:** `x-ads-region: APAC` (legacy alias; AUS also works empirically)
- **Verification script:** `phase0-verify.mjs` — not committed (one-shot,
  generates real writes against a sandbox)

## Files

| File | Verified contract |
|---|---|
| `create-budget.request.json` | `POST /cost/v1/containers/<id>/budgets` — request body |
| `create-budget.response.json` | 201 response (full budget object, abbreviated) |
| `patch-budget.request.json` | `PATCH /cost/v1/containers/<id>/budgets/<budgetId>` — request body |
| `patch-budget.response.json` | 200 response (full budget object, abbreviated) |
| `import-budgets.request.json` | `POST /cost/v1/containers/<id>/budgets:import` — request body |
| `import-budgets-locked.response.json` | 400 response (template-lock error, §3.1 behavior) |
| `import-bare-array.response.json` | 400 — wrong envelope (bare array rejected) |
| `import-items-envelope.response.json` | 400 — wrong envelope (`{items: [...]}` rejected) |
| `create-budget-no-code.response.json` | 400 — missing required field `code` |
| `create-budget-code-length.response.json` | 409 — code length not matching segment template |

## Why these are committed

1. **Audit trail.** The PR claims live-API verification; these are the
   evidence. If the API contract changes upstream, drift can be detected by
   comparing future captures to these.
2. **Documentation of negative cases.** The "wrong envelope" 400s and the
   "Contract locked" 400 are the failure modes the tools explicitly handle;
   keeping the exact API response text here pins the parser behavior.
3. **Future test seed.** A future contract-replay test can read these and
   assert tool behavior against captured response bodies (currently the live
   write paths are exercised by unit tests with synthetic responses; these
   fixtures let us escalate to fixture-driven tests without re-hitting the
   live API).

## Not committed

- The exact container UUID (sandbox-specific, may identify the PTP tenant)
- The full nested `budgetCode.budgetCodeSegments[]` payload (truncated for
  readability — the shape is documented, not all UUIDs preserved)
- The `phase0-verify.mjs` driver script (one-shot, writes real data)
