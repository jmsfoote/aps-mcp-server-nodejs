#!/usr/bin/env node

/**
 * PTP ACC Project Setup Script
 *
 * Reads a spreadsheet and automates:
 * 1. Adding users to the ACC account and project
 * 2. Creating folder structure
 * 3. Setting folder permissions
 * 4. Creating issues
 *
 * Usage: node project-setup.js <spreadsheet.xlsx> <projectId> [--dry-run]
 *
 * The projectId should NOT include the "b." prefix.
 */

import XLSX from 'xlsx';
import { adminClient, dataManagementClient, issuesClient, getAccessToken } from './utils.js';
import { APS_CLIENT_ID, APS_CLIENT_SECRET, ACC_ACCOUNT_ID, ACC_REGION, ACC_ADS_REGION } from './config.js';

// ============================================================
// Configuration (loaded from .env via config.js)
// ============================================================
const ACCOUNT_ID = ACC_ACCOUNT_ID;
const REGION = ACC_REGION || 'AUS';
const ADS_REGION = ACC_ADS_REGION || 'APAC';
const TOKEN_ENDPOINT = 'https://developer.api.autodesk.com/authentication/v2/token';

// Get a 2-legged token for Account Admin API (requires client_credentials, not SSA)
async function get2LeggedToken() {
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: APS_CLIENT_ID,
        client_secret: APS_CLIENT_SECRET,
        scope: 'data:read data:write account:read account:write'
    });
    const resp = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!resp.ok) throw new Error(`Failed to get 2-legged token: ${await resp.text()}`);
    const data = await resp.json();
    return data.access_token;
}

const PERMISSION_LEVELS = {
    'View Only': ['VIEW', 'COLLABORATE'],
    'View + Download': ['VIEW', 'DOWNLOAD', 'COLLABORATE'],
    'Upload Only': ['PUBLISH'],
    'View + Download + Upload': ['PUBLISH', 'VIEW', 'DOWNLOAD', 'COLLABORATE'],
    'View + Download + Upload + Edit': ['PUBLISH', 'VIEW', 'DOWNLOAD', 'COLLABORATE', 'EDIT'],
    'Full Control': ['PUBLISH', 'VIEW', 'DOWNLOAD', 'COLLABORATE', 'EDIT', 'CONTROL'],
};

// ============================================================
// Input validation
// ============================================================
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TEXT_REGEX = /^[\w\s\-.,;:!?()@#&'/\u00C0-\u024F]+$/;
const MAX_FIELD_LENGTH = 500;

function validateEmail(email) {
    return typeof email === 'string' && EMAIL_REGEX.test(email) && email.length < 255;
}

function validateText(text, maxLen = MAX_FIELD_LENGTH) {
    return typeof text === 'string' && text.length <= maxLen;
}

function sanitizeText(text) {
    if (typeof text !== 'string') return '';
    return text.slice(0, MAX_FIELD_LENGTH).trim();
}

function validateRows(rows, sheetName) {
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // header is row 1

        // Email validation
        if (sheetName === 'Users' && row.email && !validateEmail(row.email)) {
            errors.push(`Users row ${rowNum}: invalid email "${row.email}"`);
        }
        if (sheetName === 'Permissions') {
            if (row.email && !validateEmail(row.email)) {
                errors.push(`Permissions row ${rowNum}: invalid email "${row.email}"`);
            }
            if (row.permissionLevel && !PERMISSION_LEVELS[row.permissionLevel.trim()]) {
                errors.push(`Permissions row ${rowNum}: unknown permission level "${row.permissionLevel}" (valid: ${Object.keys(PERMISSION_LEVELS).join(', ')})`);
            }
        }
        if (sheetName === 'Issues' && row.assignedToEmail && !validateEmail(row.assignedToEmail)) {
            errors.push(`Issues row ${rowNum}: invalid assignedToEmail "${row.assignedToEmail}"`);
        }

        // Required field checks
        if (sheetName === 'Users' && !row.email?.trim()) {
            errors.push(`Users row ${rowNum}: missing required field "email"`);
        }
        if (sheetName === 'Folders' && !row.folderPath?.trim()) {
            errors.push(`Folders row ${rowNum}: missing required field "folderPath"`);
        }
        if (sheetName === 'Folders' && !row.parentFolder?.trim()) {
            errors.push(`Folders row ${rowNum}: missing required field "parentFolder"`);
        }
        if (sheetName === 'Issues' && !row.title?.trim()) {
            errors.push(`Issues row ${rowNum}: missing required field "title"`);
        }
        if (sheetName === 'Issues' && (!row.issueType?.trim() || !row.issueSubtype?.trim())) {
            errors.push(`Issues row ${rowNum}: missing required field "issueType" or "issueSubtype"`);
        }

        // Check for suspiciously long fields
        for (const [key, val] of Object.entries(row)) {
            if (typeof val === 'string' && val.length > MAX_FIELD_LENGTH) {
                errors.push(`${sheetName} row ${rowNum}: field "${key}" exceeds ${MAX_FIELD_LENGTH} chars`);
            }
        }
    }
    return errors;
}

// ============================================================
// Helpers
// ============================================================
// Maps plain-English spreadsheet headers → internal camelCase keys.
// Supports both formats so old templates (camelCase) and new templates
// (plain English) both work without changes.
const HEADER_MAP = {
    // Users sheet
    'Email Address':     'email',
    'email':             'email',
    'First Name':        'firstName',
    'firstName':         'firstName',
    'Last Name':         'lastName',
    'lastName':          'lastName',
    'Company Name':      'companyName',
    'companyName':       'companyName',
    'Project Role':      'roleName',
    'roleName':          'roleName',
    // Folders sheet
    'Folder Path':       'folderPath',
    'folderPath':        'folderPath',
    'Parent Folder':     'parentFolder',
    'parentFolder':      'parentFolder',
    // Permissions sheet
    'Permission Level':  'permissionLevel',
    'permissionLevel':   'permissionLevel',
    // Issues sheet
    'Issue Title':       'title',
    'title':             'title',
    'Description':       'description',
    'description':       'description',
    'Issue Type':        'issueType',
    'issueType':         'issueType',
    'Issue Subtype':     'issueSubtype',
    'issueSubtype':      'issueSubtype',
    'Status':            'status',
    'status':            'status',
    'Assigned To (Email)': 'assignedToEmail',
    'assignedToEmail':   'assignedToEmail',
    'Due Date':          'dueDate',
    'dueDate':           'dueDate',
};

// One known header per sheet so we can find the header row automatically
// (works for both plain English and camelCase formats)
const EXPECTED_HEADERS = {
    Users:       ['Email Address', 'email'],
    Folders:     ['Folder Path', 'folderPath'],
    Permissions: ['Email Address', 'email'],
    Issues:      ['Issue Title', 'title'],
};

function readSheet(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    // Convert to array of arrays to find the header row
    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const candidates = EXPECTED_HEADERS[sheetName] || [];

    // Find the row that contains a recognised header column name
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(allRows.length, 20); i++) {
        const row = allRows[i];
        if (row && row.some(cell => candidates.includes(String(cell).trim()))) {
            headerRowIndex = i;
            break;
        }
    }

    // Parse with the detected header row as the starting point
    const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex });

    // Remap column keys: plain-English headers → internal camelCase keys
    const remapped = rows.map(row => {
        const out = {};
        for (const [col, val] of Object.entries(row)) {
            const key = HEADER_MAP[col.trim()] || col; // pass-through unknown cols
            out[key] = val;
        }
        return out;
    });

    // Filter out empty rows (rows where all values are empty/whitespace)
    return remapped.filter(row => {
        return Object.values(row).some(v =>
            v !== undefined && v !== null && String(v).trim() !== ''
        );
    });
}

function log(emoji, msg) {
    console.log(`${emoji} ${msg}`);
}

function logError(msg, err) {
    const detail = err?.axiosError?.response?.data
        ? JSON.stringify(err.axiosError.response.data)
        : err.message;
    console.error(`  ERROR: ${msg}: ${detail}`);
}

// ============================================================
// Step 1: Users
// ============================================================
async function setupUsers(rows, projectId, roleMap, dryRun) {
    log('👥', `Processing ${rows.length} users...`);
    const userIdMap = new Map(); // email -> project member ID

    // Get 2-legged token for Account Admin API
    let twoLegToken;
    if (!dryRun) {
        twoLegToken = await get2LeggedToken();
    }

    for (const row of rows) {
        const email = row.email?.trim();
        if (!email) continue;

        const firstName = row.firstName?.trim() || '';
        const lastName = row.lastName?.trim() || '';
        const roleName = row.roleName?.trim() || '';
        const roleId = roleMap.get(roleName);

        if (dryRun) {
            log('  🔍', `[DRY RUN] Would add user: ${firstName} ${lastName} (${email}) role: ${roleName}`);
            continue;
        }

        // Step 1a: Add to account via HQ v1 endpoint (requires 2-legged token)
        try {
            const payload = { email };
            if (firstName) payload.first_name = firstName;
            if (lastName) payload.last_name = lastName;

            const resp = await fetch(
                `https://developer.api.autodesk.com/hq/v1/accounts/${ACCOUNT_ID}/users`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${twoLegToken}`,
                        'Content-Type': 'application/json',
                        'Region': REGION
                    },
                    body: JSON.stringify(payload)
                }
            );
            if (resp.ok) {
                log('  ✅', `Added to account: ${firstName} ${lastName} (${email})`);
            } else if (resp.status === 409) {
                log('  ℹ️', `Already in account: ${email}`);
            } else {
                const errBody = await resp.text();
                log('  ⚠️', `Account add for ${email} returned ${resp.status}: ${errBody}`);
            }
        } catch (err) {
            logError(`Failed to add ${email} to account`, err);
        }

        // Step 1b: Add to project via SSA (importProjectUsers)
        try {
            const user = { email };
            if (firstName) user.firstName = firstName;
            if (lastName) user.lastName = lastName;
            if (roleId) user.roleIds = [roleId];
            user.products = [{ key: 'docs', access: 'member' }];

            const result = await adminClient.importProjectUsers(projectId, { users: [user] }, { region: REGION });
            const success = result.success || 0;
            const failure = result.failure || 0;
            if (success > 0) {
                log('  ✅', `Added to project: ${email}${roleName ? ` (${roleName})` : ''}`);
            } else if (failure > 0) {
                const errors = result.failure_items?.[0]?.errors || [];
                log('  ⚠️', `Failed to add ${email} to project: ${JSON.stringify(errors)}`);
            } else {
                // success=0, failure=0 means user already exists in project
                log('  ℹ️', `Already in project: ${email}`);
            }
        } catch (err) {
            logError(`Failed to add ${email} to project`, err);
        }
    }

    // Build user ID maps from project users
    // userIdMap: email -> project member ID (for folder permissions)
    // autodeskIdMap: email -> autodeskId (for issue assignment)
    const autodeskIdMap = new Map();
    if (!dryRun) {
        try {
            const projectUsers = await adminClient.getProjectUsers(projectId, { region: REGION, limit: 200 });
            const users = projectUsers.results || projectUsers || [];
            for (const u of users) {
                userIdMap.set(u.email, u.id);
                if (u.autodeskId) {
                    autodeskIdMap.set(u.email, u.autodeskId);
                }
            }
        } catch (err) {
            logError('Failed to fetch project users for ID mapping', err);
        }
    }

    return { userIdMap, autodeskIdMap };
}

// ============================================================
// Step 2: Folders
// ============================================================
async function setupFolders(rows, projectId, dryRun) {
    log('📁', `Processing ${rows.length} folders...`);
    const folderIdMap = new Map(); // folderPath -> folderId
    const projectIdWithB = `b.${projectId}`;

    // First, get existing top-level folders to find "Project Files"
    try {
        const topFolders = await dataManagementClient.getProjectTopFolders(
            `b.${ACCOUNT_ID}`, projectIdWithB
        );
        const items = topFolders.data || [];
        for (const item of items) {
            const name = item.attributes?.displayName || item.attributes?.name;
            if (name) {
                folderIdMap.set(name, item.id);
            }
        }
    } catch (err) {
        logError('Failed to get top-level folders', err);
        return folderIdMap;
    }

    // Get existing folders inside "Project Files"
    const projectFilesId = folderIdMap.get('Project Files');
    if (projectFilesId) {
        await mapExistingFolders(projectIdWithB, projectFilesId, '', folderIdMap);
    }

    // Create folders in order (parents before children)
    for (const row of rows) {
        const folderPath = row.folderPath?.trim();
        const parentFolderName = row.parentFolder?.trim();
        if (!folderPath || !parentFolderName) continue;

        // Get the folder name (last segment of the path)
        const folderName = folderPath.includes('/') ? folderPath.split('/').pop() : folderPath;

        // Check if folder already exists
        if (folderIdMap.has(folderPath)) {
            log('  ℹ️', `Already exists: ${folderPath}`);
            continue;
        }

        // Find parent folder ID
        const parentId = folderIdMap.get(parentFolderName);
        if (!parentId) {
            log('  ⚠️', `Parent folder not found: "${parentFolderName}" for "${folderPath}"`);
            continue;
        }

        if (dryRun) {
            log('  🔍', `[DRY RUN] Would create: ${folderPath} (in ${parentFolderName})`);
            folderIdMap.set(folderPath, `dry-run-${folderPath}`);
            continue;
        }

        try {
            const payload = {
                jsonapi: { version: '1.0' },
                data: {
                    type: 'folders',
                    attributes: {
                        name: folderName,
                        extension: {
                            type: 'folders:autodesk.bim360:Folder',
                            version: '1.0'
                        }
                    },
                    relationships: {
                        parent: {
                            data: { type: 'folders', id: parentId }
                        }
                    }
                }
            };
            const result = await dataManagementClient.createFolder(projectIdWithB, payload);
            const newId = result.data?.id;
            const newName = result.data?.attributes?.displayName || result.data?.attributes?.name || folderName;
            folderIdMap.set(folderPath, newId);
            log('  ✅', `Created: ${folderPath}`);
        } catch (err) {
            if (err.axiosError?.response?.status === 409) {
                log('  ℹ️', `Already exists (conflict): ${folderPath}`);
                // Try to find the existing folder ID
                await mapExistingFolders(projectIdWithB, folderIdMap.get(parentFolderName), parentFolderName, folderIdMap);
            } else {
                logError(`Failed to create folder "${folderPath}"`, err);
            }
        }
    }

    return folderIdMap;
}

async function mapExistingFolders(projectIdWithB, parentFolderId, parentPath, folderIdMap) {
    try {
        const contents = await dataManagementClient.getFolderContents(projectIdWithB, parentFolderId);
        const items = contents.data || [];
        for (const item of items) {
            if (item.type === 'folders') {
                const name = item.attributes?.displayName || item.attributes?.name;
                const path = parentPath ? `${parentPath}/${name}` : name;
                folderIdMap.set(path, item.id);
                folderIdMap.set(name, item.id); // Also map by name alone for parent lookups
            }
        }
    } catch (err) {
        // Silently continue - folder may not have contents
    }
}

// ============================================================
// Step 3: Permissions
// ============================================================
async function setupPermissions(rows, projectId, userIdMap, folderIdMap, dryRun) {
    log('🔒', `Processing ${rows.length} permission entries...`);
    const projectIdWithB = `b.${projectId}`;
    const token = await getAccessToken();

    for (const row of rows) {
        const email = row.email?.trim();
        const folderPath = row.folderPath?.trim();
        const permissionLevel = row.permissionLevel?.trim();
        if (!email || !folderPath || !permissionLevel) continue;

        const actions = PERMISSION_LEVELS[permissionLevel];
        if (!actions) {
            log('  ⚠️', `Unknown permission level: "${permissionLevel}" for ${email} on ${folderPath}`);
            continue;
        }

        const userId = userIdMap.get(email);
        if (!userId) {
            log('  ⚠️', `User not found in project: ${email}`);
            continue;
        }

        const folderId = folderIdMap.get(folderPath);
        if (!folderId) {
            log('  ⚠️', `Folder not found: "${folderPath}"`);
            continue;
        }

        if (dryRun) {
            log('  🔍', `[DRY RUN] Would set ${permissionLevel} for ${email} on ${folderPath}`);
            continue;
        }

        try {
            const url = `https://developer.api.autodesk.com/bim360/docs/v1/projects/${projectIdWithB}/folders/${folderId}/permissions:batch-create`;
            const payload = [{
                subjectId: userId,
                subjectType: 'USER',
                actions
            }];
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!resp.ok) {
                const errText = await resp.text();
                log('  ⚠️', `Failed to set permission for ${email} on ${folderPath}: ${errText}`);
            } else {
                log('  ✅', `Set ${permissionLevel}: ${email} on ${folderPath}`);
            }
        } catch (err) {
            logError(`Failed to set permission for ${email} on ${folderPath}`, err);
        }
    }
}

// ============================================================
// Step 4: Issues
// ============================================================
async function setupIssues(rows, projectId, autodeskIdMap, dryRun) {
    log('📋', `Processing ${rows.length} issues...`);

    // Get issue types/subtypes mapping
    const issueTypes = await issuesClient.getIssuesTypes(projectId, { include: 'subtypes' });
    const results = issueTypes.results || issueTypes || [];
    const subtypeMap = new Map(); // "TypeName/SubtypeName" -> subtypeId
    for (const t of results) {
        if (t.subtypes) {
            for (const s of t.subtypes) {
                subtypeMap.set(`${t.title}/${s.title}`, s.id);
            }
        }
    }

    for (const row of rows) {
        const title = row.title?.trim();
        if (!title) continue;

        const description = row.description?.trim() || '';
        const issueType = row.issueType?.trim() || '';
        const issueSubtype = row.issueSubtype?.trim() || '';
        const status = row.status?.trim() || 'open';
        const assignedToEmail = row.assignedToEmail?.trim() || '';
        const dueDate = row.dueDate?.trim?.() || (row.dueDate ? String(row.dueDate) : '');

        const subtypeKey = `${issueType}/${issueSubtype}`;
        const issueSubtypeId = subtypeMap.get(subtypeKey);
        if (!issueSubtypeId) {
            log('  ⚠️', `Issue type not found: "${subtypeKey}" for issue "${title}"`);
            continue;
        }

        if (dryRun) {
            log('  🔍', `[DRY RUN] Would create issue: "${title}" (${subtypeKey})`);
            continue;
        }

        try {
            const payload = {
                title,
                issueSubtypeId,
                status,
                published: true
            };
            if (description) payload.description = description;
            if (assignedToEmail && autodeskIdMap.has(assignedToEmail)) {
                payload.assignedTo = autodeskIdMap.get(assignedToEmail);
                payload.assignedToType = 'user';
            }
            if (dueDate) payload.dueDate = dueDate;

            const result = await issuesClient.createIssue(projectId, payload, { xAdsRegion: ADS_REGION });
            log('  ✅', `Created issue #${result.displayId}: "${result.title}"`);
        } catch (err) {
            logError(`Failed to create issue "${title}"`, err);
        }
    }
}

// ============================================================
// Main
// ============================================================
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node project-setup.js <spreadsheet.xlsx> <projectId> [--dry-run]');
        console.log('');
        console.log('  spreadsheet.xlsx  Path to the setup spreadsheet');
        console.log('  projectId         ACC project ID (without "b." prefix)');
        console.log('  --dry-run         Preview what would happen without making changes');
        process.exit(1);
    }

    const spreadsheetPath = args[0];
    const projectId = args[1];
    const dryRun = args.includes('--dry-run');

    if (dryRun) {
        log('🔍', 'DRY RUN MODE - no changes will be made\n');
    }

    log('📖', `Reading spreadsheet: ${spreadsheetPath}`);
    const workbook = XLSX.readFile(spreadsheetPath);

    const usersRows = readSheet(workbook, 'Users');
    const foldersRows = readSheet(workbook, 'Folders');
    const permissionsRows = readSheet(workbook, 'Permissions');
    const issuesRows = readSheet(workbook, 'Issues');

    log('📊', `Found: ${usersRows.length} users, ${foldersRows.length} folders, ${permissionsRows.length} permissions, ${issuesRows.length} issues\n`);

    // Validate projectId format
    if (!UUID_REGEX.test(projectId)) {
        console.error(`ERROR: projectId "${projectId}" is not a valid UUID format.`);
        process.exit(1);
    }

    // Validate all sheet data before making any API calls
    const allErrors = [
        ...validateRows(usersRows, 'Users'),
        ...validateRows(foldersRows, 'Folders'),
        ...validateRows(permissionsRows, 'Permissions'),
        ...validateRows(issuesRows, 'Issues')
    ];
    if (allErrors.length > 0) {
        console.error('\n❌ Validation errors found in spreadsheet:');
        for (const e of allErrors) {
            console.error(`  - ${e}`);
        }
        console.error(`\nFix these ${allErrors.length} error(s) and re-run.`);
        process.exit(1);
    }
    log('✅', 'Input validation passed\n');

    // Build role name -> ID map from existing project roles
    const roleMap = new Map();
    try {
        const existingUsers = await adminClient.getProjectUsers(projectId, { region: REGION, limit: 200 });
        const allUsers = existingUsers.results || existingUsers || [];
        for (const u of allUsers) {
            if (u.roles) {
                for (const r of u.roles) {
                    roleMap.set(r.name, r.id);
                }
            }
        }
    } catch (err) {
        logError('Failed to fetch project roles', err);
    }

    // Step 1: Users
    console.log('\n' + '='.repeat(60));
    const { userIdMap, autodeskIdMap } = await setupUsers(usersRows, projectId, roleMap, dryRun);

    // Step 2: Folders
    console.log('\n' + '='.repeat(60));
    const folderIdMap = await setupFolders(foldersRows, projectId, dryRun);

    // Step 3: Permissions
    console.log('\n' + '='.repeat(60));
    await setupPermissions(permissionsRows, projectId, userIdMap, folderIdMap, dryRun);

    // Step 4: Issues
    console.log('\n' + '='.repeat(60));
    await setupIssues(issuesRows, projectId, autodeskIdMap, dryRun);

    console.log('\n' + '='.repeat(60));
    log('🎉', 'Project setup complete!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
