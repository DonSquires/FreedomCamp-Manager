import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const root = process.cwd();
  const baseCandidates = ['.env', '.env.local', '.env.playwright.local'];

  for (const rel of baseCandidates) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) continue;
    dotenv.config({ path: filePath, override: false });
  }

  // Runtime-injected credentials should win over inherited empty env values.
  const runtimePath = path.join(root, '.runtime/bob.env');
  if (fs.existsSync(runtimePath)) {
    dotenv.config({ path: runtimePath, override: true });
  }
}
