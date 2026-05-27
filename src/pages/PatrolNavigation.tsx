/**
 * PatrolNavigation — B-31
 *
 * In-app turn-by-turn navigation for patrol officers.
 *
 * Uses the in-house mapping gateway route planner to calculate a
 * driving route from the officer's current GPS position (or a manual origin)
 * to a destination zone or custom coordinates.
 *
 * Features:
 *   - GPS location acquisition (browser Geolocation API)
 *   - Destination picker: active patrol zone OR custom lat/lng
 *   - In-house route fetch with step-by-step guidance
 *   - Route summary: distance (km) + duration (min)
 *   - Step list with manoeuvre icons and distance per step
 *   - Copy in-house route target
 *   - Graceful offline / gateway error handling with local deterministic fallback
 */

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Navigation2,
  MapPin,
  Loader2,
  ArrowUpRight,
  RotateCcw,
  Copy,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

type ZoneRow = Pick<
  Database['public']['Tables']['zones']['Row'],
  'id' | 'name' | 'location_lat' | 'location_lng'
>

// ─── In-house route types ─────────────────────────────────────────────────────

interface RouteStep {
  distance: number          // metres
  duration: number          // seconds
  name: string
  maneuver: {
    type: string            // 'turn', 'depart', 'arrive', 'merge', etc.
    modifier?: string       // 'left', 'right', 'straight', 'uturn', etc.
  }
}

interface NavigationRoute {
  distance: number  // metres total
  duration: number  // seconds total
  legs: Array<{ steps: RouteStep[] }>
}

interface InHouseWaypoint {
  lat: number
  lng: number
  label?: string
}

interface InHouseRoutePlanResponse {
  status?: string
  provider?: string
  orderedWaypoints?: InHouseWaypoint[]
  route?: {
    estimatedDistanceKm?: number
    legs?: Array<{
      from?: InHouseWaypoint
      to?: InHouseWaypoint
      distanceKm?: number
    }>
  }
  support?: {
    google?: {
      estimatedDriveDurationMin?: number
      note?: string
    }
  }
  error?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INHOUSE_ROUTE_PLAN_BASE = (import.meta.env.VITE_MAPPING_GATEWAY_URL as string | undefined)?.trim() || '/mapping-gateway'
const INHOUSE_AVG_SPEED_KMH = 45

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

function formatDuration(s: number): string {
  const mins = Math.round(s / 60)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function maneuverIcon(type: string, modifier?: string): string {
  if (type === 'depart') return '▶'
  if (type === 'arrive') return '🏁'
  if (type === 'roundabout' || type === 'rotary') return '🔄'
  if (modifier === 'left') return '←'
  if (modifier === 'sharp left') return '⬅'
  if (modifier === 'right') return '→'
  if (modifier === 'sharp right') return '➡'
  if (modifier === 'uturn') return '↩'
  return '↑'
}

function estimateDurationSeconds(distanceMeters: number): number {
  const distanceKm = distanceMeters / 1000
  const hours = distanceKm / INHOUSE_AVG_SPEED_KMH
  return Math.max(60, Math.round(hours * 3600))
}

function buildLocalFallbackRoute(origin: InHouseWaypoint, destination: InHouseWaypoint): NavigationRoute {
  const dLat = destination.lat - origin.lat
  const dLng = destination.lng - origin.lng
  const distanceMeters = Math.max(1, Math.round(Math.sqrt((dLat * dLat) + (dLng * dLng)) * 111_000))
  const duration = estimateDurationSeconds(distanceMeters)

  return {
    distance: distanceMeters,
    duration,
    legs: [{
      steps: [
        {
          distance: distanceMeters,
          duration,
          name: destination.label || `${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}`,
          maneuver: { type: 'depart' },
        },
        {
          distance: 0,
          duration: 0,
          name: destination.label || 'Destination',
          maneuver: { type: 'arrive' },
        },
      ],
    }],
  }
}

function normalizeInHouseRoute(payload: InHouseRoutePlanResponse): NavigationRoute | null {
  const waypoints = payload.orderedWaypoints ?? []
  if (waypoints.length < 2) return null

  const rawLegs = payload.route?.legs ?? []
  const steps: RouteStep[] = rawLegs.map((leg, index) => {
    const distanceMeters = Math.max(1, Math.round((leg.distanceKm ?? 0) * 1000))
    const estimatedDuration = estimateDurationSeconds(distanceMeters)
    const targetLabel = leg.to?.label || `${leg.to?.lat?.toFixed?.(5) ?? ''}, ${leg.to?.lng?.toFixed?.(5) ?? ''}`

    return {
      distance: distanceMeters,
      duration: estimatedDuration,
      name: targetLabel,
      maneuver: { type: index === 0 ? 'depart' : 'turn' },
    }
  })

  if (steps.length === 0) {
    return null
  }

  const estimatedDistanceMeters = Math.max(1, Math.round((payload.route?.estimatedDistanceKm ?? 0) * 1000))
  const supportDurationSeconds = payload.support?.google?.estimatedDriveDurationMin
    ? Math.max(60, Math.round(payload.support.google.estimatedDriveDurationMin * 60))
    : null
  const totalDurationSeconds = supportDurationSeconds ?? steps.reduce((sum, step) => sum + step.duration, 0)

  return {
    distance: estimatedDistanceMeters,
    duration: totalDurationSeconds,
    legs: [{
      steps: [
        ...steps,
        {
          distance: 0,
          duration: 0,
          name: waypoints[waypoints.length - 1]?.label || 'Destination',
          maneuver: { type: 'arrive' },
        },
      ],
    }],
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatrolNavigation() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  // Origin
  const [originMode, setOriginMode] = useState<'gps' | 'manual'>('gps')
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [manualOrigin, setManualOrigin] = useState('')  // "lat,lng" string

  // Destination
  const [destMode, setDestMode] = useState<'zone' | 'custom'>('zone')
  const [selectedZoneId, setSelectedZoneId] = useState('')
  const [customDest, setCustomDest] = useState('')  // "lat,lng"

  // Route
  const [route, setRoute] = useState<NavigationRoute | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeProvider, setRouteProvider] = useState('')

  // ── Zone data ──────────────────────────────────────────────────────────────
  const { data: zones = [] } = useQuery<ZoneRow[]>({
    queryKey: ['zones-nav', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('zones')
        .select('id, name, location_lat, location_lng')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .not('location_lat', 'is', null)
        .not('location_lng', 'is', null)
        .order('name')
      return (data ?? []) as unknown as ZoneRow[]
    },
    enabled: !!orgId,
  })

  // ── GPS handler ────────────────────────────────────────────────────────────
  const acquireGPS = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported in this browser')
      return
    }
    setGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsStatus('ok')
      },
      () => {
        setGpsStatus('error')
        toast.error('Could not get GPS location. Try manual input.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  // ── Route fetch ────────────────────────────────────────────────────────────
  async function calculateRoute() {
    setRouteError(null)
    setRoute(null)
    setRouteProvider('')

    // Resolve origin
    let originLat: number, originLng: number
    if (originMode === 'gps') {
      if (!gpsCoords) { toast.error('Acquire GPS location first'); return }
      originLat = gpsCoords.lat
      originLng = gpsCoords.lng
    } else {
      const [lat, lng] = manualOrigin.split(',').map(Number)
      if (isNaN(lat) || isNaN(lng)) { toast.error('Invalid origin coordinates (format: lat,lng)'); return }
      originLat = lat
      originLng = lng
    }

    // Resolve destination
    let destLat: number, destLng: number
    if (destMode === 'zone') {
      const zone = zones.find(z => z.id === selectedZoneId)
      if (!zone?.location_lat || !zone?.location_lng) { toast.error('Select a zone with GPS coordinates'); return }
      destLat = zone.location_lat
      destLng = zone.location_lng
    } else {
      const [lat, lng] = customDest.split(',').map(Number)
      if (isNaN(lat) || isNaN(lng)) { toast.error('Invalid destination coordinates (format: lat,lng)'); return }
      destLat = lat
      destLng = lng
    }

    setRouteLoading(true)
    try {
      const origin: InHouseWaypoint = {
        lat: originLat,
        lng: originLng,
        label: 'Current position',
      }
      const destination: InHouseWaypoint = {
        lat: destLat,
        lng: destLng,
        label: destMode === 'zone'
          ? (zones.find((z) => z.id === selectedZoneId)?.name || 'Patrol zone')
          : 'Custom destination',
      }

      const routePlanUrl = `${INHOUSE_ROUTE_PLAN_BASE.replace(/\/+$/, '')}/route-plan`
      const response = await fetch(routePlanUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          waypoints: [origin, destination],
          includeTraffic: true,
        }),
      })

      if (!response.ok) {
        throw new Error('In-house mapping gateway request failed')
      }

      const payload = (await response.json()) as InHouseRoutePlanResponse
      const normalized = normalizeInHouseRoute(payload)

      if (!normalized) {
        throw new Error(payload.error || 'No route returned by in-house mapping gateway')
      }

      setRoute(normalized)
      setRouteProvider(payload.provider || 'in_house_mapping_gateway')
    } catch {
      // Deterministic in-app fallback to keep patrol navigation operational if the gateway is unavailable.
      let fallbackOrigin: InHouseWaypoint | null = null
      let fallbackDestination: InHouseWaypoint | null = null

      if (originMode === 'gps' && gpsCoords) {
        fallbackOrigin = { lat: gpsCoords.lat, lng: gpsCoords.lng, label: 'Current position' }
      } else if (originMode === 'manual') {
        const [lat, lng] = manualOrigin.split(',').map(Number)
        if (!isNaN(lat) && !isNaN(lng)) {
          fallbackOrigin = { lat, lng, label: 'Manual origin' }
        }
      }

      if (destMode === 'zone') {
        const zone = zones.find((z) => z.id === selectedZoneId)
        if (zone?.location_lat && zone?.location_lng) {
          fallbackDestination = { lat: zone.location_lat, lng: zone.location_lng, label: zone.name }
        }
      } else {
        const [lat, lng] = customDest.split(',').map(Number)
        if (!isNaN(lat) && !isNaN(lng)) {
          fallbackDestination = { lat, lng, label: 'Custom destination' }
        }
      }

      if (fallbackOrigin && fallbackDestination) {
        setRoute(buildLocalFallbackRoute(fallbackOrigin, fallbackDestination))
        setRouteProvider('inbuilt-patrol-route-engine')
        toast.warning('Using in-app fallback routing while gateway is unavailable')
      } else {
        setRouteError('Failed to calculate route using in-house mapping. Check connectivity and coordinates.')
      }
    } finally {
      setRouteLoading(false)
    }
  }

  function copyInHouseMapTarget() {
    let lat: number | null = null
    let lng: number | null = null

    if (destMode === 'zone') {
      const destZone = zones.find((z) => z.id === selectedZoneId)
      lat = destZone?.location_lat ?? null
      lng = destZone?.location_lng ?? null
    } else {
      const [parsedLat, parsedLng] = customDest.split(',').map(Number)
      if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
        lat = parsedLat
        lng = parsedLng
      }
    }

    if (lat == null || lng == null) {
      toast.error('No destination selected')
      return
    }

    const url = `${window.location.origin}/operations-map?focus=${lat.toFixed(5)},${lng.toFixed(5)}`
    navigator.clipboard.writeText(url).then(() => toast.success('In-house map target copied'))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const steps = route?.legs.flatMap(l => l.steps) ?? []

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-md mx-auto">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Navigation2 className="h-6 w-6 text-primary" />
            Patrol Navigation
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Get turn-by-turn driving directions to a patrol zone
          </p>
        </div>

        {/* Origin */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Origin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3">
              {(['gps', 'manual'] as const).map(mode => (
                <label key={mode} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input
                    type="radio"
                    checked={originMode === mode}
                    onChange={() => setOriginMode(mode)}
                  />
                  {mode === 'gps' ? 'Use GPS' : 'Enter coordinates'}
                </label>
              ))}
            </div>
            {originMode === 'gps' ? (
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" onClick={acquireGPS} disabled={gpsStatus === 'loading'}>
                  {gpsStatus === 'loading'
                    ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    : <Navigation2 className="h-4 w-4 mr-1.5" />}
                  Get GPS location
                </Button>
                {gpsStatus === 'ok' && gpsCoords && (
                  <div className="flex items-center gap-1.5 text-xs text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {gpsCoords.lat.toFixed(5)}, {gpsCoords.lng.toFixed(5)}
                  </div>
                )}
                {gpsStatus === 'error' && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Location unavailable
                  </div>
                )}
              </div>
            ) : (
              <div>
                <Label className="text-xs">Coordinates (lat,lng)</Label>
                <Input
                  value={manualOrigin}
                  onChange={e => setManualOrigin(e.target.value)}
                  placeholder="-36.8509,174.7645"
                  className="mt-1 font-mono text-sm"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Destination */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Destination</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3">
              {(['zone', 'custom'] as const).map(mode => (
                <label key={mode} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input
                    type="radio"
                    checked={destMode === mode}
                    onChange={() => setDestMode(mode)}
                  />
                  {mode === 'zone' ? 'Patrol zone' : 'Custom coordinates'}
                </label>
              ))}
            </div>
            {destMode === 'zone' ? (
              <Select value={selectedZoneId} onValueChange={setSelectedZoneId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select patrol zone…" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {z.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div>
                <Label className="text-xs">Coordinates (lat,lng)</Label>
                <Input
                  value={customDest}
                  onChange={e => setCustomDest(e.target.value)}
                  placeholder="-36.9100,174.8300"
                  className="mt-1 font-mono text-sm"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={calculateRoute}
            disabled={routeLoading}
            className="flex-1"
          >
            {routeLoading
              ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              : <ArrowUpRight className="h-4 w-4 mr-1.5" />}
            Get Directions
          </Button>
          {route && (
            <Button variant="outline" onClick={() => { setRoute(null); setRouteError(null) }}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          {((destMode === 'zone' && selectedZoneId) || (destMode === 'custom' && customDest.trim().length > 0)) && (
            <Button variant="outline" onClick={copyInHouseMapTarget} title="Copy in-house map target">
              <Copy className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Error */}
        {routeError && (
          <Card className="border-destructive">
            <CardContent className="pt-4 flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="text-sm">{routeError}</p>
            </CardContent>
          </Card>
        )}

        {/* Route summary + steps */}
        {route && (
          <>
            <Card className="border-primary">
              <CardContent className="pt-4 flex gap-6">
                <div>
                  <p className="text-2xl font-bold">{formatDist(route.distance)}</p>
                  <p className="text-xs text-muted-foreground">Total distance</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatDuration(route.duration)}</p>
                  <p className="text-xs text-muted-foreground">Estimated drive time</p>
                </div>
                {routeProvider && (
                  <div>
                    <p className="text-sm font-semibold">In-house map provider</p>
                    <p className="text-xs text-muted-foreground font-mono">{routeProvider}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Turn-by-Turn Directions</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ol className="divide-y">
                  {steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="text-lg w-6 text-center shrink-0 mt-0.5">
                        {maneuverIcon(step.maneuver.type, step.maneuver.modifier)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {step.maneuver.type === 'depart' ? 'Depart' : step.maneuver.type === 'arrive' ? 'Arrive at destination' : step.name || 'Continue'}
                        </p>
                        {step.maneuver.modifier && step.maneuver.type !== 'depart' && step.maneuver.type !== 'arrive' && (
                          <p className="text-xs text-muted-foreground capitalize">Turn {step.maneuver.modifier}</p>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{formatDist(step.distance)}</Badge>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  )
}
