/**
 * useOfflineTileCache
 *
 * Downloads OpenStreetMap tiles for a geographic bounding box and stores them
 * in the Cache API so the Service Worker can serve them cache-first when the
 * device is offline (or in a rural area with poor connectivity).
 *
 * B-05 — Offline map tile download
 *
 * Tile coordinates follow the standard Mercator slippy-map convention:
 *   https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
 *
 * Safety limits:
 *  • Zoom range clamped to 10–15 (coarser zooms have too few tiles to matter;
 *    finer zooms create too many).
 *  • Hard cap of MAX_TILES (500) tiles per download to prevent quota abuse.
 *  • Batched fetches (BATCH_SIZE = 8) to avoid hammering the tile CDN.
 *
 * The hook communicates with the SW via postMessage for cache-size queries and
 * cache clearing; tile pre-population is done via the Cache API directly from
 * the page context so we have progress visibility.
 */

import { useState, useCallback, useRef } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────
const TILE_CACHE_NAME = 'fieldops-tiles-v1'
const OSM_SUBDOMAINS  = ['a', 'b', 'c']
const BATCH_SIZE      = 8     // concurrent fetches per batch
const MAX_TILES       = 500   // hard cap
const MIN_ZOOM_CLAMP  = 10
const MAX_ZOOM_CLAMP  = 15

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TileBounds {
  north: number
  south: number
  east:  number
  west:  number
}

export interface OfflineTileCacheState {
  isDownloading:    boolean
  downloaded:       number
  total:            number
  cachedTileCount:  number
  error:            string | null
  isSupported:      boolean
}

// ─── Tile math helpers ────────────────────────────────────────────────────────
/** Convert latitude/longitude to Mercator tile coordinates at zoom z. */
function latLngToTile(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = Math.pow(2, z)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return { x, y }
}

/** Returns every (x, y, z) tile within `bounds` at zoom `z`. */
function tilesForZoom(
  bounds: TileBounds,
  z: number,
): Array<{ x: number; y: number; z: number }> {
  const { x: x0, y: y0 } = latLngToTile(bounds.north, bounds.west, z)
  const { x: x1, y: y1 } = latLngToTile(bounds.south, bounds.east, z)

  const tiles: Array<{ x: number; y: number; z: number }> = []
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      tiles.push({ x, y, z })
    }
  }
  return tiles
}

/** Count tiles that would be downloaded (for UI preview). */
export function estimateTileCount(
  bounds: TileBounds,
  minZoom: number,
  maxZoom: number,
): number {
  const zMin = Math.max(minZoom, MIN_ZOOM_CLAMP)
  const zMax = Math.min(maxZoom, MAX_ZOOM_CLAMP)
  let count = 0
  for (let z = zMin; z <= zMax; z++) {
    count += tilesForZoom(bounds, z).length
  }
  return Math.min(count, MAX_TILES)
}

/** Build the OSM tile URL for a tile, rotating through subdomains. */
function tileUrl(x: number, y: number, z: number): string {
  const sub = OSM_SUBDOMAINS[(x + y) % OSM_SUBDOMAINS.length]
  return `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`
}

/** Fetch tiles in batches of BATCH_SIZE, writing each to the Cache. */
async function fetchTileBatch(
  tiles: Array<{ x: number; y: number; z: number }>,
  cache: Cache,
  onProgress: (done: number) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  let done = 0

  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    if (abortSignal.aborted) break

    const batch = tiles.slice(i, i + BATCH_SIZE)
    await Promise.allSettled(
      batch.map(async (t) => {
        if (abortSignal.aborted) return
        const url = tileUrl(t.x, t.y, t.z)
        try {
          // Skip if already cached
          const existing = await cache.match(url)
          if (existing) return

          const response = await fetch(url, { signal: abortSignal })
          if (response.ok) {
            await cache.put(url, response)
          }
        } catch {
          // Ignore individual tile failures (network errors, CORS, abort)
        } finally {
          done++
          onProgress(done)
        }
      }),
    )
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useOfflineTileCache() {
  const [state, setState] = useState<OfflineTileCacheState>({
    isDownloading:   false,
    downloaded:      0,
    total:           0,
    cachedTileCount: 0,
    error:           null,
    isSupported:     typeof caches !== 'undefined',
  })

  const abortRef = useRef<AbortController | null>(null)

  // ── Refresh cached tile count (via SW if available, else Cache API directly)
  const refreshCachedCount = useCallback(async () => {
    if (typeof caches === 'undefined') return
    try {
      const cache = await caches.open(TILE_CACHE_NAME)
      const keys  = await cache.keys()
      setState(s => ({ ...s, cachedTileCount: keys.length }))
    } catch {
      // ignore
    }
  }, [])

  // ── Download tiles for a bounding box ─────────────────────────────────────
  const downloadTilesForBounds = useCallback(
    async (bounds: TileBounds, minZoom = 12, maxZoom = 14): Promise<void> => {
      if (typeof caches === 'undefined') {
        setState(s => ({ ...s, error: 'Cache API not supported in this browser' }))
        return
      }

      // Collect all tiles across zoom levels, cap at MAX_TILES
      const zMin = Math.max(minZoom, MIN_ZOOM_CLAMP)
      const zMax = Math.min(maxZoom, MAX_ZOOM_CLAMP)

      let allTiles: Array<{ x: number; y: number; z: number }> = []
      for (let z = zMin; z <= zMax; z++) {
        allTiles = [...allTiles, ...tilesForZoom(bounds, z)]
      }
      allTiles = allTiles.slice(0, MAX_TILES)

      const total = allTiles.length
      if (total === 0) {
        setState(s => ({ ...s, error: 'No tiles in bounds' }))
        return
      }

      // Cancel any previous download
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setState(s => ({
        ...s,
        isDownloading: true,
        downloaded:    0,
        total,
        error:         null,
      }))

      try {
        const cache = await caches.open(TILE_CACHE_NAME)

        await fetchTileBatch(
          allTiles,
          cache,
          (done) => setState(s => ({ ...s, downloaded: done })),
          controller.signal,
        )

        const keys = await cache.keys()
        setState(s => ({
          ...s,
          isDownloading:   false,
          downloaded:      total,
          cachedTileCount: keys.length,
          error:           null,
        }))
      } catch (err: any) {
        setState(s => ({
          ...s,
          isDownloading: false,
          error:         err?.message ?? 'Download failed',
        }))
      }
    },
    [],
  )

  // ── Cancel an in-progress download ────────────────────────────────────────
  const cancelDownload = useCallback(() => {
    abortRef.current?.abort()
    setState(s => ({ ...s, isDownloading: false }))
  }, [])

  // ── Clear all cached tiles ─────────────────────────────────────────────────
  const clearTileCache = useCallback(async () => {
    if (typeof caches === 'undefined') return
    try {
      await caches.delete(TILE_CACHE_NAME)
      setState(s => ({ ...s, cachedTileCount: 0 }))
      // Also inform SW so it can re-open a fresh empty cache
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_TILE_CACHE' })
    } catch (err: any) {
      setState(s => ({ ...s, error: err?.message ?? 'Failed to clear cache' }))
    }
  }, [])

  return {
    state,
    downloadTilesForBounds,
    cancelDownload,
    clearTileCache,
    refreshCachedCount,
    estimateTileCount,
  }
}
