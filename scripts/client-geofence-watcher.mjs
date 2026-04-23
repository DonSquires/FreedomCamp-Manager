#!/usr/bin/env node
/**
 * Client Geofence Watcher
 * Automatically regenerates client registry when intake files change
 * Usage: node scripts/client-geofence-watcher.mjs [--verbose]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const CLIENTS_DIR = path.join(WORKSPACE_ROOT, 'docs', 'templates', 'clients');
const VERBOSE = process.argv.includes('--verbose');

// Debounce timer to prevent multiple rapid triggers
let debounceTimer = null;
const DEBOUNCE_MS = 500;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function runImporter() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    log('📂 File change detected, regenerating client registry...');
    
    const importer = spawn('node', [path.join(__dirname, 'import-client-geofences.mjs')], {
      cwd: WORKSPACE_ROOT,
      stdio: VERBOSE ? 'inherit' : 'pipe',
    });

    importer.on('close', (code) => {
      if (code === 0) {
        log('✅ Registry regenerated successfully');
      } else {
        log(`❌ Import failed with code ${code}`);
      }
    });

    if (!VERBOSE) {
      importer.stderr.on('data', (data) => {
        console.error(`[ERROR] ${data}`);
      });
    }
  }, DEBOUNCE_MS);
}

function startWatcher() {
  // Create clients dir if missing
  if (!fs.existsSync(CLIENTS_DIR)) {
    fs.mkdirSync(CLIENTS_DIR, { recursive: true });
  }

  log(`👁️  Watching for changes in: ${CLIENTS_DIR}`);
  log('Press Ctrl+C to stop');
  log('');

  const watcher = fs.watch(CLIENTS_DIR, { recursive: true, persistent: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.json')) {
      return;
    }

    // Skip schema and form files
    if (filename.includes('client-intake-form') || filename.includes('schema')) {
      return;
    }

    log(`🔄 ${eventType.toUpperCase()}: ${filename}`);
    runImporter();
  });

  watcher.on('error', (err) => {
    console.error(`Watcher error: ${err.message}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('⏹️  Shutting down watcher...');
    watcher.close();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWatcher();
}

export { startWatcher, runImporter };
