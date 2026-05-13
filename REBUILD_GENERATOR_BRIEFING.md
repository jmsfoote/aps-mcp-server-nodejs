# Briefing — Rebuild `create-client-template.js` to match the canonical XLSX

> **⚠️ Historical document — superseded by PR A (2026-05-13).**
>
> This briefing captures the schema state at **2026-04-30**. It pre-dates
> the M2a header-driven parser overhaul ([mortgage-study-rag#93](https://github.com/jmsfoote/mortgage-study-rag/pull/93),
> merged 2026-05-11) and the PR A template alignment ([jmsfoote/aps-mcp-server-nodejs#2](https://github.com/jmsfoote/aps-mcp-server-nodejs/pull/2)).
>
> **Where this doc and the current generator disagree, the generator wins.**
> The live schema contract is `mortgage_rag.acc_push._require_headers`
> calls in `mortgage-study-rag/mortgage_rag/acc_push.py` — not this file.
>
> Specifically: Issues is now a **13-column M2a schema** at header row 5
> (this doc says 7 cols at row 8). Companies is now **9 TitleCase columns**
> with a consolidated `Address` field at header row 6 (this doc says 13
> snake_case columns at row 7 matching `tools/companies/schema.js`).
> Folders header is now at row 8 (this doc says row 9). Roles header is
> now at row 6 (this doc says row 7). Permissions and Reviews unchanged.
>
> Kept for historical context — what was true on 2026-04-30 when the
> rebuild was kicked off. **Do not use as a spec for future rebuilds.**

---

**Type:** Code session (technical, hands-on Node/ExcelJS work).
**Estimated effort:** ~3–5 hours including verification.
**Origin:** Wave 2 of the JDH/ADG ACC delivery (2026-04-30) ended with the canonical XLSX template having drifted significantly from the generator that's supposed to produce it. This briefing is the kickoff for the rebuild work.

---

## 1. What you're building

A rewritten `/Users/jamesfoote/Documents/PTP/Construction/ptp-acc-mcp/create-client-template.js` that, when run, produces the exact same workbook structure as the current canonical file:

- **Canonical (target output):** `/Users/jamesfoote/Documents/PTP/Construction/ptp-acc-mcp/PTP-Project-Setup-Template.xlsx`

The current generator is **stale** (last modified 2026-03-10) — it still produces a workbook with a `Users` sheet and is missing `Companies`, `Roles`, `Reviews`, and `0. Setup Checklist` sheets entirely. Running it as-is would overwrite the canonical template and undo a day's worth of structural improvements.

**Your deliverable:** a single rewritten `create-client-template.js` file that, when run with `PATH="/opt/homebrew/opt/node@22/bin:$PATH" node create-client-template.js <out-path>`, produces a workbook structurally indistinguishable from the canonical (sheet names + order, headers, dropdowns, styling, frozen panes, instructions text).

---

## 2. The current canonical state — verify this before you write code

Run this from `/Users/jamesfoote/Documents/PTP/Construction/ptp-acc-mcp/`:

```bash
/Users/jamesfoote/Documents/PTP/Construction/mortgage-study-rag/.venv/bin/python -c "
import openpyxl
wb = openpyxl.load_workbook('PTP-Project-Setup-Template.xlsx')
for i, name in enumerate(wb.sheetnames):
    ws = wb[name]
    print(f'{i}. {name!r}  (rows={ws.max_row}, cols={ws.max_column})')
"
```

Expected output (this is the contract you're matching):

```
0. '0. Setup Checklist'  (rows=25, cols=2)
1. 'Instructions'        (rows=37, cols=1)
2. 'Folders'             (rows=68, cols=2)
3. 'Permissions'         (rows=73, cols=3)
4. 'Issues'              (rows=41, cols=7)
5. 'Reviews'             (rows=14, cols=8)
6. 'Reference'           (rows=40, cols=8)
7. 'Roles'               (rows=40, cols=3)
8. 'Companies'           (rows=68, cols=13)
```

If the actual output differs from this, **stop and report** — the canonical may have moved since this briefing was written. Do not proceed against a different baseline.

---

## 3. Source files you must read (in order)

Read all four before writing a single line of new code. Each one gives you a different piece of the picture.

| File | Purpose |
|---|---|
| `PTP-Project-Setup-Template.xlsx` | The canonical output. Inspect every sheet's structure, headers, instruction rows, formulas, dropdowns, and styling. Use openpyxl or ExcelJS to introspect. |
| `create-client-template.js` (current, stale) | The styling baseline. The PTP brand colours, font definitions, helper functions (`addTitleRow`, `addSectionRow`, `addInstructionRow`, `styleHeaderRow`, `styleExampleRow`, `styleDataRow`), border definitions, and the `Folders` + `Permissions` + `Issues` + `Reviews` + `Reference` sheet generators are mostly correct. Do not throw this file away — refactor it. |
| `apply-5-changes.js` | The patch script that took the old XLSX and produced the current canonical. Read it for the **5 structural changes** that need to be folded into the rebuilt generator: `0. Setup Checklist` sheet, restructured `Roles` sheet, Folders canonical-structure warning, restructured `Companies` columns, Issues `General/General` default. |
| `tools/companies/schema.js` | The source of truth for the Companies sheet column names. The headers in the `Companies` sheet must be the snake_case field names that match this Zod schema exactly: `name, trade, address_line_1, address_line_2, city, state_or_province, postal_code, country, phone, website_url, erp_id, tax_id, description`. |

**Verify-against-canonical rule (per `/Construction/BRIEFING_AUTHORING.md`):** if at any point this briefing tells you something that the actual files contradict, **the files win**. Stop and report the discrepancy. Do not invent or assume.

---

## 4. Per-sheet specification

### Sheet 0: `0. Setup Checklist` (NEW — must be the first tab)

Pre-flight checklist owned by the client's ACC account admin. Five items, each with a `[ ]` checkbox cell + a bold title row + a body row of supporting detail. Read `apply-5-changes.js` for the exact wording — it's right there in a `checklist` array.

The five item titles are:
1. Approve the APS Custom Integration on this hub
2. Create the custom roles listed in the Roles sheet
3. Decide on issue type/subtype configuration
4. Enable the Reviews module (only if using review workflows)
5. Send the populated workbook back with confirmation

End with a "Why this checklist exists" section explaining the discovery-loop problem the checklist solves.

**Layout:** 2 columns (6-wide for the `[ ]`, 90-wide for the text). Tab colour `ptpBlue` (`004AAD`).

### Sheet 1: `Instructions`

The existing Instructions sheet content is **stale** — references the now-removed Users sheet. Rewrite the body to match today's tab inventory: Companies, Roles, Folders, Permissions, Issues, Reviews. Keep the existing styling (blue title bar, light-blue instruction rows, frozen first row). Cross-reference the current XLSX for tone.

### Sheet 2: `Folders`

Mostly preserved from the existing generator. **One critical addition** at row 7: a strongly-worded canonical-structure warning. Read `apply-5-changes.js` for the exact text — it's the row inserted by Change #3. Style: light red tint background (`FFEEEE`), bold red text, merged across both columns. Keep the existing folder list pre-populated in light blue example rows.

### Sheet 3: `Permissions`

Existing structure is mostly fine. Headers: `Role Name | Folder Path | Permission Level`. Note: the existing generator has a `Permission Level Summary` section in the instruction rows — keep that. The dropdowns must reference the named range `PermissionLevels` on the Reference tab (existing pattern).

### Sheet 4: `Issues`

Existing structure preserved. **Two changes** from the patch script:
- Insert a yellow note row above the header (row 7 in the canonical) explaining the `General/General` default. Read `apply-5-changes.js` for exact wording. Style: light yellow tint (`FFF8E1`), 60px tall, merged across all 7 columns.
- The first example row's `Issue Type` and `Issue Subtype` cells must be `General` and `General` respectively. The other example rows can keep their `Coordination/Clash` and `Coordination/Coordination` examples — variety is good documentation.

### Sheet 5: `Reviews`

Preserved from existing generator. No changes from the patch script. Verify it still looks identical to canonical.

### Sheet 6: `Reference`

Preserved from existing generator. Holds the named ranges (`PermissionLevels`, `IssueStatuses`, `IssueTypes`, `IssueSubtypes`) that drive dropdowns elsewhere. Note: the named range previously called `Roles` (driving the Users-sheet role dropdown) is no longer needed since the Users sheet was removed; do not recreate it.

### Sheet 7: `Roles` (RESTRUCTURED)

3 columns now (was 1): `Role Name | ACC Catalog Status | Active for this project? (TRUE/FALSE)`.

Pre-populate with **23 rows** of role data. Read `apply-5-changes.js` `roles` array for the exact contents — every row's role name, catalog status string, and (empty) active cell must be reproduced exactly.

Critical naming notes (these MUST be in the catalog status column):
- Row for `Legal`: status text is `Standard ACC role — use "Legal", NOT "Lawyer"`
- Row for `Quantity Surveyor`: status text is `Standard ACC role — use "Quantity Surveyor", NOT "QS"`

Active column (C) needs a TRUE/FALSE dropdown via `dataValidation`. Frozen panes at row 7. Tab colour `ptpTeal`.

### Sheet 8: `Companies` (RESTRUCTURED)

13 columns now (was 9): exactly these snake_case names in this order:

```
name | trade | address_line_1 | address_line_2 | city |
state_or_province | postal_code | country | phone |
website_url | erp_id | tax_id | description
```

These names must match `tools/companies/schema.js` exactly — verify after writing.

One example row showing typical AU developer data (read `apply-5-changes.js` for the exact values). 60 blank data rows beneath. Frozen panes at row 7. Tab colour `ptpTeal`.

---

## 5. Verification protocol — RUN ALL OF THESE BEFORE CLAIMING DONE

Add a `npm run verify` style script (or a one-line bash in your final commit message) that runs ALL of the following against the rebuilt generator's output. **All must pass.**

```bash
cd /Users/jamesfoote/Documents/PTP/Construction/ptp-acc-mcp

# 1. Generate to a temp path
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node create-client-template.js /tmp/rebuilt-template.xlsx

# 2. Sheet inventory matches canonical exactly
/Users/jamesfoote/Documents/PTP/Construction/mortgage-study-rag/.venv/bin/python << 'PY'
import openpyxl
canonical = openpyxl.load_workbook('PTP-Project-Setup-Template.xlsx')
rebuilt = openpyxl.load_workbook('/tmp/rebuilt-template.xlsx')
assert canonical.sheetnames == rebuilt.sheetnames, \
    f"Sheet order mismatch:\n  canonical: {canonical.sheetnames}\n  rebuilt:  {rebuilt.sheetnames}"
for name in canonical.sheetnames:
    cw = canonical[name]
    rw = rebuilt[name]
    print(f'{name}: canonical={cw.max_row}x{cw.max_col}, rebuilt={rw.max_row}x{rw.max_col}')
print('Sheet inventory matches.')
PY

# 3. Companies headers match the MCP schema
/Users/jamesfoote/Documents/PTP/Construction/mortgage-study-rag/.venv/bin/python << 'PY'
import openpyxl
EXPECTED = ['name','trade','address_line_1','address_line_2','city','state_or_province',
            'postal_code','country','phone','website_url','erp_id','tax_id','description']
wb = openpyxl.load_workbook('/tmp/rebuilt-template.xlsx')
ws = wb['Companies']
# Find header row by scanning for 'name' in column A
for r in range(1, 12):
    if ws.cell(r, 1).value == 'name':
        actual = [ws.cell(r, c).value for c in range(1, len(EXPECTED) + 1)]
        assert actual == EXPECTED, f'Companies headers wrong:\n  expected {EXPECTED}\n  got      {actual}'
        print(f'Companies headers correct ({len(EXPECTED)} columns)')
        break
else:
    raise SystemExit('Companies header row not found')
PY

# 4. Roles sheet has 23 pre-populated rows + correct catalog-status text for Legal and Quantity Surveyor
/Users/jamesfoote/Documents/PTP/Construction/mortgage-study-rag/.venv/bin/python << 'PY'
import openpyxl
wb = openpyxl.load_workbook('/tmp/rebuilt-template.xlsx')
ws = wb['Roles']
roles = []
for r in range(8, ws.max_row + 1):  # data starts row 8 in canonical
    name = ws.cell(r, 1).value
    if not name: break
    roles.append((name, ws.cell(r, 2).value))
assert len(roles) == 23, f'Expected 23 roles, got {len(roles)}'
legal = next((s for n,s in roles if n == 'Legal'), None)
qs = next((s for n,s in roles if n == 'Quantity Surveyor'), None)
assert legal and 'Legal' in legal and 'Lawyer' in legal, f'Legal row missing the catalog-rename note: {legal!r}'
assert qs and 'Quantity Surveyor' in qs and 'QS' in qs, f'Quantity Surveyor row missing the catalog-rename note: {qs!r}'
print('Roles sheet: 23 rows present, Legal and Quantity Surveyor catalog notes correct.')
PY

# 5. Setup Checklist is the first tab
/Users/jamesfoote/Documents/PTP/Construction/mortgage-study-rag/.venv/bin/python -c "
import openpyxl
wb = openpyxl.load_workbook('/tmp/rebuilt-template.xlsx')
assert wb.sheetnames[0] == '0. Setup Checklist', f'First tab is {wb.sheetnames[0]!r}, expected \"0. Setup Checklist\"'
print('Setup Checklist is first tab.')
"

# 6. Open the rebuilt file in Excel (or Numbers, or LibreOffice) and visually compare to canonical
#    — colour scheme matches, frozen panes work, dropdowns work in TRUE/FALSE column on Roles sheet,
#    instruction text reads cleanly. This is the only manual step but it catches styling regressions
#    that automated checks miss.
```

---

## 6. Anti-patterns to avoid

- **Don't write a fresh-from-scratch generator.** The existing one's styling helpers (`addTitleRow`, `addSectionRow`, `styleHeaderRow`, the COLOURS palette, the FONT_* constants, the BORDER_THIN definition) are already correct and brand-consistent. Refactor, don't replace.
- **Don't run the new generator against the canonical path on success.** Test against `/tmp/rebuilt-template.xlsx` until verification passes. Only after a green run + visual check should the canonical path be overwritten — and even then, only after backing it up.
- **Don't drop the Users sheet generator code without replacing the role-validation references.** The current generator wires a named range called `Roles` driving the Users-sheet dropdown. With Users gone, the named range is no longer needed; remove the named-range definition AND any `formulae: ['Roles']` references on other sheets that would otherwise dangle.
- **Don't reorder sheets via `wb._worksheets.sort()`.** ExcelJS does not expose a public reorder API. The naive sort silently drops sheets (this is how `apply-5-changes.js` failed on its first run). Either build the workbook in the right order from the start, or use a post-step with openpyxl's `move_sheet` to reorder.
- **Don't omit a top-of-file header comment** stating: file purpose, what it produces, when to regenerate, and the verification commands. The previous generator was missing this and that's part of why it went stale unnoticed.

---

## 7. Definition of done

- `create-client-template.js` is rewritten and committed (git commit on the appropriate branch — confirm branch with James first if unclear).
- All 6 verification checks in §5 pass cleanly.
- Visual compare against canonical (open both in Excel side-by-side, walk every tab) shows no regressions.
- The top of the new file has a header comment explaining what's been changed and pointing at this briefing for context.
- A note in `Clients/JDH Developments/ACC/JDH_DELIVERY_LOG.md` updating the "Stale generator follow-up" section to closed: replace the "Action item: rebuild..." paragraph with a "Closed 2026-XX-XX — generator rebuilt by Code session, see commit <hash>".

---

## 8. Out of scope

- **Don't** touch the canonical XLSX itself during this work — it should still pass the existing JDH/ADG delivery scripts (`push-folders.js`, `push-permissions.js`) untouched. The work is all in the generator.
- **Don't** add new structural changes beyond the 5 from `apply-5-changes.js`. If you spot something else that should change (e.g. typos in instruction rows, missing dropdowns), surface as a follow-up — don't roll it into this work.
- **Don't** rebuild the MCP toolset, the push scripts, or the JDH delivery scripts. They're stable.

---

## 9. Context links

- `Clients/JDH Developments/ACC/JDH_DELIVERY_LOG.md` — full narrative of how we got here, including 10 empirical learnings from waves 1 and 2 and the structural-changes rationale.
- `governance/PTP_AGENT_BLUEPRINT.md` Section 3.8 Wave 1 operational artifacts pointer — explains how the template fits into the broader Phase 3+ delivery-agent vision.
- `ACC_BOT_NEW_CLIENT_SETUP.md` (root, mirrored at `ptp-acc-mcp/`) — the procedural walkthrough the Setup Checklist sheet supplements.
