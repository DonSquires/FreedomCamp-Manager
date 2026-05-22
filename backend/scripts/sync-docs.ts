import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

type DocumentationSeed = {
  filePath: string;
  intentKeywords: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  allowedAgents: string[];
};

const DOCUMENTATION_SEEDS: DocumentationSeed[] = [
  {
    filePath: 'docs/STAGING.md',
    intentKeywords: [
      'staging',
      'build',
      'deploy',
      'workflow',
      'ci',
      'migration',
      'validation',
      'railway',
      'runpod',
    ],
    priority: 'high',
    allowedAgents: ['dr_bob', 'bob'],
  },
  {
    filePath: 'docs/INSTRUCTION_MANUAL.md',
    intentKeywords: [
      'instruction',
      'manual',
      'policy',
      'role',
      'governance',
      'training',
      'compliance',
      'workflow',
    ],
    priority: 'critical',
    allowedAgents: ['dr_bob', 'bob', 'emulator'],
  },
  {
    filePath: 'docs/SELF_HEAL_ENTERPRISE_RUNBOOK.md',
    intentKeywords: [
      'self-heal',
      'incident',
      'recovery',
      'patch',
      'approval',
      'fallback',
      'automation',
    ],
    priority: 'high',
    allowedAgents: ['dr_bob', 'bob', 'emulator'],
  },
  {
    filePath: 'ops/EDGE_FUNCTIONS_RUNBOOK.md',
    intentKeywords: [
      'edge',
      'function',
      'supabase',
      'secrets',
      'deploy',
      'health',
      'cors',
    ],
    priority: 'high',
    allowedAgents: ['dr_bob', 'bob'],
  },
  {
    filePath: 'docs/RAILWAY_DEPLOYMENT_GUIDE.md',
    intentKeywords: [
      'railway',
      'deploy',
      'service',
      'container',
      'environment',
      'variable',
      'healthcheck',
    ],
    priority: 'medium',
    allowedAgents: ['dr_bob', 'bob'],
  },
  {
    filePath: 'docs/AI_PATCH_RUNBOOKS.md',
    intentKeywords: [
      'triage',
      'pool',
      'eas',
      'error',
      'debugging',
      'patch',
      'runbook',
    ],
    priority: 'high',
    allowedAgents: ['dr_bob', 'bob', 'emulator'],
  },
  {
    filePath: 'docs/BOB_CODESPACE_AI_MODE.md',
    intentKeywords: [
      'codespace',
      'agentic',
      'workflow',
      'verification',
      'triage',
      'patch',
      'grounding',
    ],
    priority: 'critical',
    allowedAgents: ['dr_bob', 'bob', 'emulator'],
  },
];

const docsBucketName = process.env.SYSTEM_DOCS_BUCKET ?? 'bob-tier-b-docs';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const supabaseUrl =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  (process.env.SUPABASE_PROJECT_REF
    ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`
    : undefined);

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL or SUPABASE_PROJECT_REF)');
}

const supabaseServiceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

async function ensureDocsBucket(bucketName: string): Promise<void> {
  const listResult = await supabase.storage.listBuckets();
  if (listResult.error) {
    console.warn(`Unable to list buckets: ${listResult.error.message}`);
    return;
  }

  const exists = (listResult.data ?? []).some((bucket) => bucket.name === bucketName);
  if (exists) {
    return;
  }

  const createResult = await supabase.storage.createBucket(bucketName, {
    public: false,
    fileSizeLimit: 10485760,
  });

  if (createResult.error) {
    console.warn(`Unable to create docs bucket ${bucketName}: ${createResult.error.message}`);
    return;
  }

  console.log(`Created docs bucket: ${bucketName}`);
}

async function main(): Promise<void> {
  await ensureDocsBucket(docsBucketName);

  const rows: Array<Record<string, unknown>> = [];

  for (const doc of DOCUMENTATION_SEEDS) {
    const absolutePath = path.resolve(repoRoot, doc.filePath);
    const content = await readFile(absolutePath, 'utf8');
    const objectPath = `tier-b/${doc.filePath}`;

    // Optional bucket mirror for operational retrieval paths.
    const uploadResult = await supabase.storage
      .from(docsBucketName)
      .upload(objectPath, content, {
        upsert: true,
        contentType: 'text/markdown; charset=utf-8',
      });

    if (uploadResult.error) {
      console.warn(`Bucket upload skipped for ${doc.filePath}: ${uploadResult.error.message}`);
    }

    rows.push({
      file_path: doc.filePath,
      content,
      storage_object_path: uploadResult.error ? null : objectPath,
      intent_keywords: doc.intentKeywords,
      priority: doc.priority,
      allowed_agents: doc.allowedAgents,
      updated_at: new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from('system_documentation_library')
    .upsert(rows, { onConflict: 'file_path' });

  if (error) {
    throw error;
  }

  console.log(`Documentation sync complete (${rows.length} files)`);
  for (const row of rows) {
    console.log(`- ${row.file_path}`);
  }
}

main().catch((error) => {
  console.error('Documentation sync failed:', error);
  process.exitCode = 1;
});
