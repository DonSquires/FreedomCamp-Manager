/**
 * LiveNavigationOverlay
 *
 * Shows a compact navigation HUD when an officer has an active patrol or dispatch
 * job with a known destination. Displays bearing arrow, straight-line distance,
 * and estimated travel time based on an assumed average speed (no external routing
 * service required — works offline / with in-house tiles).
 *
 * For turn-by-turn routing, wire up Leaflet Routing Machine (leaflet-routing-machine)
 * once the in-house OSRM/OSM router endpoint is confirmed.
 */

import { useEffect, useRef, useState } from 'react'
import { Navigation, Clock, Ruler, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveNavDestination {
  lat: number
  lng: number
  label?: string
}

interface Props {
  destination: LiveNavDestination | null
  /** SLA deadline ISO string — when set, shows a countdown badge */
  slaDealine?: string | null
  /** Called when officer dismisses the overlay */
  onDismiss?: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVG_SPEED_KMH = 50 // assumed average travel speed for ETA calculation

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

function toDeg(rad: number) {
  return (rad * 180) / Math.PI
}

/** Haversine distance in km */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Compass bearing in degrees (0 = North) */
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h} h ${m} min` : `${h} h`
}

function slaCountdown(deadline: string): { text: string; urgent: boolean } {
  const ms = new Date(deadline).getTime() - Date.now()
  if (ms <= 0) return { text: 'OVERDUE', urgent: true }
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return { text: `${minutes} min to SLA`, urgent: minutes < 10 }
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return { text: `${h}h ${m}m to SLA`, urgent: false }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LiveNavigationOverlay({ destination, slaDealine, onDismiss }: Props) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)
  const watchId = useRef<number | null>(null)

  useEffect(() => {
    if (!destination) return

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => console.warn('LiveNavigation GPS error:', err),
      { enableHighAccuracy: true, maximumAge: 5000 },
    )

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
      }
    }
  }, [destination])

  if (!destination) return null

  const distKm = position
    ? haversineKm(position.lat, position.lng, destination.lat, destination.lng)
    : null
  const bearing = position
    ? bearingDeg(position.lat, position.lng, destination.lat, destination.lng)
    : null
  const etaMinutes = distKm !== null ? (distKm / AVG_SPEED_KMH) * 60 : null

  const sla = slaDealine ? slaCountdown(slaDealine) : null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-2rem)] max-w-sm">
      <div className="rounded-xl border border-border bg-ie-bg-elevated shadow-xl p-3 flex items-center gap-3">
        {/* Bearing arrow */}
        <div
          className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-ie-brand/20 border border-ie-brand"
          title={bearing !== null ? `Bearing: ${Math.round(bearing)}°` : 'Calculating…'}
        >
          <Navigation
            className="h-6 w-6 text-ie-brand transition-transform"
            style={{ transform: bearing !== null ? `rotate(${bearing}deg)` : 'none' }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1">
          {destination.label && (
            <p className="text-xs text-muted-foreground truncate">{destination.label}</p>
          )}
          <div className="flex items-center gap-3 text-sm font-medium">
            {distKm !== null ? (
              <span className="flex items-center gap-1">
                <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                {formatDistance(distKm)}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Locating…</span>
            )}
            {etaMinutes !== null && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                ETA {formatMinutes(etaMinutes)}
              </span>
            )}
          </div>
          {sla && (
            <Badge
              variant="outline"
              className={`text-xs ${sla.urgent ? 'border-red-500 text-red-400 animate-pulse' : 'border-yellow-500 text-yellow-400'}`}
            >
              {sla.text}
            </Badge>
          )}
        </div>

        {/* Dismiss */}
        {onDismiss && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 h-7 w-7"
            onClick={onDismiss}
            aria-label="Dismiss navigation"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
