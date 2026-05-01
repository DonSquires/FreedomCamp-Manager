import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let dotenv = null;

try {
  const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const modulePath = cwdRequire.resolve('dotenv');
  ({ default: dotenv } = await import(modulePath));
} catch {
  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const scriptRequire = createRequire(path.join(scriptDir, 'package.json'));
    const modulePath = scriptRequire.resolve('dotenv');
    ({ default: dotenv } = await import(modulePath));
  } catch {
    dotenv = null;
  }
}

let loaded = false;

function firstNonEmptyEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function setEnvIfMissing(name, value) {
  if (!value) return;
  if (String(process.env[name] || '').trim()) return;
  process.env[name] = value;
}

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

  const translatorRuntimePath = path.join(root, '.runtime/translator.env');
  if (fs.existsSync(translatorRuntimePath)) {
    applyEnvFile(translatorRuntimePath, true);
  }

  const inferenceUrl = firstNonEmptyEnv([
    'INFERENCE_SERVICE_URL',
    'BOB_SERVICE_URL',
    'VITE_INFERENCE_SERVICE_URL',
  ]);

  setEnvIfMissing('INFERENCE_SERVICE_URL', inferenceUrl);
  setEnvIfMissing('BOB_SERVICE_URL', inferenceUrl);

  if (/runpod/i.test(inferenceUrl)) {
    setEnvIfMissing('RUNPOD_URL', inferenceUrl);
  }

  const supabaseServiceRole = firstNonEmptyEnv([
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  setEnvIfMissing('SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRole);

  const translatorTemplateId = firstNonEmptyEnv([
    'TRANSLATOR_TEMPLATE_ID',
    'RUNPOD_TRANSLATOR_TEMPLATE_ID',
  ]);
  setEnvIfMissing('TRANSLATOR_TEMPLATE_ID', translatorTemplateId);
  setEnvIfMissing('RUNPOD_TRANSLATOR_TEMPLATE_ID', translatorTemplateId);
}
