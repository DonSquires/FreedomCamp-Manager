#!/usr/bin/env node
/**
 * GeoJSON to Polygon Converter
 * Converts LINZ GeoJSON boundary data to our internal polygon format
 * 
 * Usage: node scripts/geojson-to-polygon-converter.mjs <input.geojson> [--output FILE]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

/**
 * Extract ring coordinates from GeoJSON geometry
 * Handles Polygon and MultiPolygon types
 */
function extractPolygonRings(geometry) {
  if (!geometry) return [];

  const rings = [];

  if (geometry.type === 'Polygon') {
    // Polygon has exterior ring (index 0) + holes (indices 1+)
    // We typically want just the exterior ring (first element)
    if (geometry.coordinates && geometry.coordinates.length > 0) {
      const exterior = geometry.coordinates[0];
      // Swap [lng, lat] to [lat, lng] for our format
      const ring = exterior.map(([lng, lat]) => [lat, lng]);
      rings.push(ring);
    }
  } else if (geometry.type === 'MultiPolygon') {
    // MultiPolygon: array of Polygons
    if (geometry.coordinates) {
      geometry.coordinates.forEach(polygon => {
        if (polygon && polygon.length > 0) {
          const exterior = polygon[0];
          const ring = exterior.map(([lng, lat]) => [lat, lng]);
          rings.push(ring);
        }
      });
    }
  }

  return rings;
}

/**
 * Calculate bounding box from a polygon ring
 */
function calculateBounds(ring) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  ring.forEach(([lat, lng]) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  });

  return {
    north: maxLat,
    south: minLat,
    east: maxLng,
    west: minLng
  };
}

/**
 * Extract council name and format as ID
 */
function nameToId(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/([^a-z0-9-])/g, '')
    .replace(/-+/g, '-');
}

/**
 * Convert GeoJSON features to our internal format
 */
function convertGeoJSON(geojsonData) {
  if (!geojsonData.features || !Array.isArray(geojsonData.features)) {
    throw new Error('Invalid GeoJSON: missing features array');
  }

  const jurisdictions = [];

  geojsonData.features.forEach(feature => {
    const properties = feature.properties || {};
    const name = properties.name || properties.NAME || 'Unknown Council';
    
    const rings = extractPolygonRings(feature.geometry);
    
    if (rings.length === 0) {
      console.warn(`⚠️  No valid rings extracted from feature: ${name}`);
      return;
    }

    // Use largest ring (in case of MultiPolygon)
    const mainRing = rings[0];
    const bounds = calculateBounds(mainRing);

    const jurisdiction = {
      id: nameToId(name),
      council: name,
      region: properties.region || properties.REGION || 'New Zealand',
      bounds,
      polygon: mainRing,
      bylaws: {
        freedomCamping: {
          prohibited: true,
          exemptions: [],
          enforcementOfficers: 1.0,
          staffRatio: 1
        },
        noise: {
          commercialLimit: 80,
          residentialLimit: 75,
          enforcementThreshold: 85
        }
      },
      riskProfile: {
        seizureRule: 'notice',
        towing: true,
        occupantRemoval: false
      }
    };

    jurisdictions.push(jurisdiction);
  });

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    source: 'LINZ GeoJSON',
    jurisdictions
  };
}

async function main() {
  const inputFile = process.argv[2];
  const outputArg = process.argv.find(arg => arg.startsWith('--output='));
  const outputFile = outputArg ? outputArg.split('=')[1] : null;

  if (!inputFile) {
    console.error('Usage: node scripts/geojson-to-polygon-converter.mjs <input.geojson> [--output FILE]');
    process.exit(1);
  }

  try {
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }

    console.log(`📂 Reading GeoJSON: ${inputFile}`);
    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const geojsonData = JSON.parse(rawData);

    console.log(`🔄 Converting ${geojsonData.features?.length || 0} features...`);
    const result = convertGeoJSON(geojsonData);

    const outPath = outputFile || path.join(WORKSPACE_ROOT, 'data', 'geofences-from-geojson.json');
    const outDir = path.dirname(outPath);
    
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    
    console.log(`\n✅ Conversion complete: ${outPath}`);
    console.log(`📍 Jurisdictions extracted: ${result.jurisdictions.length}`);
    console.log(`\n⚙️  Next steps:`);
    console.log(`   1. Review ${outPath} for accuracy`);
    console.log(`   2. Update bylaw details for each jurisdiction`);
    console.log(`   3. Load into spatial-intelligence-engine.mjs`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { convertGeoJSON, extractPolygonRings, calculateBounds };
