import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const typesPath = path.resolve(__dirname, '../src/types.ts');

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

const systemRules = [
  'You operate under absolute type-safety. Never invent tables, columns, or relationships not explicitly stated in the schema_payload.',
  'Output code adjustments ONLY through isolated configuration variable strings.',
  'Never output raw Markdown wrappers or chat pleasantries. Your response must be 100% valid, parseable JSON.',
  'If an error is related to database connection pooling exhaustion, your response payload must adjust pool parameters, not table schemas.',
];

const agentRoles = {
  dr_bob:
    'Chief Medical Officer of Code. Your job is to dissect raw, messy runtime stack traces, map the failure to our specific Supabase table interfaces, and determine the exact operational value change needed to heal the crash.',
  bob: 'The Realignment Architect. You take Dr. Bob\'s logical prescription and structuralize it into a perfectly formatted JSON payload string, stripped of all syntax anomalies, ready for the testing sandbox.',
  emulator:
    'The Guardrail Sandbox. You act as a silent mock validator, filtering out structural patches that contain insecure scripts or breaking variable configurations before a human sees them.',
};

async function upsertTrainingRecord(schemaPayload: string): Promise<void> {
  const basePayload = {
    service_name: 'railway-backend',
    schema_payload: schemaPayload,
    updated_at: new Date().toISOString(),
  };

  const variants: Array<Record<string, unknown>> = [
    {
      ...basePayload,
      system_rules: systemRules,
      agent_roles: agentRoles,
    },
    {
      ...basePayload,
      system_rules: systemRules.join('\n'),
      agent_roles: JSON.stringify(agentRoles),
    },
  ];

  let lastError: unknown = null;

  for (const payload of variants) {
    const { error } = await supabase
      .from('system_knowledge_base')
      .upsert(payload, { onConflict: 'service_name' });

    if (!error) {
      return;
    }

    lastError = error;
  }

  throw lastError;
}

async function main(): Promise<void> {
  const schemaPayload = await readFile(typesPath, 'utf8');

  if (!schemaPayload.trim()) {
    throw new Error('Generated schema file is empty: backend/src/types.ts');
  }

  await upsertTrainingRecord(schemaPayload);

  console.log('Training sync complete for service_name=railway-backend');
  console.log(`Schema payload size: ${schemaPayload.length} characters`);
}

main().catch((error) => {
  console.error('Training sync failed:', error);
  process.exitCode = 1;
});
