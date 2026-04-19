import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const root = process.cwd();
  const candidates = [
    '.env',
    '.env.local',
    '.env.playwright.local',
    '.runtime/bob.env',
  ];

  for (const rel of candidates) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) continue;
    dotenv.config({ path: filePath, override: false });
  }
}
