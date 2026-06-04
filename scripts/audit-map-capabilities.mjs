#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

async function read(relPath) {
  const abs = path.join(ROOT, relPath)
  const content = await fs.readFile(abs, 'utf8')
  return { relPath, abs, content }
}

function has(pattern, text) {
  return pattern.test(text)
}

function status(pass, details) {
  return { pass, details }
}

function buildTileProbeUrl(template) {
  if (!template) return ''
  return template
    .replace('{z}', '6')
    .replace('{x}', '39')
    .replace('{y}', '25')
    .replace('{s}', 'a')
}

async function probeTileEndpoint(url) {
  if (!url) return { attempted: false, pass: false, reason: 'no-url' }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'FieldOps-Map-Audit/1.0',
      },
    })
    clearTimeout(timeout)

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const ok = response.ok && (contentType.startsWith('image/') || contentType.includes('octet-stream'))

    return {
      attempted: true,
      pass: ok,
      status: response.status,
      contentType,
      reason: ok ? 'ok' : 'unexpected-response',
    }
  } catch (error) {
    return {
      attempted: true,
      pass: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const [
    inhouseMapping,
    operationsMap,
    geofenceEditor,
    patrolNavigation,
  ] = await Promise.all([
    read('src/lib/inhouseMapping.ts'),
    read('src/pages/OperationsMap.tsx'),
    read('src/components/features/ZoneGeofenceEditor.tsx'),
    read('src/pages/PatrolNavigation.tsx'),
  ])

  const sourceFiles = [
    inhouseMapping,
    operationsMap,
    geofenceEditor,
    patrolNavigation,
  ]

  const sourceText = sourceFiles.map((f) => f.content).join('\n')

  const configuredPrimaryTile = String(process.env.VITE_INHOUSE_MAP_TILE_URL || '').trim()
  const configuredFallbackTile = String(process.env.VITE_INHOUSE_MAP_FALLBACK_TILE_URL || '').trim()
  const configuredSatelliteTile = String(process.env.VITE_INHOUSE_MAP_SATELLITE_TILE_URL || '').trim()
  const effectivePrimaryTile = configuredPrimaryTile || configuredFallbackTile

  const streetMapCheck = status(
    has(/PRIMARY_MAP_TILE_URL/, inhouseMapping.content) &&
      has(/FALLBACK_MAP_TILE_URL/, inhouseMapping.content) &&
      !has(/tile\.openstreetmap\.org/, inhouseMapping.content) &&
      has(/MapContainer/, operationsMap.content) &&
      has(/TileLayer/, operationsMap.content),
    'Primary + fallback tile plumbing exists without hardcoded external street tile defaults.'
  )

  const trafficOverlayCheck = status(
    has(/HERE_TRAFFIC_URL/, operationsMap.content) &&
      has(/visibleLayers\.traffic/, operationsMap.content) &&
      has(/TileLayer/, operationsMap.content),
    'Traffic overlay layer is implemented with HERE-based URL and toggle support.'
  )

  const geofenceEditingCheck = status(
    has(/ZoneGeofenceEditor/, geofenceEditor.content) &&
      has(/tileerror:\s*applyFallbackTileLayer/, geofenceEditor.content) &&
      has(/configured internal fallback tiles/i, geofenceEditor.content),
    'Geofence editor map supports draw/edit and tile fallback on tile errors.'
  )

  const navigationCheck = status(
    has(/Patrol Navigation/, patrolNavigation.content) &&
      has(/Turn-by-Turn Directions/, patrolNavigation.content) &&
      has(/in_house_mapping_gateway|inbuilt-patrol-route-engine/, patrolNavigation.content),
    'Patrol navigation has turn-by-turn output and in-house provider/fallback routing.'
  )

  const internalOnlySatellite = !has(/services\.arcgisonline\.com|mapbox|google.*satellite/i, inhouseMapping.content)
  const internalOnlyStreet = !has(/tile\.openstreetmap\.org|openstreetmap\.org/i, inhouseMapping.content)
  const satelliteImplemented =
    has(/SATELLITE_MAP_TILE_URL/, inhouseMapping.content) &&
    has(/HAS_INTERNAL_SATELLITE_MAP_TILE/, inhouseMapping.content) &&
    has(/baseMapStyle/, operationsMap.content) &&
    has(/baseMapStyle/, geofenceEditor.content)
  const satelliteCheck = status(
    satelliteImplemented,
    satelliteImplemented
      ? 'Satellite layer support is implemented with internal-gated configuration.'
      : 'No satellite imagery layer implementation detected in key map sources.'
  )
  const internalSatellitePolicyCheck = status(
    internalOnlySatellite,
    internalOnlySatellite
      ? 'Satellite configuration is internal-only (no hardcoded external imagery fallback).'
      : 'External satellite fallback detected in mapping config.'
  )
  const internalSatelliteConfiguredCheck = status(
    configuredSatelliteTile.length > 0,
    configuredSatelliteTile.length > 0
      ? 'Internal satellite tile endpoint is configured via VITE_INHOUSE_MAP_SATELLITE_TILE_URL.'
      : 'Internal satellite tile endpoint is not configured; satellite option remains unavailable in UI.'
  )
  const internalStreetConfiguredCheck = status(
    effectivePrimaryTile.length > 0,
    effectivePrimaryTile.length > 0
      ? 'Internal street tile endpoint is configured via VITE_INHOUSE_MAP_TILE_URL or VITE_INHOUSE_MAP_FALLBACK_TILE_URL.'
      : 'No internal street tile endpoint is configured; maps will not load basemap tiles.'
  )
  const internalStreetPolicyCheck = status(
    internalOnlyStreet,
    internalOnlyStreet
      ? 'Street mapping configuration is internal-only (no hardcoded external fallback).'
      : 'External street fallback detected in mapping config.'
  )

  const tileProbeUrl = buildTileProbeUrl(effectivePrimaryTile)
  const tileProbe = await probeTileEndpoint(tileProbeUrl)

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      os: process.platform,
      node: process.version,
      cwd: ROOT,
    },
    mapCapabilities: {
      streetMapLayer: streetMapCheck,
      trafficOverlay: trafficOverlayCheck,
      geofenceEditor: geofenceEditingCheck,
      patrolNavigation: navigationCheck,
      satelliteView: satelliteCheck,
      streetInternalOnlyPolicy: internalStreetPolicyCheck,
      streetInternalConfigured: internalStreetConfiguredCheck,
      satelliteInternalOnlyPolicy: internalSatellitePolicyCheck,
      satelliteInternalConfigured: internalSatelliteConfiguredCheck,
    },
    tileProbe: {
      template: effectivePrimaryTile,
      probeUrl: tileProbeUrl,
      result: tileProbe,
    },
    summary: {
      overallPass:
        streetMapCheck.pass &&
        geofenceEditingCheck.pass &&
        navigationCheck.pass &&
        internalStreetConfiguredCheck.pass &&
        tileProbe.pass,
      satelliteImplemented: satelliteCheck.pass,
      streetInternalOnlyPolicy: internalStreetPolicyCheck.pass,
      streetConfigured: internalStreetConfiguredCheck.pass,
      satelliteInternalOnlyPolicy: internalSatellitePolicyCheck.pass,
      satelliteConfigured: internalSatelliteConfiguredCheck.pass,
      notes: [
        'overallPass covers street map visibility plumbing, tile endpoint response, geofence editor, and patrol navigation capability.',
        'street and satellite checks report internal-only policy and whether internal tile endpoints are configured.',
      ],
    },
  }

  const outDir = path.join(ROOT, 'data', 'e2e-test-results')
  await fs.mkdir(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(outDir, `map-capability-audit-${stamp}.json`)
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`report: ${outPath}\n`)

  if (!report.summary.overallPass) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[map-capability-audit] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
