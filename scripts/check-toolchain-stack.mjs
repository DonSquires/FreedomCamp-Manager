#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();

const packageDirs = [
  ".",
  "backend",
  "proxy-server",
  "inference-service",
  "ptt-server",
  "ptt-bridge",
  "runpod-gateway",
  "runpod-worker",
  "mobile-app",
];

const pythonServiceDirs = [
  "runpod-worker",
  "runpod-stt-worker",
  "ptt-bridge-python",
  "railway-stt",
  "ops/speech-intent/speech-router",
];

const requiredTools = ["bash", "git", "curl", "wget", "jq", "node", "npm", "python3"];
const optionalTools = ["rg"];

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function firstInt(text) {
  const match = String(text || "").match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseEngineBounds(engineRaw) {
  const engine = String(engineRaw || "").trim();
  if (!engine) return { min: null, maxExclusive: null };

  let min = null;
  let maxExclusive = null;

  const gte = engine.match(/>=\s*(\d+)/);
  if (gte) min = Number.parseInt(gte[1], 10);

  const gt = engine.match(/>\s*(\d+)/);
  if (gt && min === null) min = Number.parseInt(gt[1], 10) + 1;

  const lt = engine.match(/<\s*(\d+)/);
  if (lt) maxExclusive = Number.parseInt(lt[1], 10);

  if (min === null) {
    const exact = engine.match(/^(\d+)(?:\.|$)/);
    if (exact) {
      min = Number.parseInt(exact[1], 10);
      maxExclusive = min + 1;
    }
  }

  return { min, maxExclusive };
}

function inBounds(major, bounds) {
  if (major === null) return false;
  if (bounds.min !== null && major < bounds.min) return false;
  if (bounds.maxExclusive !== null && major >= bounds.maxExclusive) return false;
  return true;
}

function parseDockerNodeMajor(dockerfilePath) {
  if (!fileExists(dockerfilePath)) return null;
  const text = readText(dockerfilePath);
  const fromNode = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^FROM\s+node:/i.test(line));
  if (!fromNode) return null;
  return firstInt(fromNode);
}

function readDockerFromLine(dockerfilePath) {
  if (!fileExists(dockerfilePath)) return null;
  const text = readText(dockerfilePath);
  const fromLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^FROM\s+/i.test(line));
  return fromLine || null;
}

function parseDockerPythonMajor(dockerfilePath) {
  const fromLine = readDockerFromLine(dockerfilePath);
  if (!fromLine) return null;

  const pythonMatch = fromLine.match(/^FROM\s+python:(\d+)/i);
  if (pythonMatch) {
    return Number.parseInt(pythonMatch[1], 10);
  }

  const cudaMatch = fromLine.match(/^FROM\s+nvidia\/cuda:[^\s]+/i);
  if (cudaMatch) {
    const dockerText = readText(dockerfilePath);
    if (/python3(\.\d+)?/i.test(dockerText) || /python\s+-/i.test(dockerText)) {
      return 3;
    }
  }

  return null;
}

function getCommandVersion(command) {
  try {
    const output = execSync(`${command} --version`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return output.split("\n")[0] || "available";
  } catch {
    return null;
  }
}

const hardFailures = [];
const warnings = [];

console.log("Toolchain Stack Doctor");
console.log("======================");

console.log("\n1) CLI tools");
for (const tool of requiredTools) {
  const version = getCommandVersion(tool);
  if (!version) {
    hardFailures.push(`Missing required CLI: ${tool}`);
    console.log(`[missing] ${tool}`);
  } else {
    console.log(`[ok] ${tool} - ${version}`);
  }
}

for (const tool of optionalTools) {
  const version = getCommandVersion(tool);
  if (!version) {
    warnings.push(`Optional CLI missing: ${tool} (fallback to grep).`);
    console.log(`[optional-missing] ${tool}`);
  } else {
    console.log(`[ok] ${tool} - ${version}`);
  }
}

console.log("\n2) Service stack coherence");
for (const relDir of packageDirs) {
  const pkgPath = path.join(repoRoot, relDir, "package.json");
  if (!fileExists(pkgPath)) continue;

  const pkg = readJson(pkgPath);
  const label = relDir === "." ? "root" : relDir;
  const engineNodeRaw = pkg.engines?.node || "";
  const engineBounds = parseEngineBounds(engineNodeRaw);
  const packageManagerMajor = firstInt(pkg.packageManager || "");

  const nodeVersionPath = path.join(repoRoot, relDir, ".node-version");
  const nodeVersionMajor = fileExists(nodeVersionPath) ? firstInt(readText(nodeVersionPath).trim()) : null;

  const dockerfilePath = path.join(repoRoot, relDir, "Dockerfile");
  const dockerNodeMajor = parseDockerNodeMajor(dockerfilePath);

  console.log(`\n- ${label}`);
  console.log(`  packageManager: ${pkg.packageManager || "(not set)"}`);
  console.log(`  engines.node: ${engineNodeRaw || "(not set)"}`);
  console.log(`  .node-version: ${nodeVersionMajor ?? "(not set)"}`);
  console.log(`  Dockerfile node: ${dockerNodeMajor ?? "(not set)"}`);

  if (engineNodeRaw && nodeVersionMajor !== null && !inBounds(nodeVersionMajor, engineBounds)) {
    hardFailures.push(
      `${label}: .node-version ${nodeVersionMajor} is outside engines.node constraint (${engineNodeRaw})`
    );
  }

  if (engineNodeRaw && dockerNodeMajor !== null && !inBounds(dockerNodeMajor, engineBounds)) {
    hardFailures.push(
      `${label}: Dockerfile Node ${dockerNodeMajor} is outside engines.node constraint (${engineNodeRaw})`
    );
  }

  if (packageManagerMajor !== null && packageManagerMajor >= 11 && nodeVersionMajor !== null && nodeVersionMajor < 20) {
    hardFailures.push(`${label}: npm ${packageManagerMajor} with Node ${nodeVersionMajor} is unsupported for this stack`);
  }

  if (!engineNodeRaw) {
    warnings.push(`${label}: package.json has no engines.node; toolchain cannot be strictly validated.`);
  }

  if (nodeVersionMajor === null) {
    warnings.push(`${label}: missing .node-version; local/runtime parity may drift.`);
  }

  if (dockerNodeMajor === null && relDir !== "mobile-app") {
    warnings.push(`${label}: no Dockerfile Node base detected; container parity not validated.`);
  }
}

console.log("\n3) Python/RunPod stack coherence");
for (const relDir of pythonServiceDirs) {
  const label = relDir;
  const dockerfilePath = path.join(repoRoot, relDir, "Dockerfile");
  const requirementsTxt = path.join(repoRoot, relDir, "requirements.txt");
  const requirementsAlt = path.join(repoRoot, relDir, "requirements.whisper.txt");
  const handlerPy = path.join(repoRoot, relDir, "handler.py");
  const serverPy = path.join(repoRoot, relDir, "server.py");
  const mainPy = path.join(repoRoot, relDir, "main.py");
  const appMainPy = path.join(repoRoot, relDir, "app", "main.py");
  const entrypointSh = path.join(repoRoot, relDir, "entrypoint.sh");

  const dockerFromLine = readDockerFromLine(dockerfilePath);
  const dockerPythonMajor = parseDockerPythonMajor(dockerfilePath);
  const hasRequirements = fileExists(requirementsTxt) || fileExists(requirementsAlt);

  console.log(`\n- ${label}`);
  console.log(`  Dockerfile: ${fileExists(dockerfilePath) ? "present" : "missing"}`);
  console.log(`  Docker FROM: ${dockerFromLine ?? "(not set)"}`);
  console.log(`  requirements: ${hasRequirements ? "present" : "missing"}`);
  console.log(`  python base major: ${dockerPythonMajor ?? "(not detected)"}`);

  if (!fileExists(dockerfilePath)) {
    hardFailures.push(`${label}: missing Dockerfile for non-Node service`);
    continue;
  }

  if (!hasRequirements) {
    hardFailures.push(`${label}: missing requirements file`);
  }

  if (dockerPythonMajor === null) {
    warnings.push(`${label}: Python runtime not confidently detected from Dockerfile.`);
  }

  const isRunpodService = relDir.startsWith("runpod-");
  if (isRunpodService) {
    if (!fileExists(handlerPy)) {
      warnings.push(`${label}: runpod service missing handler.py in service root.`);
    }
    const dockerText = readText(dockerfilePath);
    if (!/CMD\s*\[/i.test(dockerText)) {
      hardFailures.push(`${label}: Dockerfile has no explicit CMD for runtime entrypoint.`);
    }
    if (relDir === "runpod-worker" && !fileExists(entrypointSh)) {
      hardFailures.push(`${label}: expected entrypoint.sh is missing.`);
    }
  }

  if (!fileExists(handlerPy) && !fileExists(serverPy) && !fileExists(mainPy) && !fileExists(appMainPy)) {
    warnings.push(`${label}: no obvious Python entrypoint file (handler.py/server.py/main.py).`);
  }
}

console.log("\n4) Summary");
if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`);
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
} else {
  console.log("Warnings (0)");
}

if (hardFailures.length > 0) {
  console.error(`\nHard failures (${hardFailures.length}):`);
  for (const failure of hardFailures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("\nToolchain stack is coherent for validated services.");