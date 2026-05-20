#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { BobSession } from './agent-bob-bridge.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

const repoRoot = process.cwd();

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listScriptFiles(dirPath) {
  try {
    return fs
      .readdirSync(dirPath)
      .filter((name) => /\.(mjs|js|sh)$/i.test(name))
      .sort();
  } catch {
    return [];
  }
}

function detectCommandAvailability(commands) {
  const available = [];
  for (const cmd of commands) {
    const result = spawnSync('sh', ['-lc', `command -v ${cmd}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0) {
      available.push(cmd);
    }
  }
  return available;
}

function chunkLines(lines, maxChars = 5500) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = line;
      continue;
    }
    current = next;
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildGrantPackets() {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const packageJson = readJsonSafe(packageJsonPath) || {};
  const scripts = packageJson.scripts || {};
  const scriptEntries = Object.keys(scripts)
    .sort()
    .map((name) => `${name}: ${String(scripts[name]).slice(0, 220)}`);

  const scriptFiles = listScriptFiles(path.join(repoRoot, 'scripts'));

  const cliCandidates = [
    'node',
    'npm',
    'git',
    'playwright',
    'vite',
    'supabase',
    'curl',
    'wget',
    'jq',
    'sqlite3',
    'psql',
    'docker',
    'python3',
    'bash',
    'sh',
  ];
  const availableCli = detectCommandAvailability(cliCandidates);

  const packetA = [
    'TOOL_GRANT_PACKET_A',
    'Grant mode: FULL',
    'Instruction: Assume all listed repo tools and scripts are available for planning and execution suggestions.',
    'Constraint: Respect role/permission boundaries and environment availability checks.',
    '',
    'Available CLI commands:',
    ...availableCli.map((cmd) => `- ${cmd}`),
    '',
    'Top-level intent:',
    '- End-to-end module execution from login through operational workflows, triage, and remediation.',
  ];

  const packetB = [
    'TOOL_GRANT_PACKET_B',
    'Repository script inventory (package.json scripts):',
    ...scriptEntries.map((entry) => `- ${entry}`),
  ];

  const packetC = [
    'TOOL_GRANT_PACKET_C',
    'Repository executable script files (scripts/):',
    ...scriptFiles.map((name) => `- scripts/${name}`),
    '',
    'Execution directive:',
    '- Prefer existing scripts before proposing new orchestration.',
    '- Treat MotorWeb as optional/offline-capable where integration is not configured.',
    '- Prioritize fail-fast root-cause isolation, then full-suite reruns.',
  ];

  const packets = [packetA.join('\n')];
  packets.push(...chunkLines(packetB));
  packets.push(...chunkLines(packetC));
  return packets;
}

async function main() {
  const packets = buildGrantPackets();
  const session = new BobSession({
    context: {
      toolGrantMode: 'full',
      source: 'scripts/bob-grant-all-tools.mjs',
      timestamp: new Date().toISOString(),
    },
  });

  console.log(`Granting Bob full tooling context using ${packets.length} packets...`);

  for (let i = 0; i < packets.length; i += 1) {
    const packet = packets[i];
    const response = await session.exchange(packet);
    console.log(`Packet ${i + 1}/${packets.length} acknowledged.`);
    console.log(`Bob: ${String(response).slice(0, 220)}${String(response).length > 220 ? '...' : ''}`);
  }

  const finalResponse = await session.exchange(
    'Confirm you have received the FULL tool grant packets and will use all available tools/scripts for this repo when asked.'
  );

  console.log('Bob final confirmation:');
  console.log(String(finalResponse).slice(0, 500));
}

main().catch((error) => {
  console.error(`Failed to grant tools to Bob: ${error?.message || String(error)}`);
  process.exit(1);
});
