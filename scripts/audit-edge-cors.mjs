import fs from 'fs';
import path from 'path';

const base = 'supabase/functions';
const dirs = fs.readdirSync(base).filter(d => d !== '_shared');
const results = { noOptions: [], noCorAtAll: [], healthy: [] };

for (const d of dirs) {
  const f = path.join(base, d, 'index.ts');
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const hasOptions = src.includes('OPTIONS');
  const hasCors = src.includes('cors') || src.includes('_shared/cors');
  if (hasOptions && hasCors) { results.healthy.push(d); }
  else if (!hasOptions && hasCors) { results.noOptions.push(d); }
  else if (!hasOptions && !hasCors) { results.noCorAtAll.push(d); }
}

console.log(`\n✅ Healthy (OPTIONS + cors import): ${results.healthy.length}`);
console.log(`⚠️  Has cors import but missing OPTIONS: ${results.noOptions.length}`);
results.noOptions.forEach(n => console.log(`   - ${n}`));
console.log(`❌ No CORS at all: ${results.noCorAtAll.length}`);
results.noCorAtAll.forEach(n => console.log(`   - ${n}`));
