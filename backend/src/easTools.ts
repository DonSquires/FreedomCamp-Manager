import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const CURRENT_FILE = fileURLToPath(import.meta.url);
const SRC_DIR = path.dirname(CURRENT_FILE);
const REPO_ROOT = path.resolve(SRC_DIR, '..', '..');
const MOBILE_APP_DIR = path.resolve(REPO_ROOT, 'mobile-app');
const EAS_BIN = (process.env.EAS_CLI_BIN ?? 'eas').trim();
const EAS_TIMEOUT_MS = Number(process.env.EAS_TIMEOUT_MS ?? 1000 * 60 * 30);

export type EasExecutionResult = {
  command: string;
  output: string;
  buildUrl: string | null;
  qrCodeUrl: string | null;
};

function normalizeOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join('\n').trim();
}

function extractBuildUrl(output: string): string | null {
  const match = output.match(/https:\/\/expo\.dev\/[^\s)"']+/i);
  return match ? match[0] : null;
}

function extractQrCodeUrl(output: string): string | null {
  const match = output.match(/https:\/\/qr\.expo\.dev\/[^\s)"']+/i);
  return match ? match[0] : null;
}

async function runEasCommand(args: string[]): Promise<EasExecutionResult> {
  try {
    const { stdout, stderr } = await execFileAsync(EAS_BIN, args, {
      cwd: MOBILE_APP_DIR,
      timeout: EAS_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        CI: process.env.CI ?? '1',
      },
    });

    const output = normalizeOutput(stdout, stderr);
    return {
      command: `${EAS_BIN} ${args.join(' ')}`,
      output,
      buildUrl: extractBuildUrl(output),
      qrCodeUrl: extractQrCodeUrl(output),
    };
  } catch (error) {
    const details = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      code?: number | string;
    };

    const output = normalizeOutput(details.stdout ?? '', details.stderr ?? '');
    const message = details.message ?? 'Unknown EAS execution error';
    const code = details.code !== undefined ? ` (code: ${String(details.code)})` : '';
    throw new Error(`EAS command failed${code}: ${message}\n${output}`.trim());
  }
}

export async function triggerPreviewApkBuild(): Promise<EasExecutionResult> {
  return runEasCommand(['build', '--platform', 'android', '--profile', 'preview', '--non-interactive']);
}

export async function triggerOtaHotfix(message: string): Promise<EasExecutionResult> {
  const trimmedMessage = String(message ?? '').trim();
  if (!trimmedMessage) {
    throw new Error('OTA message is required.');
  }

  return runEasCommand(['update', '--branch', 'production', '--message', trimmedMessage, '--non-interactive']);
}