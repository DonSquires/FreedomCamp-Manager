import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  return JSON.parse(raw);
}

function usage() {
  console.log('Usage: node scripts/push-intel-bulletin.mjs --file <path> --url <endpoint> --api-key <key> [--hmac-key <key>] [--dry-run true]');
  console.log('');
  console.log('Env fallback:');
  console.log('  INTEL_INGEST_URL, INFERENCE_API_KEY, INTEL_HMAC_KEY');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help === 'true' || args.h === 'true') {
    usage();
  }

  const filePath = args.file || process.env.INTEL_BULLETIN_FILE;
  const url = args.url || process.env.INTEL_INGEST_URL;
  const apiKey = args['api-key'] || process.env.INFERENCE_API_KEY;
  const hmacKey = args['hmac-key'] || process.env.INTEL_HMAC_KEY || '';
  const dryRun = (args['dry-run'] || 'false').toLowerCase() === 'true';

  if (!filePath || !url || !apiKey) {
    usage();
  }

  const parsed = readJsonFile(filePath);
  const bulletin = parsed?.bulletin && typeof parsed.bulletin === 'object' ? parsed.bulletin : parsed;

  if (!bulletin || typeof bulletin !== 'object') {
    throw new Error('Input JSON must be either a bulletin object or {"bulletin": {...}}');
  }
  if (!String(bulletin.title || '').trim() || !String(bulletin.summary || '').trim()) {
    throw new Error('Bulletin requires non-empty title and summary');
  }

  const body = JSON.stringify({ bulletin });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (hmacKey) {
    const signature = crypto.createHmac('sha256', hmacKey).update(body).digest('hex');
    headers['x-intel-signature'] = signature;
  }

  if (dryRun) {
    console.log('Dry run enabled. Request not sent.');
    console.log(JSON.stringify({ url, headers: { ...headers, Authorization: 'Bearer ***' }, body: JSON.parse(body) }, null, 2));
    return;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Ingest failed (${response.status}): ${text}`);
  }

  console.log('Bulletin ingested successfully.');
  console.log(text);
}

main().catch((error) => {
  console.error('push-intel-bulletin failed:', error.message);
  process.exit(1);
});
