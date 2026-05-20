#!/usr/bin/env node
/**
 * Pre-commit Git Hook
 * Runs spatial intelligence integration tests before allowing commits
 * 
 * Install: cp scripts/pre-commit.mjs .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
 * Or: npm run setup:precommit-hooks
 */

import { spawn } from 'child_process';
import process from 'process';

function runCommand(cmd, args, cwd = process.cwd()) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => resolve(code));
  });
}

async function main() {
  console.log('🔍 Pre-commit: Running spatial intelligence tests...\n');

  const testCode = await runCommand('npm', ['run', 'bob:test:spatial']);

  if (testCode !== 0) {
    console.error('\n❌ Tests failed. Commit blocked.\n');
    console.error('   Fix the failing tests and try again.');
    console.error('   Run: npm run bob:test:spatial:watch\n');
    process.exit(1);
  }

  console.log('\n✅ All tests passed. Proceeding with commit.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
