#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function safeParseJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseTaskContext(rawContext) {
  if (typeof rawContext !== 'string' || !rawContext.trim()) return {};
  try {
    const parsed = JSON.parse(rawContext);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseCommandAllowlist() {
  const raw = String(process.env.BOB_INTERNAL_EXECUTOR_TASK_COMMAND_ALLOWLIST || 'node,bun,npm').trim();
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isPathWithin(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function commandExists(command) {
  const check = spawnSync('which', [command], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return check.status === 0;
}

function inferProjectRefFromSupabaseUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';

  const match = value.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
  if (!match) return '';

  return String(match[1] || '').trim();
}

function collectLocalSchemaSnapshot(repoRoot) {
  const typesPath = path.join(repoRoot, 'src', 'types', 'database.ts');
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

  let tableNames = [];
  if (fs.existsSync(typesPath)) {
    const rawTypes = fs.readFileSync(typesPath, 'utf8');
    const tableRegex = /\b([A-Za-z0-9_]+):\s*\{\s*Row:\s*\{/g;
    const names = new Set();
    let match;
    while ((match = tableRegex.exec(rawTypes)) !== null) {
      const name = String(match[1] || '').trim();
      if (name && name !== 'Tables' && name !== 'Views') names.add(name);
    }
    tableNames = [...names].sort();
  }

  let migrations = [];
  if (fs.existsSync(migrationsDir)) {
    migrations = fs
      .readdirSync(migrationsDir)
      .filter((entry) => entry.endsWith('.sql'))
      .sort();
  }

  return {
    source: 'local-repo',
    types_path: path.relative(repoRoot, typesPath),
    migration_dir: path.relative(repoRoot, migrationsDir),
    table_count: tableNames.length,
    sample_tables: tableNames.slice(0, 50),
    migration_count: migrations.length,
    latest_migrations: migrations.slice(-10),
  };
}

function runSchemaPreflight(task, dryRun) {
  const parsedContext = parseTaskContext(task?.context);
  const taskType = String(parsedContext?.task_type || '').trim();
  const shouldRun = parsedContext?.schema_sync_before_test === true || taskType === 'human_test_run';
  if (!shouldRun) {
    return {
      ran: false,
      reason: 'Schema preflight not requested for this task',
    };
  }

  const repoRoot = process.cwd();
  const outputDir = path.resolve(path.join(repoRoot, 'data', 'internal-code-executor'));
  ensureDir(outputDir);

  const projectRef = String(
    process.env.SUPABASE_PROJECT_REF
      || process.env.VITE_SUPABASE_PROJECT_REF
      || inferProjectRefFromSupabaseUrl(process.env.SUPABASE_URL)
      || inferProjectRefFromSupabaseUrl(process.env.VITE_SUPABASE_URL)
      || '',
  ).trim();
  const hasAccessToken = Boolean(String(process.env.SUPABASE_ACCESS_TOKEN || '').trim());
  const supabaseInstalled = commandExists('supabase');
  const canPullRemote = Boolean(projectRef && hasAccessToken && supabaseInstalled);

  const startedAt = Date.now();
  let remote = {
    attempted: false,
    succeeded: false,
    reason: '',
    output_path: null,
    stderr_tail: '',
  };

  if (canPullRemote && !dryRun) {
    const remoteOutputPath = path.join(outputDir, `schema-remote-${String(task?.short_id || 'unknown')}.d.ts`);
    const pullArgs = ['gen', 'types', 'typescript', '--project-id', projectRef, '--schema', 'public'];
    const result = spawnSync('supabase', pullArgs, {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 4,
    });

    if (result.status === 0 && String(result.stdout || '').trim()) {
      fs.writeFileSync(remoteOutputPath, String(result.stdout));
      remote = {
        attempted: true,
        succeeded: true,
        reason: '',
        output_path: path.relative(repoRoot, remoteOutputPath),
        stderr_tail: String(result.stderr || '').slice(-2000),
      };
    } else {
      remote = {
        attempted: true,
        succeeded: false,
        reason: result.signal ? `terminated (${result.signal})` : `exit_code=${result.status ?? 1}`,
        output_path: null,
        stderr_tail: `${String(result.stderr || '').slice(-2000)}${String(result.stdout || '').slice(-1000)}`,
      };
    }
  } else {
    const reasons = [];
    if (dryRun) reasons.push('dry-run enabled');
    if (!projectRef) reasons.push('SUPABASE_PROJECT_REF not set');
    if (!hasAccessToken) reasons.push('SUPABASE_ACCESS_TOKEN not set');
    if (!supabaseInstalled) reasons.push('supabase CLI not installed');
    remote.reason = reasons.join(', ') || 'remote pull prerequisites not met';
  }

  const localSnapshot = collectLocalSchemaSnapshot(repoRoot);
  const localSnapshotPath = path.join(outputDir, `schema-local-${String(task?.short_id || 'unknown')}.json`);
  fs.writeFileSync(localSnapshotPath, `${JSON.stringify(localSnapshot, null, 2)}\n`);

  return {
    ran: true,
    duration_ms: Date.now() - startedAt,
    remote,
    local_snapshot_path: path.relative(repoRoot, localSnapshotPath),
    local: localSnapshot,
    ok: remote.succeeded || localSnapshot.table_count > 0 || localSnapshot.migration_count > 0,
  };
}

function runExecutorRequest(task, dryRun) {
  const parsedContext = parseTaskContext(task?.context);
  const request = parsedContext?.executor_request;
  if (!request || typeof request !== 'object') {
    return { ran: false, reason: 'No executor_request in task context' };
  }

  const command = String(request.command || '').trim();
  if (!command) {
    throw new Error('executor_request.command is required');
  }

  const commandBase = path.basename(command).toLowerCase();
  const allowlist = parseCommandAllowlist();
  if (!allowlist.includes(command.toLowerCase()) && !allowlist.includes(commandBase)) {
    throw new Error(`executor_request.command is not allowlisted: ${command}`);
  }

  const args = Array.isArray(request.args) ? request.args.map((item) => String(item)) : [];
  const repoRoot = process.cwd();
  const requestedCwd = String(request.cwd || '.');
  const cwd = path.resolve(path.join(repoRoot, requestedCwd));
  if (!isPathWithin(repoRoot, cwd)) {
    throw new Error(`executor_request cwd is outside repository: ${requestedCwd}`);
  }

  const timeoutMsRaw = Number(request.timeout_ms);
  const timeoutMs = Number.isFinite(timeoutMsRaw)
    ? Math.max(10_000, Math.min(300_000, Math.floor(timeoutMsRaw)))
    : 180_000;

  const allowInDryRun = request.allow_in_dry_run === true;
  if (dryRun && !allowInDryRun) {
    return {
      ran: false,
      skipped: true,
      reason: 'Dry-run enabled and executor_request.allow_in_dry_run is false',
      command,
      args,
      cwd: path.relative(repoRoot, cwd) || '.',
    };
  }

  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });

  return {
    ran: true,
    command,
    args,
    cwd: path.relative(repoRoot, cwd) || '.',
    timeout_ms: timeoutMs,
    duration_ms: Date.now() - startedAt,
    exit_code: typeof result.status === 'number' ? result.status : 1,
    timed_out: result.signal === 'SIGTERM',
    stdout_tail: String(result.stdout || '').slice(-4000),
    stderr_tail: String(result.stderr || '').slice(-4000),
    ok: (result.status ?? 1) === 0,
  };
}

function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    throw new Error('Payload path argument is required');
  }

  const payload = safeParseJson(payloadPath);
  const task = payload?.task;
  if (!task || typeof task !== 'object') {
    throw new Error('Invalid payload: missing task object');
  }

  const dryRun = toBoolean(process.env.BOB_INTERNAL_CODE_TASK_EXECUTOR_DRY_RUN, true);
  const shortId = String(task.short_id || task.id || 'unknown').slice(0, 20);
  const outputDir = path.resolve(path.join(process.cwd(), 'data', 'internal-code-executor'));
  ensureDir(outputDir);

  const audit = {
    version: 1,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    task_id: task.id,
    short_id: task.short_id,
    task: task.task,
    context: task.context,
    target_files: Array.isArray(task.target_files) ? task.target_files : [],
    actor: payload?.actor || null,
    requested_at: payload?.requested_at || null,
    notes: dryRun
      ? ['Dry-run mode enabled: no repository files were modified.']
      : ['Executor performed a minimal internal record write.'],
  };

  let schemaPreflightResult = null;
  try {
    schemaPreflightResult = runSchemaPreflight(task, dryRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    schemaPreflightResult = {
      ran: true,
      ok: false,
      error: message,
    };
  }

  audit.schema_preflight = schemaPreflightResult;

  let executorCommandResult = null;
  try {
    executorCommandResult = runExecutorRequest(task, dryRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    executorCommandResult = {
      ran: true,
      ok: false,
      error: message,
    };
  }

  audit.executor_command = executorCommandResult;

  const auditPath = path.join(outputDir, `${shortId}.json`);
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);

  const schemaSyncRequired = parseTaskContext(task?.context)?.schema_sync_required === true;
  const schemaOk = !schemaPreflightResult || schemaPreflightResult.ok !== false;
  const commandSuccess = (!executorCommandResult || executorCommandResult.ok !== false)
    && (!schemaSyncRequired || schemaOk);

  const result = {
    success: commandSuccess,
    mode: dryRun ? 'dry-run' : 'apply',
    branch: String(task.branch || `bob/task-${shortId}`),
    pr_url: dryRun
      ? `internal://dry-run/${shortId}`
      : `internal://applied/${shortId}`,
    build_passed: commandSuccess,
    files_changed: [path.relative(process.cwd(), auditPath)],
    executor_command: executorCommandResult,
    schema_preflight: schemaPreflightResult,
    executor_summary: dryRun
      ? 'Dry-run completed successfully; no code files were changed.'
      : 'Applied mode completed with internal audit artifact update.',
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`internal-code-executor error: ${message}\n`);
  process.stdout.write(`${JSON.stringify({ success: false, error: message })}\n`);
  process.exit(1);
}
