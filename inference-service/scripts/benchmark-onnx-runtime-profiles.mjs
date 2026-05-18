#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const cpuCount = Math.max(1, (os.cpus() || []).length || 1);
const cwd = process.cwd();

const defaults = {
  profiles: ['latency', 'balanced', 'throughput'],
  iterations: 12,
  warmup: 3,
  output: path.resolve(cwd, 'data', 'onnx-runtime-benchmark.json'),
  yoloModelPath: path.resolve(cwd, 'models', 'yolov8n.onnx'),
  embeddingModelPath: path.resolve(cwd, 'models', 'mobilenet_v3.onnx'),
};

const profileDefaults = {
  latency: {
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  },
  balanced: {
    executionMode: 'parallel',
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.min(4, cpuCount),
    interOpNumThreads: 1,
  },
  throughput: {
    executionMode: 'parallel',
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.min(8, cpuCount),
    interOpNumThreads: 2,
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { ...defaults };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--iterations' && args[i + 1]) {
      parsed.iterations = Math.max(1, Number.parseInt(args[++i], 10) || defaults.iterations);
    } else if (arg === '--warmup' && args[i + 1]) {
      parsed.warmup = Math.max(0, Number.parseInt(args[++i], 10) || defaults.warmup);
    } else if (arg === '--profiles' && args[i + 1]) {
      parsed.profiles = String(args[++i])
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p in profileDefaults);
      if (!parsed.profiles.length) parsed.profiles = defaults.profiles;
    } else if (arg === '--output' && args[i + 1]) {
      parsed.output = path.resolve(cwd, args[++i]);
    } else if (arg === '--yolo-model' && args[i + 1]) {
      parsed.yoloModelPath = path.resolve(cwd, args[++i]);
    } else if (arg === '--embedding-model' && args[i + 1]) {
      parsed.embeddingModelPath = path.resolve(cwd, args[++i]);
    }
  }

  return parsed;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

function summarize(timesMs) {
  if (!timesMs.length) {
    return {
      meanMs: null,
      minMs: null,
      maxMs: null,
      p50Ms: null,
      p95Ms: null,
      throughputPerSecond: null,
    };
  }

  const sorted = [...timesMs].sort((a, b) => a - b);
  const total = timesMs.reduce((acc, n) => acc + n, 0);
  const meanMs = total / timesMs.length;

  return {
    meanMs,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    throughputPerSecond: meanMs > 0 ? 1000 / meanMs : null,
  };
}

function makeTensor(ort, dims) {
  const total = dims.reduce((acc, n) => acc * n, 1);
  const data = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    data[i] = (i % 255) / 255;
  }
  return new ort.Tensor('float32', data, dims);
}

async function runBenchmarkForModel({ ort, label, modelPath, inputShape, options, warmup, iterations }) {
  const result = {
    model: label,
    modelPath,
    inputShape,
    options,
    warmup,
    iterations,
    stats: null,
    error: null,
  };

  if (!fs.existsSync(modelPath)) {
    result.error = 'model_not_found';
    return result;
  }

  try {
    const session = await ort.InferenceSession.create(modelPath, options);
    const inputName = session.inputNames[0];
    const inputTensor = makeTensor(ort, inputShape);

    for (let i = 0; i < warmup; i += 1) {
      await session.run({ [inputName]: inputTensor });
    }

    const timesMs = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = process.hrtime.bigint();
      await session.run({ [inputName]: inputTensor });
      const end = process.hrtime.bigint();
      timesMs.push(Number(end - start) / 1e6);
    }

    result.stats = summarize(timesMs);
  } catch (error) {
    result.error = String(error?.message || error);
  }

  return result;
}

function getProfileOptions(name) {
  const base = profileDefaults[name] || profileDefaults.balanced;
  return {
    executionProviders: ['cpu'],
    graphOptimizationLevel: base.graphOptimizationLevel,
    executionMode: base.executionMode,
    intraOpNumThreads: base.intraOpNumThreads,
    interOpNumThreads: base.interOpNumThreads,
    enableCpuMemArena: true,
  };
}

function pickRecommendation(report) {
  const yoloRows = report.results
    .filter((r) => r.model === 'yolo' && r.stats && !r.error)
    .map((r) => ({ profile: r.profile, p95Ms: r.stats.p95Ms, throughput: r.stats.throughputPerSecond }));

  if (!yoloRows.length) {
    return {
      recommendedProfile: null,
      reason: 'No successful yolo benchmark rows available.',
    };
  }

  const bestLatency = [...yoloRows].sort((a, b) => a.p95Ms - b.p95Ms)[0];
  const bestThroughput = [...yoloRows].sort((a, b) => b.throughput - a.throughput)[0];

  if (bestLatency.profile === bestThroughput.profile) {
    return {
      recommendedProfile: bestLatency.profile,
      reason: 'Same profile leads both p95 latency and throughput on yolo runs.',
    };
  }

  return {
    recommendedProfile: 'balanced',
    reason: `Tradeoff split: best p95=${bestLatency.profile}, best throughput=${bestThroughput.profile}.`,
  };
}

function printSummary(report) {
  console.log('ONNX Runtime Profile Benchmark');
  console.log('==============================');
  console.log(`Host CPU cores: ${report.meta.cpuCount}`);
  console.log(`Iterations: ${report.meta.iterations}, Warmup: ${report.meta.warmup}`);
  console.log('');

  for (const row of report.results) {
    if (row.error || !row.stats) {
      console.log(`${row.profile.padEnd(10)} | ${row.model.padEnd(9)} | ERROR: ${row.error}`);
      continue;
    }

    const mean = row.stats.meanMs.toFixed(2).padStart(8);
    const p95 = row.stats.p95Ms.toFixed(2).padStart(8);
    const tps = row.stats.throughputPerSecond.toFixed(2).padStart(8);
    console.log(`${row.profile.padEnd(10)} | ${row.model.padEnd(9)} | mean=${mean} ms | p95=${p95} ms | tps=${tps}`);
  }

  console.log('');
  console.log(`Recommendation: ${report.recommendation.recommendedProfile || 'n/a'}`);
  console.log(`Reason: ${report.recommendation.reason}`);
  console.log(`Report: ${report.meta.outputPath}`);
}

async function main() {
  const cfg = parseArgs();
  let ort;

  try {
    ort = await import('onnxruntime-node');
  } catch (error) {
    console.error('onnxruntime-node failed to load. Benchmark cannot run in this environment.');
    console.error(String(error?.message || error));
    process.exit(2);
  }

  const results = [];

  for (const profile of cfg.profiles) {
    const options = getProfileOptions(profile);

    const yoloResult = await runBenchmarkForModel({
      ort,
      label: 'yolo',
      modelPath: cfg.yoloModelPath,
      inputShape: [1, 3, 640, 640],
      options,
      warmup: cfg.warmup,
      iterations: cfg.iterations,
    });
    results.push({ profile, ...yoloResult });

    const embeddingResult = await runBenchmarkForModel({
      ort,
      label: 'embedding',
      modelPath: cfg.embeddingModelPath,
      inputShape: [1, 3, 224, 224],
      options,
      warmup: cfg.warmup,
      iterations: cfg.iterations,
    });
    results.push({ profile, ...embeddingResult });
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      cpuCount,
      iterations: cfg.iterations,
      warmup: cfg.warmup,
      profiles: cfg.profiles,
      outputPath: cfg.output,
      yoloModelPath: cfg.yoloModelPath,
      embeddingModelPath: cfg.embeddingModelPath,
    },
    results,
  };

  report.recommendation = pickRecommendation(report);

  fs.mkdirSync(path.dirname(cfg.output), { recursive: true });
  fs.writeFileSync(cfg.output, JSON.stringify(report, null, 2), 'utf8');

  printSummary(report);

  const hasSuccessful = results.some((row) => row.stats && !row.error);
  if (!hasSuccessful) {
    process.exit(3);
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
