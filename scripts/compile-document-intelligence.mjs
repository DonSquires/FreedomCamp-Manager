#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini',
  '.csv', '.tsv', '.sql', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css',
  '.scss', '.html', '.htm', '.xml', '.svg', '.env', '.log',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic']);
const BINARY_DOC_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.rtf']);

const DEFAULT_INCLUDE_DIRS = ['docs', 'src', 'backend', 'supabase', 'data', 'public'];
const DEFAULT_IGNORE_DIRS = new Set([
  '.git', '.github', 'node_modules', 'dist', 'build', '.next', '.cache', '.turbo',
  '.venv', '.pytest_cache', 'coverage', 'tmp/docs/ocr-output', '.toolchains',
]);

const MAX_BYTES = Number(process.env.DOC_INTEL_MAX_BYTES ?? 2_000_000);
const MAX_PREVIEW = Number(process.env.DOC_INTEL_PREVIEW_CHARS ?? 1200);
const MAX_TEXT = Number(process.env.DOC_INTEL_TEXT_CHARS ?? 30_000);

function parseArgs(argv) {
  const args = {
    outDir: path.join(ROOT, 'data/internal-research'),
    appOutDir: path.join(ROOT, 'public/internal-research'),
    ocrDir: path.join(ROOT, 'tmp/docs/ocr-output'),
    includeDirs: [...DEFAULT_INCLUDE_DIRS],
    includePatterns: [],
    emitAppCopy: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (token === '--app-out-dir') args.appOutDir = path.resolve(argv[++i]);
    else if (token === '--ocr-dir') args.ocrDir = path.resolve(argv[++i]);
    else if (token === '--no-app-copy') args.emitAppCopy = false;
    else if (token === '--include-dir') args.includeDirs.push(argv[++i]);
    else if (token === '--include-pattern') args.includePatterns.push(argv[++i]);
  }

  args.includeDirs = Array.from(new Set(args.includeDirs.map((dir) => dir.trim()).filter(Boolean)));
  args.includePatterns = Array.from(new Set(args.includePatterns.map((pattern) => pattern.trim()).filter(Boolean)));
  return args;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function safeReadUtf8(buffer) {
  return buffer.toString('utf8').replace(/\u0000/g, '').trim();
}

function isIgnoredDir(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  return parts.some((part) => DEFAULT_IGNORE_DIRS.has(part));
}

function detectCategory(ext) {
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (BINARY_DOC_EXTENSIONS.has(ext)) return 'binary_document';
  return 'other';
}

async function walkFiles(dir, rootDir, results = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(rootDir, abs).split(path.sep).join('/');
    if (isIgnoredDir(rel)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkFiles(abs, rootDir, results);
      continue;
    }

    results.push({ abs, rel });
  }

  return results;
}

async function loadOcrIndex(ocrDir) {
  const index = new Map();
  try {
    const ocrFolders = await fs.readdir(ocrDir, { withFileTypes: true });
    for (const folder of ocrFolders) {
      if (!folder.isDirectory()) continue;
      const ocrTextPath = path.join(ocrDir, folder.name, 'ocr.txt');
      try {
        const ocrText = await fs.readFile(ocrTextPath, 'utf8');
        if (ocrText.trim()) {
          index.set(folder.name.toLowerCase(), ocrText.trim());
        }
      } catch {
        // ignore missing OCR sidecars
      }
    }
  } catch {
    // optional directory
  }
  return index;
}

function getKeywordCandidates(text) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 4);
}

function topKeywords(text, limit = 12) {
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'were', 'there', 'their', 'about', 'which', 'into', 'will',
    'your', 'when', 'what', 'where', 'while', 'http', 'https', 'would', 'could', 'should', 'also', 'than',
    'then', 'them', 'they', 'does', 'dont', 'were', 'been', 'able', 'across', 'using', 'used', 'only',
  ]);
  const counts = new Map();
  for (const token of getKeywordCandidates(text)) {
    if (stopWords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, score]) => ({ keyword, score }));
}

function compileTopicTags(text) {
  const lower = text.toLowerCase();
  const tags = [];
  if (/(supabase|postgres|migration|rls|row level security)/.test(lower)) tags.push('database');
  if (/(railway|docker|deploy|kubernetes|container)/.test(lower)) tags.push('deployment');
  if (/(react|vite|tailwind|ui|ux|component)/.test(lower)) tags.push('frontend');
  if (/(edge function|api|endpoint|express|server)/.test(lower)) tags.push('backend');
  if (/(runpod|ollama|model|inference|llm|agent)/.test(lower)) tags.push('ai');
  if (/(policy|governance|compliance|runbook|instruction)/.test(lower)) tags.push('governance');
  if (/(photo|image|ocr|evidence)/.test(lower)) tags.push('media');
  return tags;
}

function buildSummaryReport(indexRows, generatedAt) {
  const total = indexRows.length;
  const byCategory = indexRows.reduce((acc, row) => {
    acc[row.category] = (acc[row.category] ?? 0) + 1;
    return acc;
  }, {});

  const mergedKeywordCounts = new Map();
  for (const row of indexRows) {
    for (const kw of row.keywords) {
      mergedKeywordCounts.set(kw.keyword, (mergedKeywordCounts.get(kw.keyword) ?? 0) + kw.score);
    }
  }

  const topKeywordsRows = Array.from(mergedKeywordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);

  const lines = [
    '# Document Intelligence Summary',
    '',
    `Generated: ${generatedAt}`,
    `Indexed documents: ${total}`,
    '',
    '## Category Breakdown',
    ...Object.entries(byCategory)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([category, count]) => `- ${category}: ${count}`),
    '',
    '## Top Keywords',
    ...topKeywordsRows.map(([keyword, score]) => `- ${keyword}: ${score}`),
  ];

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const ocrIndex = await loadOcrIndex(args.ocrDir);

  const includeAbs = args.includeDirs
    .map((dir) => path.resolve(ROOT, dir))
    .filter(Boolean);

  const fileCandidates = [];
  for (const includeDir of includeAbs) {
    try {
      const stat = await fs.stat(includeDir);
      if (!stat.isDirectory()) continue;
      const files = await walkFiles(includeDir, ROOT, []);
      fileCandidates.push(...files);
    } catch {
      // ignore absent include dirs
    }
  }

  const uniqueByPath = new Map();
  for (const file of fileCandidates) {
    uniqueByPath.set(file.rel, file);
  }

  const rows = [];

  for (const file of uniqueByPath.values()) {
    const ext = path.extname(file.rel).toLowerCase();
    const category = detectCategory(ext);

    let stat;
    try {
      stat = await fs.stat(file.abs);
    } catch {
      continue;
    }

    if (!stat.isFile()) continue;
    if (stat.size > MAX_BYTES) {
      rows.push({
        path: file.rel,
        ext,
        category,
        bytes: stat.size,
        textSource: 'skipped_large_file',
        text: '',
        textPreview: '',
        textChars: 0,
        sha256: '',
        keywords: [],
        topicTags: [],
      });
      continue;
    }

    let buffer;
    try {
      buffer = await fs.readFile(file.abs);
    } catch {
      continue;
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    let text = '';
    let textSource = 'none';

    if (category === 'text') {
      text = safeReadUtf8(buffer);
      textSource = 'native_text';
    } else if (category === 'image' || category === 'binary_document') {
      const relLower = file.rel.toLowerCase();
      const ocrMatch = Array.from(ocrIndex.entries()).find(([key]) => key.includes(path.basename(relLower, ext).toLowerCase()));
      if (ocrMatch) {
        text = ocrMatch[1];
        textSource = 'ocr_sidecar';
      } else {
        text = `Binary asset indexed without inline text extraction: ${file.rel}`;
        textSource = 'binary_metadata';
      }
    } else {
      text = `Indexed file type without parser: ${file.rel}`;
      textSource = 'metadata_only';
    }

    text = truncateText(text, MAX_TEXT);
    const keywords = topKeywords(text);
    const topicTags = compileTopicTags(text);

    rows.push({
      path: file.rel,
      ext,
      category,
      bytes: stat.size,
      textSource,
      text,
      textPreview: text.slice(0, MAX_PREVIEW),
      textChars: text.length,
      sha256,
      keywords,
      topicTags,
      indexedAt: new Date().toISOString(),
    });
  }

  rows.sort((a, b) => a.path.localeCompare(b.path));

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    source: 'compile-document-intelligence',
    includeDirs: args.includeDirs,
    ocrDir: args.ocrDir,
    totalDocuments: rows.length,
    documents: rows,
  };

  await fs.mkdir(args.outDir, { recursive: true });
  const outJson = path.join(args.outDir, 'document-intelligence-index.json');
  const outMd = path.join(args.outDir, 'document-intelligence-summary.md');
  await fs.writeFile(outJson, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(outMd, buildSummaryReport(rows, generatedAt), 'utf8');

  if (args.emitAppCopy) {
    await fs.mkdir(args.appOutDir, { recursive: true });
    await fs.writeFile(path.join(args.appOutDir, 'document-intelligence-index.json'), JSON.stringify(payload, null, 2), 'utf8');
    await fs.writeFile(path.join(args.appOutDir, 'document-intelligence-summary.md'), buildSummaryReport(rows, generatedAt), 'utf8');
  }

  console.log(`Indexed documents: ${rows.length}`);
  console.log(`JSON output: ${outJson}`);
  console.log(`Summary output: ${outMd}`);
}

function truncateText(text, max) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n[TRUNCATED]`;
}

main().catch((error) => {
  console.error('compile-document-intelligence failed:', error);
  process.exit(1);
});
