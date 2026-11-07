# aps-mcp-server-nodejs

Simple [Model Context Protocol](https://modelcontextprotocol.io) server built with Node.js, providing access to [Autodesk Platform Services](https://aps.autodesk.com) API, with fine-grained access control using [Secure Service Accounts](https://aps.autodesk.com/en/docs/ssa/v1/developers_guide/overview/).

![Screenshot](screenshot.png)

[YouTube Video](https://youtu.be/6DRSR9HlIds)

## Development

### Prerequisites

- [Node.js](https://nodejs.org)
- [APS application](https://aps.autodesk.com/en/docs/oauth/v2/tutorials/create-app) (must be of type _Server-to-Server_)
- [Provisioned access to ACC](https://get-started.aps.autodesk.com/#provision-access-in-other-products)

### Setup

#### Secure Service Account

Our MCP server will need a secure service account and a private key. Instead of implementing the logic in this code sample, we will use https://ssa-manager.autodesk.io:

- Go to https://ssa-manager.autodesk.io, and log in with your APS client ID and secret
- Create a new secure service account using the _Create Account With Name:_ button; don't forget to specify the first name and last name
- Make sure the new account is selected in the _Accounts_ list
- Make note of the `serviceAccountId` and `email` values under _Account Details_
- Create a new private key using the _Create Key_ button; a _*.pem_ file will be automatically downloaded to your machine
- Make sure the new private key is selected in the _Keys_ list
- Make note of the `kid` value under _Key Details_

#### Autodesk Construction Cloud

- Make sure you've provisioned access to ACC for your APS application
- Invite the secure service account (the `email` value from earlier) as a new member to your selected ACC projects

#### Server

- Clone this repository
- Install dependencies: `yarn install`
- Create a _.env_ file in the root folder of this project, and define the following environment variables:
  - `APS_CLIENT_ID` - your APS application client ID
  - `APS_CLIENT_SECRET` - your APS application client secret
  - `SSA_ID` -  your service account ID (the `serviceAccountId` field from earlier)
  - `SSA_KEY_ID` - your private key ID (the `kid` field from earlier)
  - `SSA_KEY_PATH` - full path to your downloaded *.pem file
- The _.env_ file might look something like this:

```bash
APS_CLIENT_ID="AhH9..."
APS_CLIENT_SECRET="1FS4..."
SSA_ID="ZCU2TJH5PK8A5KQ9"
SSA_KEY_ID="8a4ee790-3378-44f3-bbab-5acb35ec35ce"
SSA_KEY_PATH="/Users/brozp/aps-mcp-server-nodejs/8a4ee790-3378-44f3-bbab-5acb35ec35ce.pem"
```

## Usage

### MCP Inspector

- Run the [Model Context Protocol Inspector](https://modelcontextprotocol.io/docs/tools/inspector): `npx @modelcontextprotocol/inspector`
- Hit `Connect` to connect to the MCP server

### Claude Desktop

- Make sure you have [Claude Desktop](https://claude.ai/download) installed
- Create a Claude Desktop config file if you don't have one yet:
  - On macOS: _~/Library/Application Support/Claude/claude\_desktop\_config.json_
  - On Windows: _%APPDATA%\Claude\claude\_desktop\_config.json_
- Add this MCP server to the config, using the absolute path of the _server.js_ file on your system, for example:

```json
{
    "mcpServers": {
        "aps-mcp-server-nodejs": {
            "command": "node",
            "args": [
                "/path/to/aps-mcp-server-nodejs/server.js"
            ]
        }
    }
}
```

- Open Claude Desktop, and try some of the following test prompt:
  - What ACC projects do I have access to?
  - Give me a visual dashboard of all issues in project XYZ

> For more details on how to add MCP servers to Claude Desktop, see the [official documentation](https://modelcontextprotocol.io/quickstart/user).

### Visual Studio Code & GitHub Copilot

- Make sure you have [enabled MCP servers in Visual Studio Code](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_enable-mcp-support-in-vs-code)
- Create _.vscode/mcp.json_ file in your workspace, and add the following JSON to it:

```json
{
    "servers": {
        "aps-mcp-server-nodejs": {
            "type": "stdio",
            "command": "node",
            "args": [
                "/path/to/aps-mcp-server-nodejs/server.js"
            ]
        }
    }
}
```

> For more details on how to add MCP servers to Visual Studio Code, see the [documentation](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)

### Cursor

- Create _.cursor/mcp.json_ file in your workspace, and add the following JSON to it:

```json
{
  "mcpServers": {
    "aps-mcp-server-nodejs": {
      "command": "node",
      "args": [
        "/path/to/aps-mcp-server-nodejs/server.js"
      ]
    }
  }
}
```

> For more details on how to add MCP servers to Cursor, see the [documentation](https://docs.cursor.com/context/model-context-protocol)

## Tools

### ACC Docs & Admin

| Tool | Description |
|---|---|
| `getProjectsTool` | List all accessible ACC accounts and projects |
| `getFolderContentsTool` | Browse folder contents (files and subfolders). `accountId` is only needed when `folderId` is omitted (top-level folders) |
| `createFolderTool` | Create a new folder |
| `moveFolderTool` | Move a folder to a new parent |
| `getFolderPermissionsTool` | Read folder permission assignments |
| `setFolderPermissionsTool` | Set folder permissions for users/roles/companies — `actions` sent as given; new subjects via `permissions:batch-create`, subjects with existing direct actions via `permissions:batch-update` (see [Folder permissions](#folder-permissions)) |
| `getIssuesTool` | List all issues in a project |
| `getIssueTypesTool` | List configured issue types and subtypes |
| `createIssueTool` | Create a new issue |
| `getProjectUsersTool` | List all users in a project |
| `getProjectRolesTool` | List the project's role catalogue (HQ v2 `industry_roles`, 2-legged token) — role ids are the `subjectId` for `ROLE` permission grants |
| `addAccountUserTool` | Add a user to the ACC account (hub-level) |
| `addProjectUserTool` | Add a user to a specific project |
| `getReviewWorkflowsTool` | List review workflows |
| `createReviewWorkflowTool` | Create a review workflow with steps |
| `createReviewTool` | Attach a review workflow to a document version |
| `getReviewsTool` | List reviews in a project |

#### Folder permissions

`setFolderPermissionsTool` sends each entry's `actions` array to the API exactly as given. The only check is that every action is in the documented vocabulary: `VIEW`, `DOWNLOAD`, `COLLABORATE`, `PUBLISH`, `PUBLISH_MARKUP`, `EDIT`, `CONTROL`. The documented permission levels come from the APS reference for [`permissions:batch-create`](https://aps.autodesk.com/en/docs/bim360/v1/reference/http/document-management-projects-project_id-folders-folder_id-permissionsbatch-create-POST/) (the page is JavaScript-rendered — open it in a browser; `curl` returns an empty frame):

Forma / ACC projects:

| Level | Actions |
|---|---|
| View Only | `VIEW, COLLABORATE` |
| View/Download | `VIEW, DOWNLOAD, COLLABORATE` |
| View/Download+PublishMarkups | `VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP` |
| View/Download+PublishMarkups+Upload | `PUBLISH, VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP` |
| View/Download+PublishMarkups+Upload+Edit | `PUBLISH, VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP, EDIT` |
| Full controller | `PUBLISH, VIEW, DOWNLOAD, COLLABORATE, PUBLISH_MARKUP, EDIT, CONTROL` |

Legacy BIM 360 Document Management projects:

| Level | Actions |
|---|---|
| View Only | `VIEW, COLLABORATE` |
| View/Download | `VIEW, DOWNLOAD, COLLABORATE` |
| Upload Only | `PUBLISH` |
| View/Download+Upload | `PUBLISH, VIEW, DOWNLOAD, COLLABORATE` |
| View/Download+Upload+Edit | `PUBLISH, VIEW, DOWNLOAD, COLLABORATE, EDIT` |
| Full controller | `PUBLISH, VIEW, DOWNLOAD, COLLABORATE, EDIT, CONTROL` |

Notes:

- `PUBLISH` without `EDIT` is valid (the Forma "View/Download+PublishMarkups+Upload" level), and `EDIT` / `CONTROL` are accepted by `permissions:batch-create` directly. Verified 2026-11-02 on an AUS-region ACC hub: 118 `ROLE` grants (View Only, View/Download, the Forma Upload set, and Full controller) were applied with one `permissions:batch-create` call per folder, 0 errors, and every grant read back as sent. The earlier "PUBLISH requires EDIT" guard and the create-then-update two-step (which sent an undocumented `UPLOAD` action) were wrong and have been removed.
- Routing: the tool reads `GET …/permissions` for the folder first. A subject that already holds direct `actions` there goes to `permissions:batch-update` (which replaces its set); every other subject — including ones that only inherit from a parent folder — goes to `permissions:batch-create`. Verified live 2026-11-06 on the sandbox: a `ROLE` that only inherited from the parent (`actions: []`, `inheritActions` set) was accepted by `permissions:batch-create` (HTTP 200; the direct grant was added and the inherited set kept), and once it held direct actions the next call went by `permissions:batch-update`. `permissions:batch-update` is also accepted for inherited-only rows (an external apply script wrote several hundred such grants that way on 2026-11-02 to 05), so either route works for them; the tool uses create, as the reference says. The result lists every subject with the operation used and the actions echoed by the API; if any subject was rejected, not echoed, or left unconfirmed by a request that failed before a response was read, the tool throws with the full per-subject report in the error message.
- A subject's effective permissions are its direct `actions` plus `inheritActions` from parent folders. Sub-folders inherit and cannot be set below the parent's level. Root folder permissions cannot be changed.
- Token and region: the APS reference marks these endpoints "user context optional" (2-legged client-credentials token, or SSA / 3-legged token). On an AUS-region hub, `GET …/permissions` returned 200 with both the SSA token and a 2-legged `data:read` token, and the 118-grant `permissions:batch-create` run used the SSA token; no region path segment or header was needed for any of them.
- Subject ids: `USER` = project member id (`getProjectUsersTool`); `ROLE` = the role's `id` UUID from `getProjectRolesTool` (its `member_group_id` is what `GET …/permissions` shows as `autodeskId`); `COMPANY` = company id (`accCompanyListTool`).
- A `ROLE` must be active in the project. `getProjectRolesTool` lists every account role; granting one that no project member holds was rejected by `permissions:batch-create` with HTTP 400 `ERR_PERMISSION_RESOURCE_NOT_EXIST_OR_NOT_ACTIVE` ("Some roles not in project or not active, error ids: …"), while roles held by at least one member were accepted (observed 2026-11-06 on a PTP-owned sandbox project). `getProjectRolesTool` cannot tell you which: the HQ v2 payload has no status or active flag. To check, look for the role on `getProjectUsersTool` — it returns the first 100 members only (no paging) and lists `roleIds` in `structuredContent.result.results[]`, not in its text output — or for an existing grant to that role on another folder (`GET …/permissions` shows it with `subjectStatus: ACTIVE`), or simply attempt the grant: the rejected batch writes nothing. One rejected subject fails its whole batch call — every subject in that batch is reported as `error` with the same body, which names the offending ids — but the tool still sends its other batch (create or update) for the remaining subjects, so read the per-subject report in the error before resending.
- `permissions:batch-update` verified live 2026-11-06 on one folder of a PTP-owned sandbox project (two project-active `ROLE` subjects, folder restored afterwards): create route 200 and read back exactly; update route 200 with the Forma "View/Download+PublishMarkups+Upload" set (`PUBLISH` without `EDIT`) and read back exactly; a further update to View Only shrank the set (replace, not merge); one call mixing a create and an update returned both results in input order. Cleanup used `permissions:batch-delete` (body `[{subjectId, subjectType}]`, HTTP 200 with no body), which the MCP server does not expose as a tool.
- `getProjectRolesTool` uses the 2-legged token on purpose: on an AUS-region ACC hub where the service account is a project admin, the SSA token got HTTP 403 `{"code":1003,"message":"The user does not have access to this project."}` from `hq/v2/…/industry_roles`, while the 2-legged token (`account:read`) returned every role on the identical URL.

### ACC Cost Management

Read-only tools for querying budget, contract, payment, and cost item data from ACC Cost Management.

| Tool | Endpoint | Description |
|---|---|---|
| `getCostContainerTool` | `properties` | Resolve and verify the cost container ID for a project. Call this first — other cost tools require the resolved `containerId`. |
| `getBudgetsTool` | `budgets` | List budget line items with codes, names, original/revised/forecast amounts, and status. |
| `getCostItemsTool` | `cost-items` | List cost items (actual costs and commitments) with amounts, committed, and paid values. |
| `getContractsTool` | `contracts` | List contracts, subcontracts, and purchase orders with vendor, amount, and status. |
| `getPaymentsTool` | `payments` | List payment applications/progress claims with amounts, dates, and billing periods. |
| `getPaymentItemsTool` | `payment-items` | List individual line items within a payment. **Requires at least one filter** (`paymentId`, `associationId`, or `associationType`). |
| `getCostSummaryTool` | `budgets` + `cost-items` | Computed budget-vs-actual variance table. Fetches both endpoints, aggregates by budget code, and returns variance and % spent. |

#### Cost API Setup

1. Ensure the SSA is invited to the project with Cost Management permissions
2. Enable Cost Management in ACC Admin > Project > Modules
3. Enable the Custom Integration for Cost in ACC Admin > Custom Integrations
4. Optionally set `ACC_COST_CONTAINER_ID` in `.env` to skip container resolution

#### Cost API Notes

- The Cost API base URL is `https://developer.api.autodesk.com/cost/v1/containers/{containerId}/{endpoint}`
- The `x-ads-region` header (from `ACC_ADS_REGION`) is required for AU/NZ projects
- Container ID is typically the same as the project ID (without `b.` prefix)
- Pagination is handled automatically (200 items/page, max 20 pages = 4,000 items)
