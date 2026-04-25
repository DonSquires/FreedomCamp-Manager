#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_ACTIVITY_FILE = '.runtime/runpod-bob-activity.touch';

function getArg(name, fallback = '') {
  const key = `--${name}`;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (token === key) return String(args[index + 1] || fallback);
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback;
  }
  return fallback;
}

const activityFile = path.resolve(
  process.cwd(),
  String(getArg('file', process.env.BOB_SUPERVISOR_ACTIVITY_FILE || DEFAULT_ACTIVITY_FILE)).trim() || DEFAULT_ACTIVITY_FILE,
);

fs.mkdirSync(path.dirname(activityFile), { recursive: true });
fs.writeFileSync(activityFile, `${new Date().toISOString()}\n`);

console.log(JSON.stringify({
  touched: true,
  activityFile,
  touchedAt: new Date().toISOString(),
}, null, 2));