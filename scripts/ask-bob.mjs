#!/usr/bin/env node
// Quick script to consult Bob from CLI

import process from 'node:process';
import { consultBob } from './agent-bob-bridge.mjs';

const args = process.argv.slice(2);
const useStorageGrounding = args.includes('--ground-storage');
const questionArg = args.filter((arg) => arg !== '--ground-storage').join(' ').trim();
const question = questionArg || 'What is your operational status?';

const STORAGE_GROUNDED_PREFIX = [
  'Grounding rules for this answer:',
  '- Respond in plain English.',
  '- Use only this confirmed storage bucket list: evidence, scans, notice-artifacts, incident-evidence, briefing-videos, reports, dispute-evidence.',
  '- If something is not verified, say "unsure" instead of guessing.',
  '- When relevant, suggest safe read/enrichment actions only (no destructive actions).',
  '',
  'User request:',
].join('\n');

const finalQuestion = useStorageGrounding
  ? `${STORAGE_GROUNDED_PREFIX}\n${question}`
  : question;

console.log(`[Agent] Asking Bob${useStorageGrounding ? ' [grounded-storage]' : ''}: "${question}"\n`);

consultBob(finalQuestion)
  .then(answer => {
    console.log(`[Bob] ${answer}\n`);
    process.exit(0);
  })
  .catch(err => {
    console.error(`[Error] ${err.message}\n`);
    process.exit(1);
  });
