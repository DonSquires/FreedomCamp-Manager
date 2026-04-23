#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { runDrBobReview } from './dr-bob-review.mjs';

const candidateNames = ['spec.md', 'plan.md'];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveArtifacts() {
  const explicit = process.argv.slice(2).filter((item) => item && !item.startsWith('--'));
  if (explicit.length > 0) {
    return explicit.map((item) => path.resolve(process.cwd(), item));
  }

  const discovered = [];
  for (const fileName of candidateNames) {
    const candidate = path.resolve(process.cwd(), fileName);
    if (await exists(candidate)) discovered.push(candidate);
  }
  return discovered;
}

function inferType(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base.includes('spec')) return 'spec';
  if (base.includes('plan')) return 'plan';
  return 'design-artifact';
}

async function main() {
  const artifacts = await resolveArtifacts();
  if (artifacts.length === 0) {
    console.error('No spec.md or plan.md found. Pass explicit files to review.');
    process.exit(2);
  }

  let shouldFail = false;
  for (const artifactPath of artifacts) {
    console.log(`Reviewing ${path.relative(process.cwd(), artifactPath)} ...`);
    const result = await runDrBobReview({
      file: artifactPath,
      type: inferType(artifactPath),
      failOnRevision: true,
    });
    if (result.shouldFail) shouldFail = true;
  }

  if (shouldFail) process.exit(1);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});