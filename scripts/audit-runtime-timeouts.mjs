#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS = [
  { base: 'supabase/functions', ext: '.ts' },
  { base: 'supabase/migrations', ext: '.sql' },
];

const TIME_PATTERNS = [
  /\btimeout\b/i,
  /statement_timeout/i,
  /max_duration/i,
  /AbortSignal\.timeout/i,
  /executionTimeout/i,
  /setTimeout\s*\(/i,
];

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(abs));
    } else {
      out.push(abs);
    }
  }
  return out;
}

function isTargetFile(relPath) {
  return TARGETS.some(({ base, ext }) => relPath.startsWith(base + '/') && relPath.endsWith(ext));
}

function findMatches(lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (TIME_PATTERNS.some((re) => re.test(line))) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function toMarkdown(results) {
  const parts = [];
  parts.push('# Runtime Time Restriction Audit');
  parts.push('');
  parts.push(`Generated: ${new Date().toISOString()}`);
  parts.push('');
  parts.push(`Files with time restrictions: ${results.length}`);
  parts.push('');
  for (const row of results) {
    parts.push(`## ${row.file}`);
    parts.push('');
    for (const hit of row.hits) {
      parts.push(`- L${hit.line}: ${hit.text}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

async function main() {
  const allFiles = await walk(ROOT);
  const relFiles = allFiles
    .map((abs) => path.relative(ROOT, abs).split(path.sep).join('/'))
    .filter(isTargetFile);

  const results = [];
  for (const rel of relFiles) {
    const abs = path.join(ROOT, rel);
    const content = await fs.readFile(abs, 'utf8');
    const lines = content.split(/\r?\n/);
    const hits = findMatches(lines);
    if (hits.length > 0) {
      results.push({ file: rel, hits });
    }
  }

  const outDir = path.join(ROOT, 'tools/runtime-audit');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `time-restrictions-${stamp}.json`);
  const mdPath = path.join(outDir, `time-restrictions-${stamp}.md`);

  await fs.writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
  await fs.writeFile(mdPath, toMarkdown(results) + '\n');

  console.log(JSON.stringify({
    ok: true,
    filesScanned: relFiles.length,
    filesWithRestrictions: results.length,
    jsonPath: path.relative(ROOT, jsonPath),
    markdownPath: path.relative(ROOT, mdPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
