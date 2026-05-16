#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const reportDir = path.join(__dirname, '../playwright-report');
const dataDir = path.join(reportDir, 'data');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║       PLAYWRIGHT TEST RESULTS ANALYZER                     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

if (!fs.existsSync(dataDir)) {
  console.error('❌ No playwright-report/data directory found');
  process.exit(1);
}

// Read markdown report
const mdFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.md'));
if (mdFiles.length === 0) {
  console.log('⏳ No test reports yet - tests may still be running');
  process.exit(0);
}

mdFiles.forEach((mdFile, idx) => {
  const content = fs.readFileSync(path.join(dataDir, mdFile), 'utf-8');
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Test Report ${idx + 1}/${mdFiles.length}`);
  console.log(`${'═'.repeat(60)}\n`);
  
  // Extract test name
  const nameMatch = content.match(/- Name: (.+)/);
  if (nameMatch) {
    console.log(`📝 Test: ${nameMatch[1].trim()}`);
  }
  
  // Extract error details
  const errorSection = content.match(/# Error details\n\n```\n([\s\S]+?)\n```/);
  if (errorSection) {
    console.log('\n❌ ERROR DETAILS:');
    console.log('─'.repeat(60));
    console.log(errorSection[1].substring(0, 500));
    if (errorSection[1].length > 500) {
      console.log('... (truncated)');
    }
  }
  
  // List all artifacts for this test
  console.log('\n📦 ARTIFACTS:');
  const webmFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.webm'));
  const pngFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.png'));
  
  if (webmFiles.length > 0) {
    console.log(`  🎥 Videos: ${webmFiles.length} file(s)`);
    webmFiles.forEach(f => {
      const stats = fs.statSync(path.join(dataDir, f));
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`     - ${f} (${sizeMB}MB)`);
    });
  }
  
  if (pngFiles.length > 0) {
    console.log(`  📸 Screenshots: ${pngFiles.length} file(s)`);
    pngFiles.forEach(f => {
      const stats = fs.statSync(path.join(dataDir, f));
      const sizeKB = (stats.size / 1024).toFixed(1);
      console.log(`     - ${f} (${sizeKB}KB)`);
    });
  }
  
  console.log('\n💾 TO VIEW FULL HTML REPORT:');
  console.log(`   npx playwright show-report`);
});

console.log(`\n${'═'.repeat(60)}\n`);

// Summary
const htmlIndex = path.join(reportDir, 'index.html');
if (fs.existsSync(htmlIndex)) {
  console.log('✅ Full HTML report available at: ./playwright-report/index.html');
  console.log('   Run: npx playwright show-report');
} else {
  console.log('⚠️  HTML report not yet generated');
}

console.log('\n');
