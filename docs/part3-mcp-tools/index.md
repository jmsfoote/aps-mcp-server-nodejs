# Part 3: Create MCP Tools

In this part of the tutorial you will implement individual tools for our MCP server, and test them out.

## Get Projects

First, we will implement the **Get Projects** tool. This tool will return a list of accounts and projects the service account has access to.

### Implement Get Projects Tool

Create `tools/get-projects.js` with the following code:

```javascript
import { dataManagementClient } from "../utils.js";

export const getProjectsTool = {
    title: "Get Accounts & Projects",
    description: `
        Retrieves all Autodesk Construction Cloud (ACC) accounts and their associated projects accessible to the configured service account.
        Returns a structured list of accounts (with account IDs and names) and associated projects (with project IDs and names).
    `,
    inputSchema: {},
    callback: async () => {
        const accounts = await dataManagementClient.getHubs().then(res => res.data || []);
        for (const account of accounts) {
            account.projects = await dataManagementClient.getHubProjects(account.id).then(res => res.data || []);
        }
        const result = {
            accounts: accounts.map(a => ({
                id: a.id,
                name: a.attributes.name,
                projects: (a.projects || []).map(p => ({ id: p.id, name: p.attributes.name }))
            }))
        };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    }
};
```

The `getProjectsTool` object specifies several fields that will be used to register this tool to our MCP server:

- **title** - The unique name of the tool
- **description** - A detailed description of what the tool does (so that the AI agent knows _when_ and _how_ to call it)
- **inputSchema** - The schema of input parameters (empty in this case)
- **callback** - The function that will be executed when the tool is invoked; in this case it retrieves the list of ACC hubs and projects

> Note: The callback function returns an object with two fields: `content` and `structuredContent`. The `content` field is required; per the [MCP specification](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content), when `structuredContent` is present, `content` should also contain the serialized JSON for backwards compatibility with clients that do not yet support `structuredContent`. To keep the serialized JSON concise and avoid spamming the context window, only the essential fields (IDs, names, titles, statuses) are included.

### Add Get Projects Tool to Index

Add the following line of code to the end of `tools/index.js`:

```javascript
export { getProjectsTool } from "./get-projects.js";
```

### (Optional) Test Get Projects Tool in Visual Studio Code

If you've configured your MCP server in Visual Studio Code, you can already test the first tool:

- Start the MCP server by clicking the **Start** label in `.vscode/mcp.json`
- Open GitHub Copilot Chat
  - Click the **Toggle Chat** icon next to the search bar at the top of the window, or
  - Press `Cmd+Shift+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux)
- Try the following prompt: `What projects do I have access to?`
- Stop the MCP server by clicking the **Stop** label in `.vscode/mcp.json`

## Get Folder Contents

The next tool we will implement is the **Get Folder Contents** tool. This tool will return a list of folders and files at the root of a given project, or in a specific folder.

### Implement Get Folder Contents Tool

Create `tools/get-folder-contents.js` with the following code:

```javascript
import { z } from "zod";
import { dataManagementClient } from "../utils.js";

export const getFolderContentsTool = {
    title: "Get Folder Contents",
    description: `
        Retrieves the contents of a folder within an Autodesk Construction Cloud (ACC) project.
        Requires accountId and projectId parameters. If no folderId is provided, returns the top-level folders of the project.
        Returns the list of folders and files with their IDs and names.
    `,
    inputSchema: {
        accountId: z.string().nonempty(),
        projectId: z.string().nonempty(),
        folderId: z.string().optional()
    },
    callback: async ({ accountId, projectId, folderId }) => {
        const contents = folderId
            ? await dataManagementClient.getFolderContents(projectId, folderId).then(res => res.data || [])
            : await dataManagementClient.getProjectTopFolders(accountId, projectId).then(res => res.data || []);
        const result = {
            contents: contents.map(item => ({ id: item.id, type: item.type, name: item.attributes.displayName }))
        };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    }
};
```

In this case the `inputSchema` specifies three parameters using the [zod](https://zod.dev/) validation library:

- **accountId** - The ID of the ACC account (required, non-empty string)
- **projectId** - The ID of the ACC project (required, non-empty string)
- **folderId** - Optional ID of the folder to retrieve contents from

Thanks to this schema definition, AI agents will know that they need to provide account and project IDs when invoking this tool, and may optionally provide a folder ID.

### Add Get Folder Contents Tool to Index

Add the following line of code to the end of `tools/index.js`:

```javascript
export { getFolderContentsTool } from "./get-folder-contents.js";
```

### (Optional) Test Get Folder Contents Tool in Visual Studio Code

- Start the MCP server
- Try the following prompt: `List all *.rvt files in project XYZ`
- Stop the MCP server

## Get Issues

Next, we will implement the **Get Issues** tool. This tool will return a list of issues for a given project.

### Implement Get Issues Tool

Create `tools/get-issues.js` with the following code:

```javascript
import { z } from "zod";
import { issuesClient } from "../utils.js";

export const getIssuesTool = {
    title: "Get Issues",
    description: `
        Retrieves all issues within an Autodesk Construction Cloud (ACC) project. Requires a projectId parameter.
        Returns the list of issues with their IDs, titles, statuses, and issue type IDs.
    `,
    inputSchema: {
        projectId: z.string().nonempty()
    },
    callback: async ({ projectId }) => {
        const issues = await issuesClient.getIssues(projectId.replace("b.", "")).then(res => res.results || []);
        const result = {
            issues: issues.map(issue => ({ id: issue.id, title: issue.title, status: issue.status }))
        };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    }
};
```

### Add Get Issues Tool to Index

Add the following line of code to the end of `tools/index.js`:

```javascript
export { getIssuesTool } from "./get-issues.js";
```

### (Optional) Test Get Issues Tool in Visual Studio Code

- Start the MCP server
- Try the following prompt: `Any issues reported in project XYZ?`
- Stop the MCP server

## Get Issue Types

Finally, we will implement the **Get Issue Types** tool. This tool will return a list of issue types for a given project.

### Implement Get Issue Types Tool

Create `tools/get-issue-types.js` with the following code:

```javascript
import { z } from "zod";
import { issuesClient } from "../utils.js";

export const getIssueTypesTool = {
    title: "Get Issue Types",
    description: `
        Retrieves all configured issue types available in an Autodesk Construction Cloud (ACC) project.
        Requires a projectId parameter. Returns the list of issue types with their IDs, titles, and subtypes.
    `,
    inputSchema: {
        projectId: z.string().nonempty()
    },
    callback: async ({ projectId }) => {
        const issueTypes = await issuesClient.getIssuesTypes(projectId.replace("b.", ""), { include: "subtypes" }).then(res => res.results || []);
        const result = {
            issueTypes: issueTypes.map(t => ({
                id: t.id,
                title: t.title,
                subtypes: (t.subtypes || []).map(s => ({ id: s.id, title: s.title }))
            }))
        };
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result
        };
    }
};
```

### Add Get Issue Types Tool to Index

Add the following line of code to the end of `tools/index.js`:

```javascript
export { getIssueTypesTool } from "./get-issue-types.js";
```

The `tools/index.js` file should now look like this:

```javascript
export { getProjectsTool } from "./get-projects.js";
export { getFolderContentsTool } from "./get-folder-contents.js";
export { getIssuesTool } from "./get-issues.js";
export { getIssueTypesTool } from "./get-issue-types.js";
```

### (Optional) Test Get Issue Types Tool in Visual Studio Code

- Start the MCP server
- Try the following prompt: `What types of issues can be reported in project XYZ?`
- Stop the MCP server

## Try it out

Now that we have implemented all the tools, let's test them out using the MCP Inspector.

### Start MCP Inspector

If you have closed the MCP Inspector, open the terminal in your project folder, and run the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) again:

```bash
npx @modelcontextprotocol/inspector
```

### Connect to MCP Server

On the MCP Inspector webpage, configure your connection parameters as follows:

- **Transport Type**: `STDIO`
- **Command**: `node`
- **Arguments**: `server.js`

After that, click the **Connect** button.

### List Tools

This time, we should be able to get a list of tools exposed by our MCP server, and invoke them directly from the MCP Inspector webpage. Click the **List tools** button to retrieve the complete list of tools available in our MCP server:

![MCP Inspector - List Tools](images/mcp-inspector-list-tools.png)

As a result, the UI should list tools such as `getProjectsTool` or `getIssuesTool`.

![MCP Inspector - List Tools Result](images/mcp-inspector-list-tools-result.png)

### Test Get Projects Tool

Now, let's try the tool for listing ACC hubs that our service account has access to. Select the **getProjectsTool** tool, and click **Run Tool**.

![MCP Inspector - Run Tool](images/mcp-inspector-run-tool.png)

As a result, you should see a list of ACC accounts and projects that your application has access to.

![MCP Inspector - Run Tool Result](images/mcp-inspector-run-tool-result.png)
