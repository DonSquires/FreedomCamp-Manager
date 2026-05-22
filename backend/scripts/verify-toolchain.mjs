#!/usr/bin/env node

function parseMajor(version) {
  if (!version) return null;
  const cleaned = String(version).trim().replace(/^v/, "");
  const major = Number.parseInt(cleaned.split(".")[0], 10);
  return Number.isFinite(major) ? major : null;
}

function fail(message) {
  console.error(`[toolchain] ${message}`);
  process.exit(1);
}

const nodeMajor = parseMajor(process.version);
const npmMajor = parseMajor(process.env.npm_config_user_agent?.match(/npm\/(\d+)/)?.[1]);

if (nodeMajor === null || nodeMajor < 20 || nodeMajor >= 21) {
  fail(`Node 20.x is required. Detected: ${process.version}`);
}

if (npmMajor === null || npmMajor < 10 || npmMajor >= 11) {
  fail(
    `npm 10.x is required. Detected npm major: ${npmMajor ?? "unknown"}. ` +
      `Ensure builds and runtime commands execute via npm.`
  );
}

console.log(`[toolchain] OK node=${process.version} npm-major=${npmMajor}`);
