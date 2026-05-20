#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();

function safeReadOsName() {
  const osRelease = path.join('/', 'etc', 'os-release');
  try {
    const content = fs.readFileSync(osRelease, 'utf8');
    const pretty = content.split(/\r?\n/).find((line) => line.startsWith('PRETTY_NAME='));
    if (!pretty) return `${os.type()} ${os.release()}`;
    return pretty.split('=')[1].replace(/^"|"$/g, '');
  } catch {
    return `${os.type()} ${os.release()}`;
  }
}

function safeVersion(cmd) {
  try {
    return String(execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim() || 'not installed';
  } catch {
    return 'not installed';
  }
}

function readModules() {
  const modulesDir = path.join(root, 'src', 'modules');
  try {
    return fs
      .readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function readLockfiles() {
  const candidates = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
  return candidates.filter((name) => fs.existsSync(path.join(root, name)));
}

const systemState = {
  os: safeReadOsName(),
  node_version: process.version || 'not installed',
  npm_version: safeVersion('npm -v'),
  modules: readModules(),
  lockfiles: readLockfiles(),
  generated_at: new Date().toISOString(),
  source: 'scripts/system-check.mjs',
};

fs.writeFileSync(path.join(root, 'system_state.json'), `${JSON.stringify(systemState, null, 2)}\n`);
console.log('System state captured in system_state.json');
