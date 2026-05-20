import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const outputPath = process.argv[2] ? path.resolve(repoRoot, process.argv[2]) : null;

function runCommand(command) {
  try {
    const output = execSync(command, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      output: `${error.stdout || ''}${error.stderr || ''}`,
    };
  }
}

function parseBuild(output) {
  const chunkPattern = /^dist\/(assets\/[^\s]+)\s+([\d,]+\.?\d*)\s+kB(?:\s+│\s+gzip:\s+([\d,]+\.?\d*)\s+kB)?/gm;
  const chunks = [];
  let match;
  while ((match = chunkPattern.exec(output)) !== null) {
    chunks.push({
      file: match[1],
      sizeKb: Number(String(match[2]).replace(/,/g, '')),
      gzipKb: match[3] ? Number(String(match[3]).replace(/,/g, '')) : null,
    });
  }

  const largeChunks = chunks.filter((chunk) => chunk.sizeKb >= 150).sort((left, right) => right.sizeKb - left.sizeKb);

  return {
    succeeded: /✓ built in/i.test(output),
    hasChunkWarning: /Some chunks are larger than/i.test(output) || chunks.some((chunk) => chunk.sizeKb > 600),
    largeChunks,
    tail: output.trim().split('\n').slice(-40),
  };
}

function parseLint(output) {
  const lines = output.split('\n');
  const fileIssues = [];
  let currentFile = null;

  for (const line of lines) {
    if (line.startsWith('/workspaces/')) {
      currentFile = line.trim();
      continue;
    }

    const issueMatch = line.match(/^\s+(\d+):(\d+)\s+(warning|error)\s+(.*?)\s{2,}([^\s].*)$/);
    if (issueMatch && currentFile) {
      fileIssues.push({
        file: currentFile,
        line: Number(issueMatch[1]),
        column: Number(issueMatch[2]),
        severity: issueMatch[3],
        message: issueMatch[4].trim(),
        rule: issueMatch[5].trim(),
      });
    }
  }

  const summaryMatch = output.match(/✖\s+(\d+) problems \((\d+) errors,\s+(\d+) warnings\)/);
  return {
    succeeded: !summaryMatch || Number(summaryMatch[2]) === 0,
    totalProblems: summaryMatch ? Number(summaryMatch[1]) : 0,
    totalErrors: summaryMatch ? Number(summaryMatch[2]) : 0,
    totalWarnings: summaryMatch ? Number(summaryMatch[3]) : 0,
    fileIssues,
    tail: lines.filter(Boolean).slice(-60),
  };
}

const buildResult = runCommand('npm run build');
const lintResult = runCommand('npm run lint');

const evidence = {
  generatedAt: new Date().toISOString(),
  privacyMode: 'self-contained',
  commands: {
    build: 'npm run build',
    lint: 'npm run lint',
  },
  build: {
    exitCode: buildResult.exitCode,
    ...parseBuild(buildResult.output),
  },
  lint: {
    exitCode: lintResult.exitCode,
    ...parseLint(lintResult.output),
  },
};

evidence.bobReviewPrompt = [
  'You are Bob in self-contained internal mode.',
  'Review this build evidence and return sections: Critical blockers, Performance risks, Reliability risks, Privacy checks, 14-day remediation plan.',
  `Build succeeded: ${evidence.build.succeeded}. Chunk warning: ${evidence.build.hasChunkWarning}.`,
  `Top large chunks: ${evidence.build.largeChunks.slice(0, 6).map((chunk) => `${chunk.file} ${chunk.sizeKb}kB`).join('; ') || 'none'}.`,
  `Lint exit code: ${evidence.lint.exitCode}. Errors: ${evidence.lint.totalErrors}. Warnings: ${evidence.lint.totalWarnings}.`,
  `Top lint issues: ${evidence.lint.fileIssues.slice(0, 10).map((issue) => `${path.relative(repoRoot, issue.file)}:${issue.line} ${issue.severity} ${issue.rule}`).join('; ') || 'none'}.`,
].join(' ');

const serialized = JSON.stringify(evidence, null, 2);

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.log(`Wrote Bob review evidence to ${path.relative(repoRoot, outputPath)}`);
} else {
  console.log(serialized);
}