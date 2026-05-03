#!/usr/bin/env node

import fs from 'node:fs';

const stagingPath = process.env.STAGING_DOC_PATH || 'docs/STAGING.md';
const maxAgeDays = Number(process.env.STAGING_MAX_AGE_DAYS || '14');

function fail(message) {
  console.error(`staging-doc-check: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(stagingPath)) {
  fail(`missing required file: ${stagingPath}`);
}

const content = fs.readFileSync(stagingPath, 'utf8');

if (!content.includes('# STAGING')) {
  fail('missing STAGING title header (# STAGING)');
}

if (!content.includes('## 7. Session Handoff Log (Update Before Exit)')) {
  fail('missing required handoff section');
}

const dateMatch = content.match(/^Date:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
if (!dateMatch) {
  fail('missing Date: YYYY-MM-DD line');
}

const dateText = dateMatch[1];
const parsed = new Date(`${dateText}T00:00:00Z`);
if (Number.isNaN(parsed.getTime())) {
  fail(`invalid Date value: ${dateText}`);
}

const now = new Date();
const ageMs = now.getTime() - parsed.getTime();
const ageDays = ageMs / (24 * 60 * 60 * 1000);

if (ageDays > maxAgeDays) {
  fail(
    `staging doc is stale (${ageDays.toFixed(1)} days old). ` +
      `Update Date to within ${maxAgeDays} days.`
  );
}

console.log(
  `staging-doc-check: ok (${stagingPath}, date=${dateText}, ageDays=${ageDays.toFixed(1)}, max=${maxAgeDays})`
);
