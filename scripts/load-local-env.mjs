import fs from 'node:fs';
import path from 'node:path';

let dotenv = null;

try {
  ({ default: dotenv } = await import('dotenv'));
} catch {
  dotenv = null;
}

let loaded = false;

function applyEnvFile(filePath, override) {
  if (dotenv) {
    dotenv.config({ path: filePath, override });
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!override && Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = value;
  }
}

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const root = process.cwd();
  const baseCandidates = ['.env', '.env.local', '.env.playwright.local'];

  for (const rel of baseCandidates) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) continue;
    applyEnvFile(filePath, false);
  }

  // Runtime-injected credentials should win over inherited empty env values.
  const runtimePath = path.join(root, '.runtime/bob.env');
  if (fs.existsSync(runtimePath)) {
    applyEnvFile(runtimePath, true);
  }
}
