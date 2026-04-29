#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_TEMPLATE = path.resolve('tools/bob-screenshot-scorecards/template.scorecard.json');

function usage() {
  console.log([
    'Usage:',
    '  node scripts/bob-screenshot-scorecard.mjs init [outputPath]',
    '  node scripts/bob-screenshot-scorecard.mjs score <inputPath> [--json]',
    '',
    'Examples:',
    '  node scripts/bob-screenshot-scorecard.mjs init tools/bob-screenshot-scorecards/review-2026-04-28.json',
    '  node scripts/bob-screenshot-scorecard.mjs score tools/bob-screenshot-scorecards/review-2026-04-28.json',
  ].join('\n'));
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isScore(value) {
  return Number.isFinite(value) && value >= 1 && value <= 5;
}

function normalizeWeightMap(weights) {
  const entries = Object.entries(weights || {}).filter(([, value]) => Number.isFinite(value) && value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return {};

  const normalized = {};
  for (const [key, value] of entries) {
    normalized[key] = value / total;
  }
  return normalized;
}

function computeScreenshotScore(screenshot, weights) {
  const scores = screenshot?.scores || {};
  let weighted = 0;
  let coverage = 0;
  const missing = [];

  for (const [criterion, weight] of Object.entries(weights)) {
    const value = Number(scores[criterion]);
    if (!isScore(value)) {
      missing.push(criterion);
      continue;
    }

    weighted += (value / 5) * weight;
    coverage += weight;
  }

  const normalized = coverage > 0 ? weighted / coverage : 0;
  return {
    percent: Math.round(normalized * 100),
    coverage: Math.round(coverage * 100),
    missing,
  };
}

function maturityBand(percent) {
  if (percent >= 85) return 'adopt';
  if (percent >= 70) return 'pilot';
  if (percent >= 55) return 'investigate';
  return 'avoid';
}

function validateScorecard(scorecard) {
  const errors = [];
  if (!scorecard || typeof scorecard !== 'object') {
    errors.push('Scorecard root must be an object.');
    return errors;
  }

  if (!Array.isArray(scorecard.screenshots) || scorecard.screenshots.length === 0) {
    errors.push('screenshots must be a non-empty array.');
  }

  const weights = normalizeWeightMap(scorecard.weights);
  if (Object.keys(weights).length === 0) {
    errors.push('weights must contain at least one positive numeric criterion weight.');
  }

  (scorecard.screenshots || []).forEach((shot, index) => {
    if (!shot?.name) errors.push(`screenshots[${index}].name is required.`);
    if (!shot?.product) errors.push(`screenshots[${index}].product is required.`);
    if (!shot?.sourceUrl) errors.push(`screenshots[${index}].sourceUrl is required.`);
  });

  return errors;
}

async function initScorecard(outputPath) {
  const template = await readJson(DEFAULT_TEMPLATE);
  const targetPath = path.resolve(outputPath || path.join('tools', 'bob-screenshot-scorecards', `review-${new Date().toISOString().slice(0, 10)}.json`));
  await writeJson(targetPath, template);
  console.log(`[bob-screenshot-scorecard] Created template: ${targetPath}`);
}

async function scoreScorecard(inputPath, outputJson) {
  const target = path.resolve(inputPath);
  const scorecard = await readJson(target);
  const validationErrors = validateScorecard(scorecard);

  if (validationErrors.length) {
    console.error('[bob-screenshot-scorecard] Validation failed:');
    validationErrors.forEach((err) => console.error(`- ${err}`));
    process.exit(2);
  }

  const weights = normalizeWeightMap(scorecard.weights);
  const scored = scorecard.screenshots.map((shot) => {
    const result = computeScreenshotScore(shot, weights);
    return {
      name: shot.name,
      product: shot.product,
      scorePercent: result.percent,
      maturity: maturityBand(result.percent),
      coveragePercent: result.coverage,
      missingCriteria: result.missing,
      candidateActions: Array.isArray(shot.candidateActions) ? shot.candidateActions : [],
    };
  });

  const average = Math.round(scored.reduce((sum, item) => sum + item.scorePercent, 0) / scored.length);
  const summary = {
    reviewedAt: new Date().toISOString(),
    inputPath: target,
    averageScorePercent: average,
    averageMaturity: maturityBand(average),
    screenshotCount: scored.length,
    scored,
  };

  if (outputJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('[bob-screenshot-scorecard] Review summary');
    console.log(`- Average score: ${summary.averageScorePercent}% (${summary.averageMaturity})`);
    console.log(`- Screenshots reviewed: ${summary.screenshotCount}`);
    for (const item of scored) {
      const missing = item.missingCriteria.length ? ` missing=${item.missingCriteria.join(',')}` : '';
      console.log(`  - ${item.product} :: ${item.name} => ${item.scorePercent}% (${item.maturity}), coverage=${item.coveragePercent}%${missing}`);
    }
  }

  const outPath = target.replace(/\.json$/i, '.result.json');
  await writeJson(outPath, summary);
  console.log(`[bob-screenshot-scorecard] Saved result: ${outPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = String(args[0] || '').trim();
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'init') {
    await initScorecard(args[1]);
    return;
  }

  if (command === 'score') {
    const inputPath = args[1];
    if (!inputPath) {
      usage();
      process.exit(1);
    }

    const outputJson = args.includes('--json');
    await scoreScorecard(inputPath, outputJson);
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error('[bob-screenshot-scorecard] Unexpected error:', String(error?.message || error));
  process.exit(1);
});
