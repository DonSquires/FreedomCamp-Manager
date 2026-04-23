#!/usr/bin/env node
// Quick script to consult Bob from CLI

import process from 'node:process';
import { consultBob } from './agent-bob-bridge.mjs';

const question = process.argv[2] || 'What is your operational status?';
console.log(`[Agent] Asking Bob: "${question}"\n`);

consultBob(question)
  .then(answer => {
    console.log(`[Bob] ${answer}\n`);
    process.exit(0);
  })
  .catch(err => {
    console.error(`[Error] ${err.message}\n`);
    process.exit(1);
  });
