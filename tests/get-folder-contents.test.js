import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { dataManagementClient } from "../utils.js";
import { getFolderContentsTool } from "../tools/get-folder-contents.js";

const PROJECT = "b.aaaaaaaa-0000-0000-0000-000000000000";
const FOLDER = "urn:adsk.wipprodanz:fs.folder:co.AAAAAAAAAAAAAAAAAAAAAA";
const ITEMS = [
    { type: "folders", id: "urn:adsk.wipprodanz:fs.folder:co.BBBBBBBBBBBBBBBBBBBBBB", attributes: { displayName: "1.1 Project Charter" } },
    { type: "items", id: "urn:adsk.wipprodanz:dm.lineage:CCCCCCCCCCCCCCCCCCCCCC", attributes: { displayName: "charter.pdf" } },
];

/** Replace the two SDK methods the tool uses; restore in t.after. */
function patchClient(t, { folderContents = ITEMS, topFolders = ITEMS } = {}) {
    const originals = { getFolderContents: dataManagementClient.getFolderContents, getProjectTopFolders: dataManagementClient.getProjectTopFolders };
    const calls = { getFolderContents: [], getProjectTopFolders: [] };
    dataManagementClient.getFolderContents = async (...args) => { calls.getFolderContents.push(args); return { data: folderContents }; };
    dataManagementClient.getProjectTopFolders = async (...args) => { calls.getProjectTopFolders.push(args); return { data: topFolders }; };
    t.after(() => { Object.assign(dataManagementClient, originals); });
    return calls;
}

test("input schema: projectId required; accountId and folderId optional", () => {
    const schema = z.object(getFolderContentsTool.inputSchema);
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT, folderId: FOLDER }));
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT }));
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT, accountId: "acct" }));
    assert.throws(() => schema.parse({ folderId: FOLDER }));
    assert.throws(() => schema.parse({ projectId: "", folderId: FOLDER }));
});

test("folderId without accountId lists that folder via getFolderContents and never touches the top-folders call", async (t) => {
    const calls = patchClient(t);
    const result = await getFolderContentsTool.callback({ projectId: PROJECT, folderId: FOLDER });
    assert.deepEqual(calls.getFolderContents, [[PROJECT, FOLDER]]);
    assert.equal(calls.getProjectTopFolders.length, 0);
    assert.equal(result.structuredContent.contents.length, 2);
    assert.equal(result.content[0].text, [
        `- Folder: 1.1 Project Charter (ID: ${ITEMS[0].id})`,
        `- File: charter.pdf (ID: ${ITEMS[1].id})`,
    ].join("\n"));
});

test("no folderId and no accountId: a clear error, no SDK call", async (t) => {
    const calls = patchClient(t);
    await assert.rejects(() => getFolderContentsTool.callback({ projectId: PROJECT }), /accountId is required when folderId is not provided/);
    assert.equal(calls.getFolderContents.length, 0);
    assert.equal(calls.getProjectTopFolders.length, 0);
});

test("no folderId with accountId lists top folders; the hub id gets the b. prefix exactly once", async (t) => {
    const calls = patchClient(t);
    await getFolderContentsTool.callback({ accountId: "aaaaaaaa-0000-0000-0000-000000000000", projectId: PROJECT });
    await getFolderContentsTool.callback({ accountId: "b.aaaaaaaa-0000-0000-0000-000000000000", projectId: PROJECT });
    assert.deepEqual(calls.getProjectTopFolders, [
        ["b.aaaaaaaa-0000-0000-0000-000000000000", PROJECT],
        ["b.aaaaaaaa-0000-0000-0000-000000000000", PROJECT],
    ]);
    assert.equal(calls.getFolderContents.length, 0);
});
