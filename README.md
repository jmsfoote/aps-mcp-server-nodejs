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
| `getFolderContentsTool` | Browse folder contents (files and subfolders) |
| `createFolderTool` | Create a new folder |
| `moveFolderTool` | Move a folder to a new parent |
| `getFolderPermissionsTool` | Read folder permission assignments |
| `setFolderPermissionsTool` | Set folder permissions for users/roles/companies |
| `getIssuesTool` | List all issues in a project |
| `getIssueTypesTool` | List configured issue types and subtypes |
| `createIssueTool` | Create a new issue |
| `getProjectUsersTool` | List all users in a project |
| `addAccountUserTool` | Add a user to the ACC account (hub-level) |
| `addProjectUserTool` | Add a user to a specific project |
| `getReviewWorkflowsTool` | List review workflows |
| `createReviewWorkflowTool` | Create a review workflow with steps |
| `createReviewTool` | Attach a review workflow to a document version |
| `getReviewsTool` | List reviews in a project |

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
