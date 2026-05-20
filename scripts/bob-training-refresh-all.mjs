#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = process.cwd();
const scriptsDir = path.join(workspaceRoot, 'scripts');

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

function isRunpodServerlessUrl(value) {
  return /api\.runpod\.ai\/v2\//i.test(String(value || ''));
}

function toIngestUrl(baseOrIngest) {
  const normalized = normalizeUrl(baseOrIngest);
  if (!normalized) return '';
  if (/\/intel\/ingest-bulletin\/?$/i.test(normalized)) {
    return normalized.replace(/\/+$/, '');
  }
  return `${normalized}/intel/ingest-bulletin`;
}

function gatherIngestCandidates() {
  const explicit = [
    process.env.INTEL_INGEST_URL,
    process.env.BOB_INTEL_INGEST_URL,
  ].map(toIngestUrl).filter(Boolean);

  if (explicit.length) {
    return explicit;
  }

  const baseCandidates = [
    process.env.BOB_TRAINING_INGEST_BASE_URL,
    process.env.BOB_SERVICE_URL_RAILWAY,
    process.env.INFERENCE_SERVICE_URL_RAILWAY,
    process.env.RAILWAY_INFERENCE_URL,
    process.env.RAILWAY_BOB_URL,
    process.env.RAILWAY_URL,
    process.env.VITE_INFERENCE_SERVICE_URL_RAILWAY,
  ]
    .map(normalizeUrl)
    .filter(Boolean);

  const unique = [];
  for (const candidate of baseCandidates) {
    const ingest = toIngestUrl(candidate);
    if (ingest && !unique.includes(ingest)) unique.push(ingest);
  }

  return unique;
}

async function canReachIngestUrl(url, apiKey) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    // GET on a POST-only route often returns 405 when the route exists.
    return [200, 401, 403, 405].includes(response.status);
  } catch {
    return false;
  }
}

async function railwayGraphqlQuery(query, variables, token) {
  const response = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Railway GraphQL HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(String(payload.errors[0]?.message || 'Railway GraphQL error'));
  }

  return payload?.data || {};
}

async function discoverRailwayIngestCandidates() {
  const token = String(process.env.RAILWAY_TOKEN || process.env.RAILWAY_CORE_TOKEN || '').trim();
  if (!token) return [];

  try {
    const projectData = await railwayGraphqlQuery(
      'query { projects { edges { node { id name } } } }',
      {},
      token,
    );
    const projects = (projectData?.projects?.edges || []).map((edge) => edge?.node).filter(Boolean);

    const candidates = [];
    for (const project of projects) {
      const details = await railwayGraphqlQuery(
        'query($projectId:String!){ project(id:$projectId){ environments { edges { node { name serviceInstances { edges { node { serviceName domains { serviceDomains { domain } customDomains { domain } } } } } } } } } }',
        { projectId: String(project.id) },
        token,
      );

      const envEdges = details?.project?.environments?.edges || [];
      for (const envEdge of envEdges) {
        const envName = String(envEdge?.node?.name || '').toLowerCase();
        const instanceEdges = envEdge?.node?.serviceInstances?.edges || [];
        for (const instanceEdge of instanceEdges) {
          const serviceName = String(instanceEdge?.node?.serviceName || '').toLowerCase();
          const domains = [
            ...(instanceEdge?.node?.domains?.serviceDomains || []).map((d) => d?.domain),
            ...(instanceEdge?.node?.domains?.customDomains || []).map((d) => d?.domain),
          ].filter(Boolean);

          for (const domain of domains) {
            const baseUrl = normalizeUrl(`https://${domain}`);
            if (!baseUrl) continue;
            candidates.push({
              url: toIngestUrl(baseUrl),
              rank:
                (envName === 'production' ? 30 : 0)
                + (serviceName.includes('inference') || serviceName.includes('bob') ? 20 : 0)
                + (serviceName.includes('proxy') || serviceName.includes('stt') ? -10 : 0),
            });
          }
        }
      }
    }

    const deduped = new Map();
    for (const candidate of candidates) {
      const existing = deduped.get(candidate.url);
      if (!existing || candidate.rank > existing.rank) {
        deduped.set(candidate.url, candidate);
      }
    }

    return [...deduped.values()]
      .sort((a, b) => b.rank - a.rank)
      .map((item) => item.url);
  } catch {
    return [];
  }
}

async function resolveDurableIngestUrl() {
  const apiKey = String(process.env.BOB_INFERENCE_API_KEY || process.env.INFERENCE_API_KEY || '').trim();
  const candidates = [
    ...gatherIngestCandidates(),
    ...(await discoverRailwayIngestCandidates()),
  ];

  for (const candidate of candidates) {
    if (await canReachIngestUrl(candidate, apiKey)) {
      return candidate;
    }
  }

  return '';
}

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipConnectivity = process.argv.includes('--skip-connectivity-test');
  const jsRuntime = process.execPath || 'node';

  const startedAt = Date.now();
  console.log('\n=== Bob Training Refresh (Consolidated) ===\n');

  const configuredBobUrl = normalizeUrl(process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '');
  const durableIngestUrl = await resolveDurableIngestUrl();
  if (durableIngestUrl) {
    process.env.INTEL_INGEST_URL = durableIngestUrl;
    console.log(`Durable ingest route: ${durableIngestUrl}`);
  } else if (isRunpodServerlessUrl(configuredBobUrl)) {
    console.warn('⚠️  Durable ingest route not resolved (RunPod serverless detected).');
    console.warn('   Set one of these env vars to your Railway inference base URL or ingest URL:');
    console.warn('   BOB_SERVICE_URL_RAILWAY, INFERENCE_SERVICE_URL_RAILWAY, RAILWAY_INFERENCE_URL, RAILWAY_BOB_URL, RAILWAY_URL, INTEL_INGEST_URL.');
    console.warn('   Training will continue with RunPod runsync fallback (session memory may be ephemeral).\n');
  }

  const step1 = await run(jsRuntime, [path.join(scriptsDir, 'auto-ingest.mjs')]);
  if (step1.code !== 0) {
    console.error('Step 1 failed: auto-ingest.mjs');
    process.exit(step1.code);
  }

  const step2 = await run(jsRuntime, [path.join(scriptsDir, 'verify-bob-training-wiring.mjs'), '--json-only'], { capture: true });
  if (step2.code !== 0) {
    console.error('Step 2 failed: verify-bob-training-wiring.mjs');
    process.stderr.write(step2.stderr || '');
    process.stdout.write(step2.stdout || '');
    process.exit(step2.code);
  }

  let verifyReport = null;
  try {
    verifyReport = JSON.parse(step2.stdout);
  } catch {
    verifyReport = null;
  }

  const ingestArgs = [path.join(scriptsDir, 'bob-ingest-all-training.mjs'), '--skip-verify'];
  if (dryRun) ingestArgs.push('--dry-run');
  if (skipConnectivity) ingestArgs.push('--skip-connectivity-test');

  const step3 = await run(jsRuntime, ingestArgs);
  if (step3.code !== 0) {
    console.error('Step 3 failed: bob-ingest-all-training.mjs');
    process.exit(step3.code);
  }

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  console.log('\n=== Consolidation Stats ===');
  if (verifyReport) {
    console.log(`Canonical training sources: ${verifyReport.totals.canonicalTraining}`);
    console.log(`Existing training files:    ${verifyReport.totals.existingTrainingFiles}`);
    console.log(`Missing in brain dump:      ${verifyReport.totals.missingInBrainDump}`);
  } else {
    console.log('Verification report parsing failed; run verify-bob-training-wiring.mjs manually.');
  }
  console.log(`Elapsed seconds:            ${elapsedSeconds}`);
  console.log('Status:                     SUCCESS\n');
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
