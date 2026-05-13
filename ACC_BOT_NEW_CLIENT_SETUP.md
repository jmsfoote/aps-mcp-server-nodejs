# ACC Bot — New Client Setup

How to invite the existing PTP ACC bot (Service Account) into a new
client's ACC environment, so you can run the `deal acc-push` workflow
against their projects. Use this when onboarding JDH, Frank, or any
future client.

The bot itself is already built, authenticated, and running from
`~/Documents/PTP/Construction/ptp-acc-mcp/`. **You are not creating a
new bot.** You are inviting the existing one into a new ACC account
and project.

---

## Before you start

**You'll need:**

- The bot's service account email. Find it at
  [SSA Manager](https://ssa-manager.autodesk.io) — log in with PTP's
  APS Client ID and Secret (the values in `ptp-acc-mcp/.env` as
  `APS_CLIENT_ID` and `APS_CLIENT_SECRET`), select the existing
  service account, and copy the `email` field from Account Details.
  It looks like `<uuid>@<ssa-domain>`.
- An admin contact at JDH who can add members and modify permissions
  in their ACC account. If your own admin access on JDH's hub
  includes **Account Admin**, you can do all of this yourself.
- The push XLSX for JDH, validated and approved per the existing
  push workflow.

**You don't need:**

- A new SSA, new keys, or a new APS app — the same credentials work
  everywhere.
- To touch the bot's `.env` file. The bot discovers JDH's account and
  projects automatically via `getProjectsTool` once the invite goes
  through.

---

## Step 1 — Approve the APS Custom Integration on the new hub

This step is the prerequisite that makes the bot visible to JDH's hub
at all. Without it, no amount of Members-tab invitations will get
`getProjectsTool` to return JDH's projects. Confirmed empirically
during ADG hub bring-up on 2026-04-30 — adding the bot user via
Members alone left `getProjectsTool` blind to the new hub; approving
the Custom Integration was the step that flipped it on.

In JDH's ACC, go to **Hub Admin → Custom Integrations →
Add custom integration**. Paste PTP's APS **Client ID** (the
`APS_CLIENT_ID` value in `ptp-acc-mcp/.env`). Approve.

ACC will respond with **"Service Account Detected — A single service
account is linked to this integration… By default, it has no access."**
That's expected. The Custom Integration approval registers the APS app
as a recognised principal on JDH's hub; Steps 2–4 below give that
principal the actual permissions it needs.

**Important distinction for the agent's notes:** the "bot user" that
shows up in **Account Admin → Members** (e.g. `PTP MCP-Bot`) and the
**service account** auto-created by the Custom Integration are
*separate* concepts. The MCP authenticates as the service account,
not the human-shaped bot user. Adding the bot user via Members without
also approving the Custom Integration does nothing for the MCP.

**Steps 2–4 may be redundant when Step 1 is done at hub level
(empirical correction, 2026-04-30):** when the Custom Integration was
approved on the ADG hub, `getProjectUsersTool` against ADG Project
Template returned the SSA already present with `accountAdmin: true`
and `projectAdmin: true` on every project — no separate Members invite,
no project-add, no folder-permission grant needed. The folder-create
calls in the JDH/ADG push worked immediately. This suggests Steps 2–4
below are needed only if (a) ACC's behaviour differs by tier or region,
(b) the integration was approved at a narrower scope than the full hub,
or (c) folder-level permissions need tightening beyond the
admin-default. Until that's understood, treat Steps 2–4 as defensive —
verify against `getProjectUsersTool` after Step 1 before doing them.
If the SSA is already returned with admin access, skip Steps 2–4 and
go straight to Step 5.

---

## Step 2 — Invite the service account into JDH's ACC account

In JDH's ACC, go to **Account Admin → Members → Invite Members**.
This requires Account Admin on JDH's hub. If you only have Project
Admin, this step needs to be done by whoever has Account Admin at JDH.

Enter the SSA email from above. Set the role to **Account Admin**.

**Why Account Admin matters:** Step 3 of the push
(`addAccountUserTool`) adds users to JDH's hub. The bot needs Account
Admin on the hub to do that. If the bot has only Project Admin, Step 3
will fail for any users not already in JDH's hub, and you'll have to
add those people manually before the push.

Click **Send Invitations**. Service accounts skip the email-confirmation
step — the SSA has access immediately.

---

## Step 3 — Add the service account to the project

Still in JDH's ACC, open the specific project where the work will
land. Go to **Project Members → Add Members**. Enter the same SSA email.
Set the project role to **Project Admin**.

You add the SSA twice — once at account level, once at project level.
ACC scopes the two memberships separately.

---

## Step 4 — Grant folder permissions on Project Files

This is the step that's easiest to forget. Project Admin doesn't
automatically translate to write rights on the Files area in ACC Docs.

In the project, go to **Files → Project Files** (the root folder).
Click the three-dot menu next to it → **Permission settings** → **+ Add**.
Select the SSA from the user picker. Grant the action set the push
uses by default: `Publish, View, Download, Collaborate`.

If JDH already has top-level folders inside Project Files that the
push will write into, repeat this on each of those too. Sub-folders
the bot creates from scratch inherit permissions from their parent,
so handling the root + any pre-existing top-level folders is usually
enough.

---

## Step 5 — Enable the Reviews module (only if using review workflows)

If JDH's push XLSX has anything in the Reviews sheet, Step 6.5 of the
push needs the Reviews module enabled on the project. Without it the
API returns a 404 and the push silently skips review workflows.

In the JDH project, go to **Project Admin → Modules → Reviews** and
toggle it on. If you don't see Reviews in the list, JDH's account tier
may not include it — confirm before committing to deliver review
workflows.

Skip this step if the Reviews sheet in the push XLSX is empty.

---

## Step 6 — Verify the bot can see JDH's project

On your machine, with the bot running in your MCP client (Claude
Desktop, Cursor, or VS Code), ask:

> "List all ACC accounts and projects you can access."

This calls `getProjectsTool`. The output should include JDH's account
and the specific project, with their IDs. No Claude Desktop restart
is needed — the MCP re-fetches on each call.

If JDH doesn't appear, the most common cause is that **Step 1**
(Custom Integration approval) didn't land. Members-tab invitations
alone do not expose the hub to the MCP. Re-check Step 1 first, then
Step 2 if the integration is approved but the project is still
missing.

Note both IDs from the output:

- **Account ID** — used without the `b.` prefix in most tools
- **Project ID** — same; without `b.` in most tools, **with `b.`** in
  `setFolderPermissionsTool`, `getFolderPermissionsTool`, and the four
  Reviews tools (`getReviewWorkflowsTool`, `createReviewWorkflowTool`,
  `createReviewTool`, `getReviewsTool`)

---

## Step 7 — Run the push

You're ready. From the `mortgage-study-rag` repo:

```bash
cd ~/Documents/PTP/Construction/mortgage-study-rag
.venv/bin/python -m mortgage_rag.cli deal acc-validate --deal-id pd_0001-1
.venv/bin/python -m mortgage_rag.cli deal acc-review --deal-id pd_0001-1 --approve
```

Then in your MCP client, hand the bot the deal ID and confirm the
JDH account/project when it asks. The bot runs Steps 1–7 of
`ACC_PUSH_WORKFLOW.md` (and 6.5 if Reviews is enabled), then marks the
deal as pushed in the database.

---

## Common failures and what they mean

| Symptom | Most likely cause | Fix |
|---|---|---|
| `getProjectsTool` doesn't show JDH | Custom Integration not approved on JDH's hub | Re-do Step 1 |
| `getProjectsTool` shows JDH's hub but not the specific project | SSA approved at hub level but never added to the project | Re-do Step 3 |
| Step 3 of the push fails on `addAccountUserTool` | SSA has Project Admin but not Account Admin on JDH's hub | Escalate the SSA's role (Step 2), or add those users manually in ACC first |
| Folder creation 403s | Folder-level permissions missing on Project Files | Re-do Step 4 |
| Reviews step 404s | Reviews module not enabled on the project | Re-do Step 5 |
| `b.`-prefix errors from a tool call | Passed `b.{id}` to a tool that wants the raw ID, or vice versa | See Step 6 cheat sheet |

---

## After the push

Per Section 3.8 / Wave 1 of the agent blueprint, capture a
`delivery_knowledge` entry: what folder structure went up, which roles
got what, anything JDH-specific worth remembering. Roughly 15 minutes
of dictation in a Cowork session. This is the manual capture step that
builds the precedent base for Frank, Freeman, and future deliveries to
draw on.

---

## Cross-references

- `mortgage-study-rag/ACC_PUSH_WORKFLOW.md` — the 7-step push workflow
  this setup is preparation for
- `ptp-acc-mcp/docs/part1-service-account/index.md` — original SSA
  creation walkthrough (you don't need to re-do this; it's reference
  for how the SSA in `ptp-acc-mcp/.env` was created)
- `mortgage-study-rag/governance/PTP_AGENT_BLUEPRINT.md` Section 3.8
  — delivery_knowledge capture (the after-the-push step)
