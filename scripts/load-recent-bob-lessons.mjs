#!/usr/bin/env node

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './load-local-env.mjs';

loadLocalEnv();

function argValue(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const value = process.argv[idx + 1];
  return typeof value === 'string' ? value : fallback;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const hours = toPositiveInt(argValue('--hours', process.env.DR_BOB_LESSON_WINDOW_HOURS || '24'), 24);
const limit = toPositiveInt(argValue('--limit', process.env.DR_BOB_LESSON_LIMIT || '8'), 8);
const output = String(argValue('--output', 'text')).trim().toLowerCase();

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const orgId = String(process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || '').trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const fromIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

async function loadFromJsonlFallback() {
  const filePath = path.join(process.cwd(), 'data', 'bob-response-scores.jsonl');
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => Number.isFinite(entry.score) && Number(entry.score) <= 0.7)
    .filter((entry) => {
      const createdAt = String(entry.createdAt || entry.timestamp || '');
      return createdAt ? createdAt >= fromIso : true;
    })
    .slice(0, limit)
    .map((entry, idx) => ({
      id: `jsonl-${idx + 1}`,
      lesson_key: String(entry.metadata?.reviewDecision || entry.metadata?.provider || 'jsonl_fallback'),
      score: Number(entry.score),
      lesson_detail: {
        failure_reason: String(entry.metadata?.reason || entry.metadata?.responsePreview || '').slice(0, 300),
      },
      created_at: String(entry.createdAt || entry.timestamp || ''),
      source: 'jsonl_fallback',
    }));
}

let query = supabase
  .from('bob_learning_log')
  .select('id, lesson_key, score, lesson_detail, created_at')
  .lte('score', 0.7)
  .gte('created_at', fromIso)
  .order('created_at', { ascending: false })
  .limit(limit);

if (orgId) {
  query = query.eq('organization_id', orgId);
}

const { data, error } = await query;
let lessons = Array.isArray(data) ? data : [];

if (error) {
  lessons = await loadFromJsonlFallback();
  if (lessons.length === 0) {
    console.log(`Recent low-score lessons (last ${hours}h, max ${limit}): 0`);
    console.log(`DB source unavailable in current schema cache: ${error.message}`);
    process.exit(0);
  }
}

if (output === 'json') {
  console.log(JSON.stringify({ ok: true, hours, limit, count: lessons.length, lessons }, null, 2));
  process.exit(0);
}

console.log(`Recent low-score lessons (last ${hours}h, max ${limit}): ${lessons.length}`);
for (const row of lessons) {
  const detail = typeof row.lesson_detail === 'object' && row.lesson_detail ? row.lesson_detail : {};
  const reason = String(detail.failure_reason || detail.error_message || '').trim();
  const evidence = reason || `lesson_key=${row.lesson_key || 'unknown'}`;
  console.log(`- ${row.created_at} | score=${row.score} | ${evidence}`);
}
