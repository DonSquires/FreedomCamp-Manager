/**
 * OfflineTileControl
 *
 * A compact UI control for downloading map tiles for offline use (B-05).
 * Renders a popover button that lets the user:
 *   • See how many tiles are already cached
 *   • Estimate how many tiles a download would add
 *   • Start / cancel a download for the current map viewport
 *   • Clear the tile cache
 *
 * Usage:
 *   <OfflineTileControl bounds={mapBounds} />
 *
 * where `bounds` is the current map viewport (or a fixed patrol zone bounds).
 */

import { useEffect, useState } from 'react'
import { WifiOff, Download, X, Trash2, Map } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { useOfflineTileCache, estimateTileCount } from '@/hooks/useOfflineTileCache'
import type { TileBounds } from '@/hooks/useOfflineTileCache'

interface OfflineTileControlProps {
  /** Bounding box of the area to cache. Defaults to wider NZ map if not provided. */
  bounds?: TileBounds
  /** Zoom levels to cache (default: 12–14) */
  minZoom?: number
  maxZoom?: number
  className?: string
}

// Default bounds: greater Auckland / Hamilton / Tauranga corridor (most NZ patrol areas)
const DEFAULT_BOUNDS: TileBounds = {
  north: -36.3,
  south: -37.9,
  east:  175.8,
  west:  174.5,
}

export function OfflineTileControl({
  bounds,
  minZoom = 12,
  maxZoom = 14,
  className = '',
}: OfflineTileControlProps) {
  const effectiveBounds = bounds ?? DEFAULT_BOUNDS

  const {
    state,
    downloadTilesForBounds,
    cancelDownload,
    clearTileCache,
    refreshCachedCount,
  } = useOfflineTileCache()

  const [open, setOpen] = useState(false)

  // Refresh cached tile count on mount and when popover opens
  useEffect(() => {
    if (open) refreshCachedCount()
  }, [open, refreshCachedCount])

  const estimate = estimateTileCount(effectiveBounds, minZoom, maxZoom)

  const progressPct = state.total > 0
    ? Math.round((state.downloaded / state.total) * 100)
    : 0

  const approxMB = (state.cachedTileCount * 25 / 1024).toFixed(1)

  if (!state.isSupported) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`gap-1.5 ${className}`}
          title="Offline map tile cache"
        >
          <WifiOff className="h-3.5 w-3.5" />
          {state.cachedTileCount > 0 && (
            <span className="text-[10px] text-green-600 font-medium">
              {state.cachedTileCount}
            </span>
          )}
          <span className="hidden sm:inline">Offline</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-4 space-y-3" align="end">
        {/* Header */}
        <div className="flex items-start gap-2">
          <Map className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Offline Map Tiles</p>
            <p className="text-xs text-muted-foreground">
              Pre-download tiles for rural / no-signal patrol areas.
            </p>
          </div>
        </div>

        {/* Cache status */}
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs space-y-0.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tiles cached</span>
            <span className="font-medium">{state.cachedTileCount.toLocaleString()}</span>
          </div>
          {state.cachedTileCount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Approx. size</span>
              <span className="font-medium">~{approxMB} MB</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">This area (zoom {minZoom}–{maxZoom})</span>
            <span className="font-medium">{estimate} tiles</span>
          </div>
        </div>

        {/* Download progress */}
        {state.isDownloading && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Downloading…</span>
              <span className="font-medium">{state.downloaded} / {state.total}</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        )}

        {/* Error */}
        {state.error && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {state.isDownloading ? (
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={cancelDownload}
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => downloadTilesForBounds(effectiveBounds, minZoom, maxZoom)}
              disabled={estimate === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Download {estimate} tiles
            </Button>
          )}

          {state.cachedTileCount > 0 && !state.isDownloading && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearTileCache}
              title="Clear tile cache"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          Tiles are served from cache when offline. OSM tiles © OpenStreetMap contributors.
        </p>
      </PopoverContent>
    </Popover>
  )
}
