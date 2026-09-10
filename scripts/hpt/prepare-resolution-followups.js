'use strict';
// Produce review material only. This script never sends outreach.
const fs = require('fs');
const path = require('path');
const { csvToObjects, toCSV } = require('./lib/util');
const dir = path.resolve(__dirname, '../../data/hpt-audit/rechecks/2026-09-09/resolution');
const read = name => csvToObjects(fs.readFileSync(path.join(dir, name), 'utf8'));
const assessments = read('assessments.csv');
const original = new Map(csvToObjects(fs.readFileSync(path.join(dir, '../intervention-recheck.csv'), 'utf8')).map(r => [r.ccn, r]));
const actions = {
  'identity-or-format-review': ['Identity / parser review', 'Compare the file header with roster name, address and license state. Inspect archive contents or metadata beyond the capped header if extraction is incomplete.'],
  'pointer-or-domain-review': ['Browser / official-domain review', 'Open the recorded pointer and official homepage in a browser. Follow the official pricing page; record redirects and exact response. Verify a replacement domain against first-party facility identity before assigning it.'],
  'metadata-or-pointer-review': ['Pointer / metadata review', 'Inspect the corroborated file and official pointer separately. Resolve missing or conflicting metadata and multiple file candidates before promoting.'],
  'identity-quarantined': ['Facility identity adjudication', 'The previous assignment is excluded. Resolve roster name/address or find an official pointer and file that corroborate this facility.'],
  'file-access-review': ['Browser file retrieval', 'Open the pointer-declared file in a browser. Record the final URL, status and download evidence. A failed automated request alone does not establish that the file is unavailable.'],
  'publisher-template-review': ['Publisher metadata review', 'Review the draft against the saved header and current CMS data dictionary; request the current file or clarification.'],
  'publisher-date-review': ['Publisher date review', 'Review the draft against the saved declared date; request the current file or clarification.']
};
const tasks = assessments.filter(r => r.status !== 'correction-verified').map(r => ({ ...r,
  recorded_pointer_url: original.get(r.ccn)?.pointer_url || '', recorded_mrf_url: original.get(r.ccn)?.mrf_url || '',
  queue: actions[r.status][0], next_action: actions[r.status][1],
  evidence_file: 'file-evidence.csv', evidence_key: r.ccn
}));
fs.writeFileSync(path.join(dir, 'followup-queue.csv'), toCSV(tasks, Object.keys(tasks[0])));
const publisher = assessments.filter(r => /^publisher-/.test(r.status));
const drafts = publisher.map(r => ({ ccn: r.ccn, hospital_name: r.hospital_name, send_status: 'draft-not-sent',
  subject: `Price transparency file clarification: ${r.hospital_name}`,
  body: `Hello,\n\nWe reviewed the pointer at ${r.pointer_url} and its linked file ${r.mrf_url} on ${r.checked_at}. The header identifies your facility and declares last_updated_on ${r.date} and template version ${r.version}. ${r.status === 'publisher-date-review' ? 'The declared date was more than 365 days before our check.' : 'The declared template version is older than the CMS v3.0 data dictionary used for this review.'}\n\nCould you confirm whether this is your current file and provide an updated official link or clarify the metadata? We checked the leading metadata only and have not validated every charge row.\n\nThank you.`
}));
fs.writeFileSync(path.join(dir, 'outreach-drafts.json'), JSON.stringify(drafts, null, 2) + '\n');
console.log(JSON.stringify({ followups: tasks.length, drafts: drafts.length }));
