# Phase 0 — live-API capture artefacts

These JSON files preserve the exact request/response shapes observed against
a real Autodesk Cost Management endpoint, prior to writing the corresponding
tools.

## Provenance

- **Original capture (budget tools — M7a-light PR-A):** 2026-05-21
- **D2 contract write tools (M7a-full PR — this slice):** 2026-05-22
- **Project:** Parkside Residences — PTP Development (PTP sandbox)
- **Container:** Cost container UUID redacted in fixtures as `<CONTAINER_ID>`
- **Auth:** PTP SSA token via `getAccessToken()` (utils.js)
- **Headers:** `x-ads-region: AUS` (APAC is the legacy alias and also works)
- **Verification scripts:** `phase0-verify.mjs` (budgets) and
  `phase0-verify-d2.mjs` (contracts) — neither is committed (one-shot,
  writes real data against a sandbox)

## Files

### Budgets (M7a-light PR-A)

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

### Contracts + budget↔contract links (M7a-full PR — D2)

| File | Verified contract |
|---|---|
| `create-contract-min.request.json` | `POST /cost/v1/containers/<id>/contracts` — minimal body (code + name only) |
| `create-contract-min.response.json` | 201 — minimal viable body succeeds; all other fields default (status:draft, currency:AUD, budgetIds:[], lifecycle dates null except server-set statusChangedAt) |
| `create-contract-rich.request.json` | Rich body including awardedAt/executedAt/statusChangedAt + number + description |
| `create-contract-rich.response.json` | 201 — lifecycle dates `awardedAt`/`executedAt` accepted on create; `statusChangedAt` is server-controlled and overwrites the supplied value |
| `create-contract-missing-code.response.json` | 400 (code 451111) — body without `code` field; confirms `code` is required |
| `create-contract-missing-name.response.json` | 400 (code 45007 OBJECT_MISSING_REQUIRED_PROPERTY) — body without `name` field; confirms `name` is required |
| `patch-contract.request.json` | `PATCH /cost/v1/containers/<id>/contracts/<contractId>` — partial body |
| `patch-contract.response.json` | 200 — full contract object returned, only patched fields changed |
| `link-budgets-contracts-create.request.json` | `POST /cost/v1/containers/<id>/budgets-contracts:link` — single create pair |
| `link-budgets-contracts-create.response.json` | 200 — **empty body**. The API echoes nothing on success; the tool must not rely on a returned link ID or echoed pair list |
| `link-budgets-contracts-dup-budgetid.request.json` | Two `create` entries sharing one `budgetId` |
| `link-budgets-contracts-dup-budgetid.response.json` | 400 (code 450031) — "The same budget is not yet supported to be linked to more than one contract in one API call." **Confirms spec §3.2's stated limit — auto-split design is required in the link tool.** |
| `link-budgets-contracts-already-linked.response.json` | 400 (code 450030) — attempt to link a budget already linked to another contract. **Spec §8 `contract_link_already_exists` is surfaced as a 400, not a no-op AMBER.** The wave handler should map 450030 → AMBER flag rather than expecting a 200 no-op |
| `link-budgets-contracts-empty.response.json` | 200 (empty body) — endpoint accepts an empty request body permissively; the tool enforces "at least one of create/remove" client-side |
| `link-budgets-contracts-garbage.response.json` | 404 (code 450023) — per-entry shape with missing `contractId` returns "Contract not found" |
| `link-budgets-contracts-remove.request.json` | `remove` array uses pair objects (`{ contractId, budgetId }`), not link IDs |
| `link-budgets-contracts-remove.response.json` | 200 (empty body) — same shape as create-side |

## Spec divergence (F0.4 — for follow-up spec-correction PR)

Live API findings that diverge from `PHASE_4_COST_MANAGEMENT_SPEC.md` §3.2 /
§8 as drafted:

- **Required fields not listed in spec §3.2.** `POST /contracts` requires
  both `code` (code 451111) and `name` (code 45007). `number` is optional.
- **Link success returns empty 200.** Spec §3.2 didn't specify; tool must
  not rely on echoed link IDs or pair lists.
- **"Already linked" is a 400, not a no-op.** Spec §8 implies
  `contract_link_already_exists` is a no-op AMBER flag; the live API
  surfaces error code 450030 with `detail.alreadyLinkedBudgets`. Wave
  handler should map 450030 → AMBER, not expect a 200 no-op.
- **Contract response field naming.** The response uses `code` (not
  `number`) and `companyName` (not `vendor`/`vendorName`). No `amount`/
  `contractAmount` field appears on the create response — it is populated
  later via cost items / payment applications. `getFirst()` fallbacks in
  the response summary cover both naming conventions.
- **`statusChangedAt` is server-controlled on create.** Supplying a value
  is silently overwritten with the server timestamp at creation. Other
  Dec-2025 lifecycle date fields (`awardedAt`, `executedAt`) are settable.

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
