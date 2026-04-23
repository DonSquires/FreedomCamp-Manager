#!/usr/bin/env node
/**
 * Load Production Geofences
 * 
 * Attempts to load enhanced jurisdiction data from production-geofences.json
 * with automatic fallback to default JURISDICTIONS if file is missing/invalid.
 * 
 * Usage: import { loadProductionJurisdictions } from './load-production-geofences.mjs'
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

const DEFAULT_JURISDICTIONS = [
  {
    layer: 1,
    type: 'jurisdiction',
    name: 'Tasman District Council',
    id: 'tasman-dc',
    region: 'Top of South Island',
    bounds: {
      north: -40.8,
      south: -41.6,
      east: 173.7,
      west: 172.2
    },
    polygon: [
      [-40.5000, 172.1000],
      [-40.5000, 173.5000],
      [-41.7500, 173.5000],
      [-41.7500, 172.1000],
    ],
    noiseLimit: 80,
    staffRatio: 200,
    seizureRule: 'immediate',
    rulesPath: 'docs/rules/tasman-dc.md',
    bylawRefs: {
      noise: 'Tasman District Council Excessive Noise Directions / RMA s327',
      freedomCamping: 'Tasman District Council Freedom Camping Bylaw 2015',
    },
  },
  {
    layer: 1,
    type: 'jurisdiction',
    name: 'Auckland Council',
    id: 'auckland-council',
    region: 'Auckland',
    bounds: {
      north: -36.5,
      south: -37.5,
      east: 175.5,
      west: 173.8
    },
    polygon: [
      [-36.2000, 174.1000],
      [-36.2000, 175.2000],
      [-37.2000, 175.2000],
      [-37.2000, 174.1000],
    ],
    noiseLimit: 75,
    staffRatio: 150,
    seizureRule: '2h-notice',
    rulesPath: 'docs/rules/auckland-council.md',
    bylawRefs: {
      noise: 'Auckland Council Noise Control Bylaw / RMA s327',
      freedomCamping: 'Auckland Council Freedom Camping Bylaw 2015',
    },
  },
];

/**
 * Load production geofences from production-geofences.json
 * Converts enhanced jurisdiction format to internal format with fallback
 */
export function loadProductionJurisdictions(verbose = false) {
  const prodPath = path.join(workspaceRoot, 'data', 'production-geofences.json');
  
  if (!fs.existsSync(prodPath)) {
    if (verbose) {
      console.log(`⚠️  Production geofences not found at ${prodPath}. Using default jurisdictions.`);
    }
    return DEFAULT_JURISDICTIONS;
  }

  try {
    const raw = fs.readFileSync(prodPath, 'utf-8');
    const data = JSON.parse(raw);
    
    if (!Array.isArray(data.jurisdictions)) {
      if (verbose) {
        console.log('⚠️  Invalid production geofences format. Using defaults.');
      }
      return DEFAULT_JURISDICTIONS;
    }

    const converted = data.jurisdictions.map(j => ({
      layer: 1,
      type: 'jurisdiction',
      name: j.council,
      id: j.id,
      region: j.region,
      bounds: j.bounds,
      polygon: j.polygon,
      noiseLimit: j.bylaws?.noise?.commercialLimit ?? 80,
      staffRatio: j.bylaws?.freedomCamping?.staffRatio ? 200 / j.bylaws.freedomCamping.staffRatio : 200,
      seizureRule: j.riskProfile?.seizureRule ?? 'notice',
      rulesPath: `docs/rules/${j.id}.md`,
      bylawRefs: {
        noise: `${j.council} Noise Bylaw / RMA s327`,
        freedomCamping: `${j.council} Freedom Camping Bylaw`,
      },
    }));

    if (verbose) {
      console.log(`✅ Loaded ${converted.length} jurisdictions from production geofences.`);
    }
    
    return converted;
  } catch (err) {
    if (verbose) {
      console.error(`❌ Error loading production geofences: ${err.message}. Using defaults.`);
    }
    return DEFAULT_JURISDICTIONS;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const jurisdictions = loadProductionJurisdictions(true);
  console.log(`\n📊 Loaded ${jurisdictions.length} jurisdictions:`);
  jurisdictions.forEach(j => {
    console.log(`   - ${j.name}`);
  });
}

export { DEFAULT_JURISDICTIONS };
