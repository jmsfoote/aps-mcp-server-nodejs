import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { stubFetch } from "./setup.mjs";
import {
    setFolderPermissionsTool,
    planFolderPermissionWrites,
    FOLDER_PERMISSION_ACTIONS,
    FORMA_PERMISSION_LEVELS,
    BIM360_PERMISSION_LEVELS,
} from "../tools/set-folder-permissions.js";

const PROJECT = "b.aaaaaaaa-0000-0000-0000-000000000000";
const FOLDER = "urn:adsk.wipprodanz:fs.folder:co.AAAAAAAAAAAAAAAAAAAAAA";
const ROLE_A = "11111111-1111-1111-1111-111111111111";
const ROLE_B = "22222222-2222-2222-2222-222222222222";
const USER_C = "33333333-3333-3333-3333-333333333333";

// Forma "Create + Publish": PUBLISH without EDIT — the set the old tool refused.
const CP = FORMA_PERMISSION_LEVELS["View/Download+PublishMarkups+Upload"];
const FULL = FORMA_PERMISSION_LEVELS["Full controller"];

const schema = z.object(setFolderPermissionsTool.inputSchema);
const key = (p) => `${p.subjectType}:${p.subjectId}`;

/** Stub the three endpoints the tool touches. Non-matching calls throw. */
function apiStub({ existing = [], createStatus = 200, updateStatus = 200, echo = (body) => body } = {}) {
    return stubFetch(async (url, init) => {
        const method = init.method ?? "GET";
        if (method === "GET" && url.endsWith("/permissions")) return { status: 200, body: existing };
        if (method === "POST" && url.endsWith("/permissions:batch-create")) {
            return createStatus === 200
                ? { status: 200, body: { results: echo(JSON.parse(init.body)) } }
                : { status: createStatus, body: { code: 1234, message: "create failed" } };
        }
        if (method === "POST" && url.endsWith("/permissions:batch-update")) {
            return updateStatus === 200
                ? { status: 200, body: { results: echo(JSON.parse(init.body)) } }
                : { status: updateStatus, body: { code: 5678, message: "update failed" } };
        }
        throw new Error(`unexpected call ${method} ${url}`);
    });
}

// ─── Input schema ─────────────────────────────────────────────────────────────

test("input schema accepts PUBLISH without EDIT (Forma Create+Publish) and EDIT/CONTROL directly", () => {
    const parsed = schema.parse({
        projectId: PROJECT, folderId: FOLDER,
        permissions: [
            { subjectId: ROLE_A, subjectType: "ROLE", actions: CP },
            { subjectId: ROLE_B, subjectType: "ROLE", actions: FULL },
        ],
    });
    assert.deepEqual(parsed.permissions[0].actions, CP);
    assert.deepEqual(parsed.permissions[1].actions, FULL);
});

test("input schema accepts every documented level of BOTH tables, and every level only uses the vocabulary", () => {
    for (const [table, levels] of [["Forma", FORMA_PERMISSION_LEVELS], ["BIM 360", BIM360_PERMISSION_LEVELS]]) {
        assert.equal(Object.keys(levels).length, 6, `${table} has six documented levels`);
        for (const [name, actions] of Object.entries(levels)) {
            assert.doesNotThrow(
                () => schema.parse({ projectId: PROJECT, folderId: FOLDER, permissions: [{ subjectId: ROLE_A, subjectType: "ROLE", actions }] }),
                `${table}: ${name}`
            );
            for (const a of actions) assert.ok(FOLDER_PERMISSION_ACTIONS.includes(a), `${table}: ${name} uses ${a}`);
        }
    }
    assert.deepEqual([...FOLDER_PERMISSION_ACTIONS].sort(), ["COLLABORATE", "CONTROL", "DOWNLOAD", "EDIT", "PUBLISH", "PUBLISH_MARKUP", "VIEW"]);
});

test("input schema rejects undocumented actions (incl. the old UPLOAD), empty actions, empty permissions, bad subjectType", () => {
    const base = { projectId: PROJECT, folderId: FOLDER };
    assert.throws(() => schema.parse({ ...base, permissions: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: ["VIEW", "UPLOAD"] }] }), /UPLOAD|Invalid enum/);
    assert.throws(() => schema.parse({ ...base, permissions: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: ["view"] }] }));
    assert.throws(() => schema.parse({ ...base, permissions: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: [] }] }));
    assert.throws(() => schema.parse({ ...base, permissions: [] }));
    assert.throws(() => schema.parse({ ...base, permissions: [{ subjectId: ROLE_A, subjectType: "GROUP", actions: ["VIEW"] }] }));
    assert.throws(() => schema.parse({ ...base, permissions: [{ subjectId: "", subjectType: "ROLE", actions: ["VIEW"] }] }));
    assert.throws(() => schema.parse({ ...base, folderId: "", permissions: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: ["VIEW"] }] }));
});

test("input schema keeps autodeskId optional", () => {
    const perms = [{ subjectId: USER_C, subjectType: "USER", autodeskId: "ABC123XYZ", actions: ["VIEW", "COLLABORATE"] }];
    assert.equal(schema.parse({ projectId: PROJECT, folderId: FOLDER, permissions: perms }).permissions[0].autodeskId, "ABC123XYZ");
    assert.doesNotThrow(() => schema.parse({ projectId: PROJECT, folderId: FOLDER, permissions: [{ subjectId: USER_C, subjectType: "USER", actions: ["VIEW"] }] }));
});

// ─── Routing planner (pure) ───────────────────────────────────────────────────

test("planFolderPermissionWrites: direct actions → update; no entry or inherited-only → create; type is part of the key", () => {
    const existing = [
        { subjectId: ROLE_A, subjectType: "ROLE", actions: ["VIEW", "COLLABORATE"], inheritActions: [] },
        { subjectId: ROLE_B, subjectType: "ROLE", actions: [], inheritActions: ["VIEW", "COLLABORATE"] }, // inherited only
        { subjectId: USER_C, subjectType: "USER", userType: "PROJECT_ADMIN", inheritActions: FULL },     // no `actions` key at all
    ];
    const requested = [
        { subjectId: ROLE_A, subjectType: "ROLE", actions: CP },
        { subjectId: ROLE_B, subjectType: "ROLE", actions: CP },
        { subjectId: USER_C, subjectType: "USER", actions: FULL },
        { subjectId: ROLE_A, subjectType: "USER", actions: CP }, // same id, different type → a different subject
    ];
    const { create, update } = planFolderPermissionWrites(existing, requested);
    assert.deepEqual(update.map(key), [`ROLE:${ROLE_A}`]);
    assert.deepEqual(create.map(key), [`ROLE:${ROLE_B}`, `USER:${USER_C}`, `USER:${ROLE_A}`]);
});

test("planFolderPermissionWrites matches subjectId case-insensitively and tolerates a non-array GET body", () => {
    const existing = [{ subjectId: ROLE_A.toUpperCase(), subjectType: "ROLE", actions: ["VIEW"] }];
    const { update } = planFolderPermissionWrites(existing, [{ subjectId: ROLE_A, subjectType: "ROLE", actions: CP }]);
    assert.equal(update.length, 1);
    const { create } = planFolderPermissionWrites({ unexpected: true }, [{ subjectId: ROLE_A, subjectType: "ROLE", actions: CP }]);
    assert.equal(create.length, 1);
});

// ─── Callback: endpoint routing + pass-through ────────────────────────────────

test("all-new subjects: GET then exactly one batch-create; actions pass through unchanged; no batch-update, no UPLOAD", async (t) => {
    const stub = apiStub({ existing: [] });
    t.after(() => stub.restore());

    const result = await setFolderPermissionsTool.callback({
        projectId: PROJECT, folderId: FOLDER,
        permissions: [
            { subjectId: ROLE_A, subjectType: "ROLE", actions: CP },
            { subjectId: ROLE_B, subjectType: "ROLE", actions: FULL },
        ],
    });

    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0].method, "GET");
    assert.equal(stub.calls[0].url, `https://developer.api.autodesk.com/bim360/docs/v1/projects/${PROJECT}/folders/${FOLDER}/permissions`);
    assert.equal(stub.calls[1].method, "POST");
    assert.equal(stub.calls[1].url, `https://developer.api.autodesk.com/bim360/docs/v1/projects/${PROJECT}/folders/${FOLDER}/permissions:batch-create`);
    assert.equal(stub.calls[1].headers.Authorization, `Bearer ${process.env.APS_TOKEN_OVERRIDE}`);
    assert.equal(stub.calls[1].headers["Content-Type"], "application/json");
    // Body is a bare array; actions are the caller's, same values, same order.
    assert.deepEqual(stub.calls[1].body, [
        { subjectId: ROLE_A, subjectType: "ROLE", actions: CP },
        { subjectId: ROLE_B, subjectType: "ROLE", actions: FULL },
    ]);
    assert.ok(!JSON.stringify(stub.calls[1].body).includes("UPLOAD"), "the undocumented UPLOAD action must never be sent");

    assert.equal(result.structuredContent.applied, 2);
    assert.equal(result.structuredContent.requested, 2);
    assert.equal(result.structuredContent.created, 2);
    assert.equal(result.structuredContent.updated, 0);
    assert.deepEqual(result.structuredContent.results.map((r) => r.operation), ["create", "create"]);
    assert.deepEqual(result.structuredContent.results.map((r) => r.status), ["ok", "ok"]);
    assert.deepEqual(result.structuredContent.results[0].actions, CP);
    assert.match(result.content[0].text, /2 of 2 subject\(s\)/);
});

test("subject with existing direct actions: GET then batch-update only (no batch-create)", async (t) => {
    const stub = apiStub({ existing: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: ["VIEW", "COLLABORATE"], inheritActions: [] }] });
    t.after(() => stub.restore());

    const result = await setFolderPermissionsTool.callback({
        projectId: PROJECT, folderId: FOLDER,
        permissions: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: FULL }],
    });

    assert.deepEqual(stub.calls.map((c) => `${c.method} ${c.url.split("/").pop()}`), ["GET permissions", "POST permissions:batch-update"]);
    assert.deepEqual(stub.calls[1].body, [{ subjectId: ROLE_A, subjectType: "ROLE", actions: FULL }]);
    assert.equal(result.structuredContent.updated, 1);
    assert.equal(result.structuredContent.created, 0);
    assert.equal(result.structuredContent.results[0].operation, "update");
});

test("mixed subjects: one batch-create for new ones and one batch-update for existing ones; results keep input order", async (t) => {
    const stub = apiStub({ existing: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: ["VIEW", "COLLABORATE"] }] });
    t.after(() => stub.restore());

    const result = await setFolderPermissionsTool.callback({
        projectId: PROJECT, folderId: FOLDER,
        permissions: [
            { subjectId: ROLE_A, subjectType: "ROLE", actions: CP },   // existing → update
            { subjectId: ROLE_B, subjectType: "ROLE", actions: CP },   // new → create
            { subjectId: USER_C, subjectType: "USER", actions: FULL }, // new → create
        ],
    });

    assert.deepEqual(stub.calls.map((c) => `${c.method} ${c.url.split("/").pop()}`), ["GET permissions", "POST permissions:batch-create", "POST permissions:batch-update"]);
    assert.deepEqual(stub.calls[1].body.map((p) => p.subjectId), [ROLE_B, USER_C]);
    assert.deepEqual(stub.calls[2].body.map((p) => p.subjectId), [ROLE_A]);
    assert.deepEqual(result.structuredContent.results.map((r) => [r.subjectId, r.operation, r.status]), [
        [ROLE_A, "update", "ok"], [ROLE_B, "create", "ok"], [USER_C, "create", "ok"],
    ]);
    assert.equal(result.structuredContent.applied, 3);
    assert.match(result.content[0].text, /2 via permissions:batch-create, 1 via permissions:batch-update/);
});

test("inherited-only subject goes to batch-create (documented: unassigned subjects must use the create endpoint)", async (t) => {
    const stub = apiStub({ existing: [{ subjectId: ROLE_B, subjectType: "ROLE", actions: [], inheritActions: ["VIEW", "COLLABORATE"] }] });
    t.after(() => stub.restore());
    await setFolderPermissionsTool.callback({ projectId: PROJECT, folderId: FOLDER, permissions: [{ subjectId: ROLE_B, subjectType: "ROLE", actions: CP }] });
    assert.deepEqual(stub.calls.map((c) => `${c.method} ${c.url.split("/").pop()}`), ["GET permissions", "POST permissions:batch-create"]);
});

test("only documented request fields are forwarded (bookkeeping keys dropped, autodeskId kept when given)", async (t) => {
    const stub = apiStub();
    t.after(() => stub.restore());
    await setFolderPermissionsTool.callback({
        projectId: PROJECT, folderId: FOLDER,
        permissions: [
            { subjectId: ROLE_A, subjectType: "ROLE", actions: CP, _meta: { role: "Architect" } },
            { subjectId: USER_C, subjectType: "USER", autodeskId: "ABC123XYZ", actions: FULL },
        ],
    });
    assert.deepEqual(stub.calls[1].body, [
        { subjectId: ROLE_A, subjectType: "ROLE", actions: CP },
        { subjectId: USER_C, subjectType: "USER", autodeskId: "ABC123XYZ", actions: FULL },
    ]);
});

// ─── Callback: failures are loud and specific ─────────────────────────────────

test("GET failure aborts before any write and surfaces the status", async (t) => {
    const stub = stubFetch(async (url, init) => {
        if ((init.method ?? "GET") === "GET") return { status: 403, body: { code: 1003, message: "The user does not have access to this project." } };
        throw new Error(`unexpected write ${init.method} ${url}`);
    });
    t.after(() => stub.restore());
    await assert.rejects(
        () => setFolderPermissionsTool.callback({ projectId: PROJECT, folderId: FOLDER, permissions: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: CP }] }),
        /Failed to read existing folder permissions \(403\).*1003/
    );
    assert.equal(stub.calls.length, 1);
});

test("a rejected batch-create is reported per subject with status + body; the batch-update group is still attempted", async (t) => {
    const stub = apiStub({ existing: [{ subjectId: ROLE_A, subjectType: "ROLE", actions: ["VIEW"] }], createStatus: 400 });
    t.after(() => stub.restore());
    await assert.rejects(
        () => setFolderPermissionsTool.callback({
            projectId: PROJECT, folderId: FOLDER,
            permissions: [
                { subjectId: ROLE_A, subjectType: "ROLE", actions: FULL }, // update → ok
                { subjectId: ROLE_B, subjectType: "ROLE", actions: CP },   // create → 400
            ],
        }),
        (err) => {
            assert.match(err.message, /1 of 2 subject\(s\)/);
            assert.match(err.message, /1 subject\(s\) failed/);
            assert.match(err.message, /permissions:batch-create failed \(400\)/);
            assert.match(err.message, /create failed/);
            assert.ok(err.message.includes(ROLE_B) && !err.message.includes(`"subjectId":"${ROLE_A}"`), "only the failed subject is listed");
            // Partial success is carried on the error for callers that aggregate counts (push-permissions.js).
            assert.equal(err.applied, 1);
            assert.equal(err.requested, 2);
            assert.deepEqual(err.results.map((r) => [r.subjectId, r.operation, r.status]), [[ROLE_A, "update", "ok"], [ROLE_B, "create", "error"]]);
            assert.equal(err.results[1].httpStatus, 400);
            return true;
        }
    );
    assert.deepEqual(stub.calls.map((c) => `${c.method} ${c.url.split("/").pop()}`), ["GET permissions", "POST permissions:batch-create", "POST permissions:batch-update"]);
});

test("a subject missing from the API echo is not counted as applied", async (t) => {
    const stub = apiStub({ echo: (body) => body.slice(0, 1) });
    t.after(() => stub.restore());
    await assert.rejects(
        () => setFolderPermissionsTool.callback({
            projectId: PROJECT, folderId: FOLDER,
            permissions: [
                { subjectId: ROLE_A, subjectType: "ROLE", actions: CP },
                { subjectId: ROLE_B, subjectType: "ROLE", actions: CP },
            ],
        }),
        /1 of 2 subject\(s\).*not_echoed/s
    );
});
