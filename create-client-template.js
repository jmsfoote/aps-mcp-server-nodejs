#!/usr/bin/env node

/**
 * Generates the canonical PTP-Project-Setup-Template.xlsx — the client-facing
 * onboarding workbook used to configure an Autodesk Construction Cloud (ACC)
 * project before the bot runs the push.
 *
 * Sheets produced (in order):
 *   0. Setup Checklist  — Account Admin pre-flight (5 manual ACC UI items)
 *   1. Instructions     — overview + how-to
 *   2. Folders          — folder structure (canonical-structure warning)
 *   3. Permissions      — role × folder × permission level
 *   4. Issues           — pre-loaded issues (General/General default)
 *   5. Reviews          — review/approval workflows
 *   6. Reference        — dropdown sources (PermissionLevels, IssueStatuses, IssueTypes)
 *   7. Roles            — 23-row ACC catalog with TRUE/FALSE active column
 *   8. Companies        — bulk-import payload (snake_case headers match tools/companies/schema.js)
 *
 * Regenerate when the canonical XLSX intentionally changes (e.g. new sheet,
 * column rename, instruction rewording). Do NOT run against the canonical path
 * until verification passes — emit to /tmp first and diff.
 *
 * Verification:
 *   PATH="/opt/homebrew/opt/node@22/bin:$PATH" node create-client-template.js /tmp/rebuilt-template.xlsx
 *   then run the 6 checks in REBUILD_GENERATOR_BRIEFING.md §5.
 *
 * Context: REBUILD_GENERATOR_BRIEFING.md (this directory).
 *
 * Usage: node create-client-template.js [output-path]
 */

import ExcelJS from 'exceljs';

const outputPath = process.argv[2]
    || '/Users/jamesfoote/Documents/PTP/Construction/ptp-acc-mcp/PTP-Project-Setup-Template.xlsx';

// ============================================================
// Colour palette
// ============================================================
const COLOURS = {
    ptpBlue:     '004AAD',
    ptpNavy:     '0F1035',
    ptpTeal:     '5892A0',
    ptpLightBlue:'DAE9F8',
    ptpGreen:    'DAF2D0',
    ptpPink:     'F2CEEF',
    ptpCoral:    'F1A983',
    exampleRow:  'DAE9F8',
    white:       'FFFFFF',
    black:       '000000',
    darkGrey:    '404040',
    midGrey:     '808080',
    errorRed:    'FF0000',
    warnYellow:  'FFF8E1',
    warnRed:     'FFEEEE',
};

// ============================================================
// Style helpers
// ============================================================
const FONT_TITLE = { name: 'Aptos', size: 16, bold: true, color: { argb: COLOURS.white } };
const FONT_SECTION = { name: 'Aptos', size: 12, bold: true, color: { argb: COLOURS.white } };
const FONT_INSTRUCTION = { name: 'Aptos', size: 10, color: { argb: COLOURS.darkGrey } };
const FONT_INSTRUCTION_BOLD = { name: 'Aptos', size: 10, bold: true, color: { argb: COLOURS.darkGrey } };
const FONT_HEADER = { name: 'Aptos', size: 10, bold: true, color: { argb: COLOURS.white } };
const FONT_DATA = { name: 'Aptos', size: 10, color: { argb: COLOURS.black } };
const FONT_EXAMPLE = { name: 'Aptos', size: 10, italic: true, color: { argb: COLOURS.ptpTeal } };
const FONT_REQUIRED = { name: 'Aptos', size: 10, italic: true, color: { argb: COLOURS.errorRed } };

function fillBg(argb) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const BORDER_THIN = {
    top: { style: 'thin', color: { argb: 'D0D0D0' } },
    bottom: { style: 'thin', color: { argb: 'D0D0D0' } },
    left: { style: 'thin', color: { argb: 'D0D0D0' } },
    right: { style: 'thin', color: { argb: 'D0D0D0' } },
};

const ALIGN_WRAP = { vertical: 'top', wrapText: true };
const ALIGN_CENTER = { vertical: 'middle', horizontal: 'center', wrapText: true };

function styleInstructionRow(row, cols) {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber <= cols) {
            cell.fill = fillBg(COLOURS.ptpLightBlue);
            cell.font = FONT_INSTRUCTION;
            cell.alignment = ALIGN_WRAP;
            cell.border = BORDER_THIN;
        }
    });
}

function styleHeaderRow(row, cols) {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber <= cols) {
            cell.fill = fillBg(COLOURS.ptpBlue);
            cell.font = FONT_HEADER;
            cell.alignment = ALIGN_CENTER;
            cell.border = BORDER_THIN;
        }
    });
}

function styleExampleRow(row, cols) {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber <= cols) {
            cell.fill = fillBg(COLOURS.exampleRow);
            cell.font = FONT_EXAMPLE;
            cell.alignment = ALIGN_WRAP;
            cell.border = BORDER_THIN;
        }
    });
}

function styleDataRow(row, cols) {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber <= cols) {
            cell.fill = fillBg(COLOURS.white);
            cell.font = FONT_DATA;
            cell.alignment = ALIGN_WRAP;
            cell.border = BORDER_THIN;
        }
    });
}

function addTitleRow(ws, text, cols) {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, cols);
    const cell = row.getCell(1);
    cell.fill = fillBg(COLOURS.ptpBlue);
    cell.font = FONT_TITLE;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    row.height = 36;
    return row;
}

function addSectionRow(ws, text, cols) {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, cols);
    const cell = row.getCell(1);
    cell.fill = fillBg(COLOURS.ptpBlue);
    cell.font = FONT_SECTION;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    row.height = 26;
    return row;
}

function addInstructionRow(ws, text, cols) {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, cols);
    styleInstructionRow(row, cols);
    row.height = text.length > 80 ? 40 : 20;
    return row;
}

function addBlankRow(ws) {
    const row = ws.addRow([]);
    row.height = 8;
    return row;
}

// ============================================================
// Reference data
// ============================================================
const PERMISSION_LEVELS = [
    'View Only',
    'View + Download',
    'Upload Only',
    'View + Download + Upload',
    'View + Download + Upload + Edit',
    'Full Control',
];

const ISSUE_STATUSES = ['open', 'pending', 'in_progress', 'in_review', 'completed', 'closed'];

const ISSUE_TYPES = [
    ['Quality', 'Quality'],
    ['Quality', 'Defect'],
    ['Coordination', 'Coordination'],
    ['Coordination', 'Clash'],
    ['Developer Action Items', 'DA Approval'],
    ['Lender', 'IC Pack'],
];

// ============================================================
// Sheet builders (canonical order)
// ============================================================

// Sheet 0
function buildSetupChecklist(wb) {
    const ws = wb.addWorksheet('0. Setup Checklist', { properties: { tabColor: { argb: COLOURS.ptpBlue } } });
    ws.columns = [{ width: 6 }, { width: 90 }];
    const cols = 2;

    addTitleRow(ws, 'Account Admin — Pre-flight Checklist', cols);
    addBlankRow(ws);
    addInstructionRow(ws, 'Complete these five items BEFORE filling in the rest of this workbook. Each is owned by your ACC Account Admin and must be done in the ACC web UI — your PTP automation cannot do them for you.', cols);
    addBlankRow(ws);

    addSectionRow(ws, 'The five pre-flight items', cols);
    addBlankRow(ws);

    const checklist = [
        [
            '1. Approve the APS Custom Integration on this hub',
            'Hub Admin → Custom Integrations → Add custom integration. Paste the APS Client ID provided by PTP. Without this step, the bot literally cannot see your hub. (You will see "Service Account Detected — has no access by default" — that is expected.)',
        ],
        [
            '2. Create the custom roles listed in the Roles sheet',
            'Account Admin → Roles → Create role. Use the exact ACC catalog name from the Roles sheet column A. Skip any rows in the Roles sheet marked "Skip — handled by Administrator" or "Skip — niche".',
        ],
        [
            '3. Decide on issue type/subtype configuration',
            'ACC ships with 10 default issue types (General, Quality, Safety, Punch List, etc.). The Issues sheet defaults to "General / General". If you want richer issue typing, configure custom types in Project Admin → Issues BEFORE the push. If you accept defaults, no action needed.',
        ],
        [
            '4. Enable the Reviews module (only if using review workflows)',
            "Project Admin → Modules → Reviews → toggle on. Required only if the Reviews sheet has any rows. If your account tier doesn't include Reviews, the module won't appear — confirm before populating that sheet.",
        ],
        [
            '5. Send the populated workbook back with confirmation',
            'Once the four items above are done AND the data sheets (Companies, Roles, Folders, Permissions, Issues, Reviews) are populated, return this workbook to your PTP project contact. Confirmation that items 1–4 are complete is required before PTP runs the push.',
        ],
    ];

    for (const [title, body] of checklist) {
        const titleRow = ws.addRow(['[ ]', title]);
        titleRow.getCell(1).font = { name: 'Aptos', size: 14, bold: true };
        titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
        titleRow.getCell(2).font = { name: 'Aptos', size: 11, bold: true, color: { argb: COLOURS.ptpBlue } };
        titleRow.getCell(2).alignment = ALIGN_WRAP;
        titleRow.getCell(1).border = BORDER_THIN;
        titleRow.getCell(2).border = BORDER_THIN;
        titleRow.height = 22;

        const bodyRow = ws.addRow(['', body]);
        bodyRow.getCell(2).font = FONT_INSTRUCTION;
        bodyRow.getCell(2).alignment = ALIGN_WRAP;
        bodyRow.getCell(2).border = BORDER_THIN;
        bodyRow.getCell(1).border = BORDER_THIN;
        bodyRow.height = Math.max(40, Math.ceil(body.length / 90) * 18);
        addBlankRow(ws);
    }

    addSectionRow(ws, 'Why this checklist exists', cols);
    addBlankRow(ws);
    const why = [
        "PTP's automation handles the structural setup (folders, role-based permissions, companies, issues, reviews). Each of the five items above is a prerequisite that ACC requires you to do manually in the web UI — they cannot be done via API.",
        "Doing these upfront, before populating the data sheets, eliminates the back-and-forth that otherwise surfaces during the push: 'role doesn't exist', 'integration not approved', 'Reviews module disabled'. Each of those was a 30-minute stall on a recent client. With this checklist done first, the push is mechanical.",
    ];
    for (const line of why) addInstructionRow(ws, line, cols);
}

// Sheet 1
function buildInstructions(wb) {
    const ws = wb.addWorksheet('Instructions', { properties: { tabColor: { argb: COLOURS.ptpBlue } } });
    ws.columns = [{ width: 100 }];

    addTitleRow(ws, 'PTP Group — ACC Project Setup', 1);
    addBlankRow(ws);

    const overviewLines = [
        'Welcome! This spreadsheet is used to set up your Autodesk Construction Cloud (ACC) project.',
        '',
        'By completing the tabs in this workbook, we can automatically configure:',
        '  1. Project companies (the firms involved in the project)',
        '  2. Project roles (the role names used on the project)',
        '  3. Folder structure for document management',
        '  4. Folder permissions for each role',
        '  5. Initial project issues and tasks (optional)',
        '  6. Document review and approval workflows (optional)',
    ];
    for (const line of overviewLines) addInstructionRow(ws, line, 1);

    addBlankRow(ws);
    addSectionRow(ws, 'How to Complete This Spreadsheet', 1);
    addBlankRow(ws);

    const steps = [
        'Step 1: COMPANIES TAB — List the firms involved in the project (architect, builder, lawyer, etc.). Use ACC-recognized trade names.',
        'Step 2: ROLES TAB — List the role names used on this project (Architect, Project Manager, Lawyer, etc.).',
        'Step 3: FOLDERS TAB — Define the folder structure. A standard structure is pre-populated — modify it to suit your project.',
        'Step 4: PERMISSIONS TAB — For each role, specify which folders they can access and at what level.',
        'Step 5: ISSUES TAB (Optional) — Pre-load known issues, defects, or action items into the project.',
        'Step 6: REVIEWS TAB (Optional) — Define document review and approval workflows.',
        '',
        'Each tab has yellow example rows showing the expected format. Replace these with your actual data.',
        'Use the dropdown menus where available — they ensure the data is in the correct format.',
        'The Reference tab contains the dropdown lists for permission levels and issue types.',
        'The Roles tab contains the dropdown source for Permissions and the trade list on Companies.',
    ];
    for (const line of steps) addInstructionRow(ws, line, 1);

    addBlankRow(ws);
    addSectionRow(ws, 'Important Notes', 1);
    addBlankRow(ws);

    const notes = [
        'ACC project members are added MANUALLY in ACC — not through this spreadsheet. This spreadsheet sets up the project structure (companies, roles, folders, permissions); user invitations are handled separately by your PTP project manager.',
        'Folder paths use "/" to indicate nesting. For example: "02. Design/Architectural" means "Architectural" sits inside "02. Design".',
        'All top-level folders are created inside the "Project Files" root folder in ACC.',
        'Permission levels range from "View Only" (read-only) to "Full Control" (full admin). See the Reference tab for details.',
        'Due dates for issues should be in YYYY-MM-DD format (e.g., 2026-04-15).',
        'Issue assignees and review candidates use ACC member emails. Those members must be added to the project manually in ACC before the spreadsheet is run.',
        '',
        'Once completed, return this spreadsheet to your PTP project contact. We will review it and run the setup.',
        'If you have questions, reach out to your PTP project manager.',
    ];
    for (const line of notes) addInstructionRow(ws, line, 1);

    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
}

// Sheet 2
function buildFolders(wb) {
    const ws = wb.addWorksheet('Folders', { properties: { tabColor: { argb: COLOURS.ptpTeal } } });
    const cols = 2;

    ws.columns = [
        { width: 50 },
        { width: 35 },
    ];

    addTitleRow(ws, 'Folder Structure', cols);
    addInstructionRow(ws, 'Define the folder structure for your project. Folders are created inside the "Project Files" root folder in ACC.', cols);
    addInstructionRow(ws, 'The "Folder Path" column defines the folder name and its position in the hierarchy using "/" separators.', cols);
    addInstructionRow(ws, 'The "Parent Folder" column tells the system which folder to create this folder inside. Top-level folders use "Project Files" as parent.', cols);
    addInstructionRow(ws, 'IMPORTANT: List parent folders BEFORE their children. The system creates folders in the order listed.', cols);
    addInstructionRow(ws, 'A standard folder structure is pre-populated below. Modify, add, or remove rows to match your project needs.', cols);

    // Canonical-structure warning row (light red, bold red text, merged A:B, height 32)
    const warnText = 'ONE canonical structure only — do NOT keep multiple drafts (Current/Draft/NEW) in this sheet. If you have alternate options, decide before sending. Mixed/draft structures will not be pushed.';
    const warnRow = ws.addRow([warnText]);
    ws.mergeCells(warnRow.number, 1, warnRow.number, cols);
    const warnCell = warnRow.getCell(1);
    warnCell.fill = fillBg(COLOURS.warnRed);
    warnCell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: COLOURS.errorRed } };
    warnCell.alignment = ALIGN_WRAP;
    warnCell.border = BORDER_THIN;
    warnRow.height = 32;

    addBlankRow(ws);

    const headerRow = ws.addRow(['Folder Path', 'Parent Folder']);
    styleHeaderRow(headerRow, cols);
    headerRow.height = 22;

    // PTP project lifecycle folder structure (canonical)
    const folderExamples = [
        ['0. Working & Drafts', 'Project Files'],
        ['1. Origination & Feasibility', 'Project Files'],
        ['1. Origination & Feasibility/1.04 QS & Cost Plans', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.1 Project Overview', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.2 Risk Management', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.3 Developer Background', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.5 Feasibility & Sensitivity', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.6 Market Research', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.7 Corporate Background', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.8 Funding & Capital', '1. Origination & Feasibility'],
        ['1. Origination & Feasibility/1.9 Exit Strategy', '1. Origination & Feasibility'],
        ['2. Finance, Sales & Marketing', 'Project Files'],
        ['2. Finance, Sales & Marketing/2.1 Valuations', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.2 Bank Submission', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.3 Term Sheets', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.4 Facility Documents', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.5 Security & Guarantees', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.6 Sales Strategy', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.7 Sales Records', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.9 Rental Appraisals', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.11 Cost Management', '2. Finance, Sales & Marketing'],
        ['2. Finance, Sales & Marketing/2.12 Lender Overview', '2. Finance, Sales & Marketing'],
        ['3. Site Acquisition', 'Project Files'],
        ['3. Site Acquisition/3.1 Contract of Sale', '3. Site Acquisition'],
        ['3. Site Acquisition/3.2 Title & Dealings', '3. Site Acquisition'],
        ['3. Site Acquisition/3.3 Survey & Plans', '3. Site Acquisition'],
        ['3. Site Acquisition/3.4 Environmental & Geotech', '3. Site Acquisition'],
        ['3. Site Acquisition/3.5 Settlement', '3. Site Acquisition'],
        ['3. Site Acquisition/3.6 Due Diligence (Other)', '3. Site Acquisition'],
        ['4. Planning, Design & Approvals', 'Project Files'],
        ['4. Planning, Design & Approvals/4.1 Design WIP', '4. Planning, Design & Approvals'],
        ['4. Planning, Design & Approvals/4.2 Design Shared', '4. Planning, Design & Approvals'],
        ['4. Planning, Design & Approvals/4.3 Design Published', '4. Planning, Design & Approvals'],
        ['4. Planning, Design & Approvals/4.4 Permits & Conditions', '4. Planning, Design & Approvals'],
        ['4. Planning, Design & Approvals/4.5 Supply Authorities', '4. Planning, Design & Approvals'],
        ['4. Planning, Design & Approvals/4.6 Consultants', '4. Planning, Design & Approvals'],
        ['4. Planning, Design & Approvals/4.7 Reports', '4. Planning, Design & Approvals'],
        ['4. Planning, Design & Approvals/4.8 Shop Drawings', '4. Planning, Design & Approvals'],
        ['5. Procurement & Construction', 'Project Files'],
        ['5. Procurement & Construction/5.1 Methodology', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.2 BOQ', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.3 Builder', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.4 Safety & Compliance', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.5 Insurances', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.6 Certifications', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.7 Cost Management', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.8 Reporting', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.9 Specialist Contracts', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.10 Suppliers', '5. Procurement & Construction'],
        ['5. Procurement & Construction/5.11 Program', '5. Procurement & Construction'],
        ['6. Completion & Handover', 'Project Files'],
        ['6. Completion & Handover/6.1 Certificates', '6. Completion & Handover'],
        ['6. Completion & Handover/6.2 Defects', '6. Completion & Handover'],
        ['6. Completion & Handover/6.3 O&M', '6. Completion & Handover'],
        ['7. Operate', 'Project Files'],
        ['7. Operate/7.1 Settlements', '7. Operate'],
        ['7. Operate/7.2 Warranties & Maintenance', '7. Operate'],
        ['7. Operate/7.3 Project Review', '7. Operate'],
        ['99. Archive', 'Project Files'],
    ];
    for (const ex of folderExamples) {
        const row = ws.addRow(ex);
        styleExampleRow(row, cols);
    }

    ws.views = [{ state: 'frozen', ySplit: 9, activeCell: 'A10' }];
}

// Sheet 3
function buildPermissions(wb) {
    const ws = wb.addWorksheet('Permissions', { properties: { tabColor: { argb: COLOURS.ptpTeal } } });
    const cols = 3;

    ws.columns = [
        { width: 35 },
        { width: 50 },
        { width: 38 },
    ];

    addTitleRow(ws, 'Folder Permissions', cols);
    addInstructionRow(ws, 'Set what each role can do in each folder. One row per role-folder combination.', cols);
    addInstructionRow(ws, 'The role name must match an entry from the Roles tab. The folder path must match an entry from the Folders tab.', cols);
    addInstructionRow(ws, 'Select the permission level from the dropdown. See the Reference tab for what each level allows.', cols);
    addBlankRow(ws);

    addSectionRow(ws, 'Permission Level Summary', cols);
    const permSummaries = [
        'View Only — Can see files but cannot download or upload.',
        'View + Download — Can see and download files.',
        'Upload Only — Can upload files but cannot see existing files.',
        'View + Download + Upload — Can see, download, and upload files.',
        'View + Download + Upload + Edit — Can see, download, upload, and edit files.',
        'Full Control — Full admin access including managing permissions.',
    ];
    for (const line of permSummaries) addInstructionRow(ws, line, cols);
    addBlankRow(ws);

    const headerRow = ws.addRow(['Role Name', 'Folder Path', 'Permission Level']);
    styleHeaderRow(headerRow, cols);
    headerRow.height = 22;

    const permExamples = [
        ['Construction Manager', '03. Construction', 'View + Download + Upload'],
        ['Construction Manager', '03. Construction/Site Photos', 'View + Download + Upload + Edit'],
        ['Construction Manager', '04. Finance/Claims', 'View + Download'],
        ['Architect', '02. Design', 'View + Download + Upload + Edit'],
        ['Architect', '02. Design/Architectural', 'Full Control'],
        ['Architect', '01. Project Management/Meeting Minutes', 'View + Download'],
        ['Civil Engineer', '02. Design/Structural', 'View + Download + Upload + Edit'],
        ['Civil Engineer', '02. Design/Civil', 'Full Control'],
        ['Civil Engineer', '03. Construction/RFIs', 'View + Download + Upload'],
    ];
    for (const ex of permExamples) {
        const row = ws.addRow(ex);
        styleExampleRow(row, cols);
    }

    for (let i = 0; i < 50; i++) {
        const row = ws.addRow(['', '', '']);
        styleDataRow(row, cols);
    }

    const permDataStart = 16;
    const permDataEnd = permDataStart + 58;
    for (let r = permDataStart; r <= permDataEnd; r++) {
        ws.getCell(`C${r}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['PermissionLevels'],
            showErrorMessage: true,
            errorTitle: 'Invalid Permission Level',
            error: 'Please select a permission level from the dropdown list.',
        };
    }

    ws.views = [{ state: 'frozen', ySplit: 15, activeCell: 'A16' }];
}

// Sheet 4
function buildIssues(wb) {
    const ws = wb.addWorksheet('Issues', { properties: { tabColor: { argb: COLOURS.ptpTeal } } });
    const cols = 7;

    ws.columns = [
        { width: 40 },
        { width: 55 },
        { width: 18 },
        { width: 20 },
        { width: 14 },
        { width: 30 },
        { width: 16 },
    ];

    addTitleRow(ws, 'Issues Register', cols);
    addInstructionRow(ws, 'Pre-load issues, defects, or action items into the project. This tab is optional — leave it empty if not needed.', cols);
    addInstructionRow(ws, 'Columns: title (required) | description | issueType (required) | issueSubtype (required) | status | assignedToEmail | dueDate', cols);
    addInstructionRow(ws, 'Assigned To should be an ACC member email (managed manually in ACC). Due Date should be YYYY-MM-DD format (e.g. 2026-04-15). Status defaults to "open".', cols);
    addInstructionRow(ws, 'Use the dropdowns for status to ensure valid values. See the Reference tab for valid issue type/subtype combinations.', cols);
    addBlankRow(ws);

    // Yellow note row about General/General default (merged A:G, height 60, light yellow)
    const noteText = 'DEFAULTS to "General / General" — ACC ships with 10 default Issue Types (General, Quality, Safety, Punch List, Coordination, etc.). The example row uses General/General because it is universal. To use richer types like "Quality / Defect", pick from the Reference tab. To use TRULY custom types like "Development Checklist / Feaso", configure them in ACC Project Admin → Issues BEFORE the push (see Setup Checklist item 3) — otherwise those rows will be silently skipped.';
    const noteRow = ws.addRow([noteText]);
    ws.mergeCells(noteRow.number, 1, noteRow.number, cols);
    const noteCell = noteRow.getCell(1);
    noteCell.fill = fillBg(COLOURS.warnYellow);
    noteCell.font = { name: 'Aptos', size: 10, color: { argb: COLOURS.darkGrey } };
    noteCell.alignment = ALIGN_WRAP;
    noteCell.border = BORDER_THIN;
    noteRow.height = 60;

    const headerRow = ws.addRow(['Issue Title', 'Description', 'Issue Type', 'Issue Subtype', 'Status', 'Assigned To (Email)', 'Due Date']);
    styleHeaderRow(headerRow, cols);
    headerRow.height = 22;

    const issueExamples = [
        ['Concrete pour inspection required', 'Level 2 slab pour needs independent inspection before proceeding', 'General', 'General', 'open', 'contractor1@example.com', '2026-04-15'],
        ['Architectural drawings revision needed', 'Window schedule conflicts with structural openings on Level 3', 'Coordination', 'Clash', 'open', 'architect@example.com', '2026-03-25'],
        ['Stormwater design review', 'Council requires updated stormwater management plan', 'Coordination', 'Coordination', 'open', 'engineer@example.com', '2026-04-01'],
    ];
    for (const ex of issueExamples) {
        const row = ws.addRow(ex);
        styleExampleRow(row, cols);
    }

    for (let i = 0; i < 30; i++) {
        const row = ws.addRow(['', '', '', '', '', '', '']);
        styleDataRow(row, cols);
    }

    const issueDataStart = 9;
    const issueDataEnd = issueDataStart + 32;
    for (let r = issueDataStart; r <= issueDataEnd; r++) {
        ws.getCell(`E${r}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['IssueStatuses'],
            showErrorMessage: true,
            errorTitle: 'Invalid Status',
            error: 'Please select a status from the dropdown list.',
        };
    }

    ws.views = [{ state: 'frozen', ySplit: 7, activeCell: 'A8' }];
}

// Sheet 5
function buildReviews(wb) {
    const ws = wb.addWorksheet('Reviews');
    const cols = 8;

    ws.columns = [
        { width: 30 },
        { width: 40 },
        { width: 12 },
        { width: 25 },
        { width: 15 },
        { width: 40 },
        { width: 18 },
        { width: 15 },
    ];

    addTitleRow(ws, 'Review Workflows', cols);
    addBlankRow(ws);
    addInstructionRow(ws, 'Define document review and approval workflows for this project. Each workflow can have 1-6 sequential steps.', cols);
    addInstructionRow(ws, 'Candidates are specified by email address. Multiple candidates per step are separated by semicolons.', cols);
    addInstructionRow(ws, 'Reviewer = provides feedback and can reject. Approver = final decision authority on that step.', cols);
    addBlankRow(ws);

    const headerRow = ws.addRow(['Workflow Name', 'Description', 'Step Number', 'Step Name', 'Role', 'Candidates (Email)', 'Time Allowed (Days)', 'Day Type']);
    styleHeaderRow(headerRow, cols);
    headerRow.height = 22;

    const examples = [
        ['Payment Application Review', 'Review process for contractor payment claims', 1, 'PM Review', 'Reviewer', 'pm@example.com', 5, 'Business Days'],
        ['Payment Application Review', 'Review process for contractor payment claims', 2, 'Director Approval', 'Approver', 'director@example.com', 3, 'Business Days'],
        ['Design Submission Review', 'Formal review of design documentation', 1, 'Design Manager Review', 'Reviewer', 'design.mgr@example.com', 5, 'Business Days'],
        ['Design Submission Review', 'Formal review of design documentation', 2, 'Client Approval', 'Approver', 'client@example.com', 7, 'Business Days'],
        ['Variation Claim Review', 'Review and approval of variation claims', 1, 'QS Assessment', 'Reviewer', 'qs@example.com', 3, 'Business Days'],
        ['Variation Claim Review', 'Review and approval of variation claims', 2, 'PM Approval', 'Approver', 'pm@example.com', 5, 'Business Days'],
        ['Safety Document Review', 'SWMS and safety plan approvals', 1, 'Site Manager Review', 'Reviewer', 'site.mgr@example.com', 2, 'Business Days'],
    ];
    for (const ex of examples) {
        const row = ws.addRow(ex);
        styleExampleRow(row, cols);
    }

    // Inline dropdowns: col E = Reviewer/Approver, col H = Business Days/Calendar Days
    for (let r = 8; r <= 100; r++) {
        ws.getCell(`E${r}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['"Reviewer,Approver"'],
        };
        ws.getCell(`H${r}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['"Business Days,Calendar Days"'],
        };
    }
}

// Sheet 6
function buildReference(wb) {
    const ws = wb.addWorksheet('Reference', { properties: { tabColor: { argb: COLOURS.ptpNavy } } });

    const REF_LIST_ROWS = 30;

    ws.columns = [
        { width: 28 },  // A: (formerly Roles, now empty — Roles named range moved to Roles sheet)
        { width: 8 },   // B: spacer
        { width: 38 },  // C: Permission Levels
        { width: 8 },   // D: spacer
        { width: 16 },  // E: Statuses
        { width: 8 },   // F: spacer
        { width: 25 },  // G: Issue Types
        { width: 25 },  // H: Issue Subtypes
    ];

    const refHeaderRow = ws.addRow(['', '', 'Permission Levels', '', 'Issue Statuses', '', 'Issue Types', 'Issue Subtypes']);
    refHeaderRow.eachCell((cell) => {
        cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: COLOURS.white } };
        cell.fill = fillBg(COLOURS.ptpBlue);
        cell.alignment = ALIGN_CENTER;
    });

    const refDescRow = ws.addRow([
        '',
        '',
        'Do not change these values',
        '',
        'Do not change these values',
        '',
        'Add type + subtype pairs here',
        '',
    ]);
    refDescRow.eachCell((cell) => {
        cell.font = { name: 'Aptos', size: 9, italic: true, color: { argb: COLOURS.midGrey } };
    });

    for (let i = 0; i < REF_LIST_ROWS; i++) {
        const rowData = [
            '',
            '',
            PERMISSION_LEVELS[i] || '',
            '',
            ISSUE_STATUSES[i] || '',
            '',
            ISSUE_TYPES[i]?.[0] || '',
            ISSUE_TYPES[i]?.[1] || '',
        ];
        const row = ws.addRow(rowData);
        row.eachCell((cell) => {
            cell.font = FONT_DATA;
            cell.border = BORDER_THIN;
        });
    }

    ws.addRow([]);
    const permDetailHeader = ws.addRow(['', '', 'Permission Level Details', '', '', '', '', '']);
    permDetailHeader.getCell(3).font = { name: 'Aptos', size: 10, bold: true };

    const permDetails = [
        ['', '', 'View Only', '', 'Can see files in the folder but cannot download or upload.'],
        ['', '', 'View + Download', '', 'Can see and download files from the folder.'],
        ['', '', 'Upload Only', '', 'Can upload files but cannot see existing files in the folder.'],
        ['', '', 'View + Download + Upload', '', 'Can see, download, and upload files.'],
        ['', '', 'View + Download + Upload + Edit', '', 'Full file access: view, download, upload, and edit.'],
        ['', '', 'Full Control', '', "Full admin access including managing other users' permissions."],
    ];
    for (const detail of permDetails) {
        const row = ws.addRow(detail);
        row.getCell(3).font = { name: 'Aptos', size: 10, bold: true };
        row.getCell(5).font = FONT_INSTRUCTION;
    }
}

// Sheet 7
function buildRoles(wb) {
    const ws = wb.addWorksheet('Roles', { properties: { tabColor: { argb: COLOURS.ptpTeal } } });
    ws.columns = [{ width: 28 }, { width: 50 }, { width: 28 }];
    const cols = 3;

    addTitleRow(ws, 'Project Roles', cols);
    addInstructionRow(ws, 'Roles defined here drive folder permissions and Company trade selection.', cols);
    addInstructionRow(ws, 'IMPORTANT — use the ACC catalog name in column A exactly as written. ACC uses formal industry terms (e.g. "Legal" not "Lawyer", "Quantity Surveyor" not "QS"). Renaming after the fact requires a manual step.', cols);
    addInstructionRow(ws, 'Column B explains whether ACC has the role in its built-in catalog or whether you need to create it as a custom role in Account Admin → Roles. Items marked "Skip" are intentionally left out and handled by the system Administrator role or are too niche for a default setup.', cols);
    addInstructionRow(ws, 'Column C is your decision: tick TRUE if this role is active for this project, FALSE if not. The push only applies role-based permissions for TRUE rows.', cols);
    addBlankRow(ws);

    const headerRow = ws.addRow(['Role Name', 'ACC Catalog Status', 'Active for this project? (TRUE/FALSE)']);
    styleHeaderRow(headerRow, cols);
    headerRow.height = 22;

    const roles = [
        ['Accountant', 'Standard ACC role — no setup needed', ''],
        ['Architect', 'Standard ACC role — no setup needed', ''],
        ['BIM Manager', 'Standard ACC role — no setup needed', ''],
        ['Builder', 'Standard ACC role — no setup needed', ''],
        ['Civil Engineer', 'Standard ACC role — no setup needed', ''],
        ['Construction Manager', 'Custom — create in ACC UI if needed', ''],
        ['Contract Administrator', 'Custom — create in ACC UI if needed', ''],
        ['Contractor', 'Standard ACC role — no setup needed', ''],
        ['Document Manager', 'Standard ACC role — no setup needed', ''],
        ['Engineer', 'Standard ACC role — no setup needed', ''],
        ['Legal', 'Standard ACC role — use "Legal", NOT "Lawyer"', ''],
        ['Project Manager', 'Standard ACC role — no setup needed', ''],
        ['Quantity Surveyor', 'Standard ACC role — use "Quantity Surveyor", NOT "QS"', ''],
        ['Real Estate Agent', 'Standard ACC role — no setup needed', ''],
        ['Surveyor', 'Standard ACC role — no setup needed', ''],
        ['Urban Planner', 'Standard ACC role — no setup needed', ''],
        ['Valuator', 'Standard ACC role — no setup needed', ''],
        ['Certifier', 'Custom — create in ACC UI if needed', ''],
        ['Site Manager', 'Custom — create in ACC UI if needed', ''],
        ['Funder', 'Skip — niche, ask PTP if you need this', ''],
        ['Settlement Agent', 'Skip — niche, ask PTP if you need this', ''],
        ['Executive', 'Skip — covered by ACC Administrator role', ''],
        ['Executive Admin', 'Skip — covered by ACC Administrator role', ''],
    ];
    for (const r of roles) {
        const row = ws.addRow(r);
        styleDataRow(row, cols);
        ws.getCell(`C${row.number}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['"TRUE,FALSE"'],
        };
    }
    for (let i = 0; i < 10; i++) {
        const row = ws.addRow(['', '', '']);
        styleDataRow(row, cols);
        ws.getCell(`C${row.number}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['"TRUE,FALSE"'],
        };
    }

    ws.views = [{ state: 'frozen', ySplit: 7, activeCell: 'A8' }];
}

// Sheet 8
function buildCompanies(wb) {
    const ws = wb.addWorksheet('Companies', { properties: { tabColor: { argb: COLOURS.ptpTeal } } });
    const cols = 13;

    ws.columns = [
        { width: 35 },  // name
        { width: 28 },  // trade
        { width: 35 },  // address_line_1
        { width: 18 },  // address_line_2
        { width: 18 },  // city
        { width: 18 },  // state_or_province
        { width: 14 },  // postal_code
        { width: 14 },  // country
        { width: 18 },  // phone
        { width: 28 },  // website_url
        { width: 18 },  // erp_id
        { width: 22 },  // tax_id
        { width: 30 },  // description
    ];

    addTitleRow(ws, 'Project Companies', cols);
    addInstructionRow(ws, "List every firm involved in this project. PTP's bot will bulk-import each company into your ACC hub via the accCompanyBulkImportPreviewTool MCP path.", cols);
    addInstructionRow(ws, 'Required column: name. Everything else is optional but recommended for downstream search/filter UX. country defaults to "Australia" if blank.', cols);
    addInstructionRow(ws, 'Headers below use the snake_case names that match the ACC API field names exactly — do not rename headers. The bot maps them 1:1 to the import payload.', cols);
    addInstructionRow(ws, 'tax_id: Australian Business Number (ABN) format "12 345 678 901" or any plain string the ACC accepts.', cols);
    addBlankRow(ws);

    const headers = [
        'name', 'trade', 'address_line_1', 'address_line_2', 'city',
        'state_or_province', 'postal_code', 'country', 'phone',
        'website_url', 'erp_id', 'tax_id', 'description',
    ];
    const headerRow = ws.addRow(headers);
    styleHeaderRow(headerRow, cols);
    headerRow.height = 22;

    const exampleRow = ws.addRow([
        'Example Construction Pty Ltd', 'General Contractor', '123 Collins Street', 'Level 5', 'Melbourne',
        'Victoria', '3000', 'Australia', '+61 3 9000 0000',
        'https://example.com.au', '', '12 345 678 901', 'Tier 1 head contractor',
    ]);
    exampleRow.eachCell({ includeEmpty: true }, (cell, n) => {
        if (n <= cols) {
            cell.font = FONT_REQUIRED;
            cell.alignment = ALIGN_WRAP;
            cell.border = BORDER_THIN;
        }
    });

    for (let i = 0; i < 60; i++) {
        const row = ws.addRow(headers.map(() => ''));
        styleDataRow(row, cols);
    }

    ws.views = [{ state: 'frozen', ySplit: 7, activeCell: 'A8' }];
}

// ============================================================
// Build workbook
// ============================================================
async function buildTemplate() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PTP Group';
    wb.created = new Date();

    buildSetupChecklist(wb);
    buildInstructions(wb);
    buildFolders(wb);
    buildPermissions(wb);
    buildIssues(wb);
    buildReviews(wb);
    buildReference(wb);
    buildRoles(wb);
    buildCompanies(wb);

    // Named ranges (defined after all sheets exist).
    // PermissionLevels and IssueStatuses live on the Reference sheet.
    // Roles points at the Roles sheet column A so the dropdown extends as users add custom roles.
    wb.definedNames.add("'Reference'!$C$3:$C$32", 'PermissionLevels');
    wb.definedNames.add("'Reference'!$E$3:$E$32", 'IssueStatuses');
    wb.definedNames.add("'Roles'!$A$7:$A$106", 'Roles');

    await wb.xlsx.writeFile(outputPath);
    console.log(`Client template created: ${outputPath}`);
}

buildTemplate().catch(err => {
    console.error('Failed to create template:', err);
    process.exit(1);
});
