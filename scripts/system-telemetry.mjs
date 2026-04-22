#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

function envFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function parsePairs(raw) {
  return String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, ...rest] = entry.split('=');
      const value = rest.join('=').trim();
      return value ? { name: name.trim(), value } : { name: 'service', value: name.trim() };
    })
    .filter((entry) => entry.value);
}

function getLogPath() {
  return path.resolve(process.cwd(), process.env.SYSTEM_TELEMETRY_LOG_PATH || 'system_telemetry.log');
}

function getHealthSnapshotPath() {
  return path.resolve(process.cwd(), process.env.BOB_TEST_HEALTH_SNAPSHOT_PATH || 'tools/system-health.json');
}

function appendLog(record) {
  const logPath = getLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}

function resolveHealthEndpoints() {
  const configured = process.env.SYSTEM_TELEMETRY_HEALTH_ENDPOINTS || process.env.BOB_TEST_HEALTH_ENDPOINTS || '';
  return parsePairs(configured).map((entry) => ({ name: entry.name, url: entry.value }));
}

function resolveCommands() {
  return parsePairs(process.env.SYSTEM_TELEMETRY_COMMANDS || '');
}

function classifyStatus(responseStatus, payloadStatus) {
  const value = String(payloadStatus || '').toLowerCase();
  if (responseStatus >= 400) return 'offline';
  if (['healthy', 'ok', 'online', 'operational', 'ready', 'up'].includes(value)) return 'online';
  if (['degraded', 'warning', 'partial'].includes(value)) return 'degraded';
  return 'online';
}

async function pollHealth() {
  const endpoints = resolveHealthEndpoints();
  const snapshot = {
    checkedAt: new Date().toISOString(),
    overall: 'online',
    services: [],
    summary: {},
  };

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { headers: { Accept: 'application/json' } });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const status = classifyStatus(response.status, payload?.status);
      snapshot.services.push({
        name: endpoint.name,
        url: endpoint.url,
        status,
        httpStatus: response.status,
        reportedStatus: payload?.status || null,
      });
      snapshot.summary[endpoint.name] = status;
    } catch (error) {
      snapshot.services.push({
        name: endpoint.name,
        url: endpoint.url,
        status: 'offline',
        httpStatus: null,
        reportedStatus: null,
        error: String(error?.message || error),
      });
      snapshot.summary[endpoint.name] = 'offline';
    }
  }

  if (snapshot.services.some((service) => service.status === 'offline')) {
    snapshot.overall = 'offline';
  } else if (snapshot.services.some((service) => service.status === 'degraded')) {
    snapshot.overall = 'degraded';
  }

  const healthPath = getHealthSnapshotPath();
  fs.mkdirSync(path.dirname(healthPath), { recursive: true });
  fs.writeFileSync(healthPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  appendLog({ ts: snapshot.checkedAt, source: 'health', snapshot });
  return snapshot;
}

function streamCommand(name, command) {
  const child = spawn(command, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const wire = (stream, streamName) => {
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => {
      appendLog({ ts: new Date().toISOString(), source: name, stream: streamName, message: line });
    });
  };

  if (child.stdout) wire(child.stdout, 'stdout');
  if (child.stderr) wire(child.stderr, 'stderr');

  child.on('close', (code, signal) => {
    appendLog({
      ts: new Date().toISOString(),
      source: name,
      stream: 'lifecycle',
      message: `process exited`,
      exitCode: code,
      signal: signal || null,
    });
  });

  return child;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const healthOnly = args.has('--health-only');
  const once = args.has('--once');
  const intervalMs = Number(process.env.SYSTEM_TELEMETRY_HEALTH_INTERVAL_MS || 15000);

  appendLog({
    ts: new Date().toISOString(),
    source: 'telemetry',
    stream: 'lifecycle',
    message: 'telemetry session started',
    healthOnly,
    once,
  });

  await pollHealth();
  if (healthOnly && once) return;

  const children = healthOnly ? [] : resolveCommands().map((entry) => streamCommand(entry.name, entry.value));

  if (once) {
    for (const child of children) {
      child.kill('SIGTERM');
    }
    return;
  }

  const timer = setInterval(() => {
    void pollHealth();
  }, intervalMs);

  const shutdown = () => {
    clearInterval(timer);
    for (const child of children) {
      child.kill('SIGTERM');
    }
    appendLog({ ts: new Date().toISOString(), source: 'telemetry', stream: 'lifecycle', message: 'telemetry session stopped' });
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  appendLog({ ts: new Date().toISOString(), source: 'telemetry', stream: 'stderr', message: String(error?.message || error) });
  process.exit(1);
});
