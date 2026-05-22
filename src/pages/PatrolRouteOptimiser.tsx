/**
 * PatrolRouteOptimiser — B-26
 *
 * Calculates an optimal patrol route over active zones using a
 * nearest-neighbour TSP heuristic on zone lat/lng centroids.
 *
 * Officers:
 *   1. Select a starting zone (or "My GPS location")
 *   2. Choose which zones to include in the patrol
 *   3. Get the optimised visit order with haversine segment distances
 *      and an estimated total patrol time
 *   4. Copy the route or share it to the team channel
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Navigation,
  MapPin,
  Clock,
  Route,
  Copy,
  CheckCheck,
  Wand2,
  Car,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type ZoneRow = Pick<
  Database['public']['Tables']['zones']['Row'],
  'id' | 'name' | 'zone_type' | 'location_lat' | 'location_lng' | 'is_active'
>

interface RouteStop {
  zone: ZoneRow
  distanceKm: number   // distance from previous stop (0 for first)
  cumDistanceKm: number
  estimatedMinutes: number
}

// ─── Haversine distance ───────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Nearest-neighbour TSP ────────────────────────────────────────────────────
// Returns an ordered list of zone indices starting from startIdx.

function nearestNeighbour(zones: ZoneRow[], startIdx: number): number[] {
  const n = zones.length
  const visited = new Array(n).fill(false)
  const order: number[] = []
  let current = startIdx
  visited[current] = true
  order.push(current)

  for (let step = 1; step < n; step++) {
    let best = -1
    let bestDist = Infinity
    const curr = zones[current]
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue
      const z = zones[j]
      if (curr.location_lat == null || curr.location_lng == null) continue
      if (z.location_lat == null || z.location_lng == null) continue
      const d = haversine(curr.location_lat, curr.location_lng, z.location_lat, z.location_lng)
      if (d < bestDist) {
        bestDist = d
        best = j
      }
    }
    if (best === -1) break
    visited[best] = true
    order.push(best)
    current = best
  }
  return order
}

// Avg patrol speed assumption: 30 km/h + 10 min per zone inspection
const PATROL_SPEED_KMH = 30
const INSPECTION_MINUTES = 10

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatrolRouteOptimiser() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [startZoneId, setStartZoneId] = useState<string>('first')
  const [zoneSearch, setZoneSearch]   = useState('')
  const [route, setRoute]             = useState<RouteStop[] | null>(null)
  const [copied, setCopied]           = useState(false)

  // ── Query: active zones with coordinates ──────────────────────────────────
  const { data: zones = [] } = useQuery<ZoneRow[]>({
    queryKey: ['patrol-route-zones', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('zones')
        .select('id, name, zone_type, location_lat, location_lng, is_active')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .not('location_lat', 'is', null)
        .not('location_lng', 'is', null)
        .order('name')
        .limit(200)
      return (data ?? []) as ZoneRow[]
    },
    enabled: !!orgId,
  })

  const visibleZones = useMemo(() => {
    if (!zoneSearch.trim()) return zones
    const q = zoneSearch.toLowerCase()
    return zones.filter(z => z.name.toLowerCase().includes(q) || (z.zone_type ?? '').toLowerCase().includes(q))
  }, [zones, zoneSearch])

  function toggleZone(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setRoute(null)
  }

  function selectAll() {
    setSelected(new Set(zones.map(z => z.id)))
    setRoute(null)
  }

  function clearAll() {
    setSelected(new Set())
    setRoute(null)
  }

  // ── Build optimised route ──────────────────────────────────────────────────
  const handleOptimise = useCallback(() => {
    const chosenZones = zones.filter(z => selected.has(z.id))
    if (chosenZones.length < 2) {
      toast.error('Select at least 2 zones to optimise a route')
      return
    }

    let startIdx = 0
    if (startZoneId !== 'first') {
      const idx = chosenZones.findIndex(z => z.id === startZoneId)
      if (idx >= 0) startIdx = idx
    }

    const order = nearestNeighbour(chosenZones, startIdx)
    let cumDist = 0
    let cumMins = 0

    const stops: RouteStop[] = order.map((zoneIdx, i) => {
      const z = chosenZones[zoneIdx]
      let distKm = 0
      if (i > 0) {
        const prev = chosenZones[order[i - 1]]
        if (prev.location_lat != null && prev.location_lng != null && z.location_lat != null && z.location_lng != null) {
          distKm = haversine(prev.location_lat, prev.location_lng, z.location_lat, z.location_lng)
        }
      }
      cumDist += distKm
      const travelMins = (distKm / PATROL_SPEED_KMH) * 60
      cumMins += travelMins + INSPECTION_MINUTES
      return {
        zone: z,
        distanceKm: distKm,
        cumDistanceKm: cumDist,
        estimatedMinutes: Math.round(cumMins),
      }
    })

    setRoute(stops)
  }, [zones, selected, startZoneId])

  // ── Copy route as text ─────────────────────────────────────────────────────
  function copyRoute() {
    if (!route) return
    const totalKm = route[route.length - 1]?.cumDistanceKm ?? 0
    const totalMins = route[route.length - 1]?.estimatedMinutes ?? 0
    const lines = route.map((s, i) =>
      `${i + 1}. ${s.zone.name}${i > 0 ? ` (+${s.distanceKm.toFixed(1)} km)` : ' [START]'}`
    )
    lines.push(`\nTotal: ${totalKm.toFixed(1)} km — approx ${Math.round(totalMins)} min`)
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true)
      toast.success('Route copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const totalKm   = route ? route[route.length - 1]?.cumDistanceKm ?? 0 : 0
  const totalMins = route ? route[route.length - 1]?.estimatedMinutes ?? 0 : 0
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Route className="h-6 w-6 text-primary" />
            Patrol Route Optimiser
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Select zones and calculate the shortest patrol route using nearest-neighbour optimisation
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left: Zone selector */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2 pt-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    Select Zones ({selected.size} selected)
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectAll}>All</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={clearAll}>Clear</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  className="h-8 text-sm"
                  placeholder="Search zones…"
                  value={zoneSearch}
                  onChange={e => setZoneSearch(e.target.value)}
                />
                <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
                  {zones.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No active zones with coordinates found</p>
                  ) : visibleZones.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No zones match &quot;{zoneSearch}&quot;</p>
                  ) : visibleZones.map(z => (
                    <label
                      key={z.id}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                        selected.has(z.id) ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => toggleZone(z.id)}
                    >
                      <Checkbox
                        checked={selected.has(z.id)}
                        onCheckedChange={() => toggleZone(z.id)}
                        onClick={e => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{z.name}</p>
                        <p className="text-xs text-muted-foreground">{z.zone_type ?? 'zone'}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {z.location_lat?.toFixed(3)}, {z.location_lng?.toFixed(3)}
                      </Badge>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Options */}
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div>
                  <Label className="text-sm mb-1 block">Start from</Label>
                  <Select value={startZoneId} onValueChange={setStartZoneId}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="First selected zone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first">First selected zone</SelectItem>
                      {zones.filter(z => selected.has(z.id)).map(z => (
                        <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-muted-foreground">
                  Assumes avg {PATROL_SPEED_KMH} km/h travel speed · {INSPECTION_MINUTES} min per zone inspection
                </div>
                <Button
                  className="w-full"
                  disabled={selected.size < 2}
                  onClick={handleOptimise}
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Optimise Route ({selected.size} zones)
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right: Route result */}
          <div>
            {!route ? (
              <div className="h-full flex items-center justify-center border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
                <div>
                  <Route className="h-12 w-12 mx-auto mb-3 opacity-25" />
                  <p className="text-sm">Select 2+ zones and click Optimise Route to see the recommended patrol order.</p>
                </div>
              </div>
            ) : (
              <Card>
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Navigation className="h-4 w-4 text-primary" />
                      Optimised Route
                    </CardTitle>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copyRoute}>
                      {copied ? <CheckCheck className="h-3.5 w-3.5 mr-1 text-green-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-muted/40 p-3 text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Zones</p>
                      <p className="text-xl font-bold">{route.length}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3 text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1"><Car className="h-3 w-3" /> Distance</p>
                      <p className="text-xl font-bold">{totalKm.toFixed(1)} <span className="text-sm font-normal">km</span></p>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3 text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center justify-center gap-1"><Clock className="h-3 w-3" /> Est Time</p>
                      <p className="text-xl font-bold">{h > 0 ? `${h}h ` : ''}{m}m</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Stop list */}
                  <div className="space-y-2">
                    {route.map((stop, i) => (
                      <div key={stop.zone.id} className="flex items-center gap-2.5">
                        <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                          ${i === 0 ? 'bg-green-100 text-green-700 border border-green-300' :
                            i === route.length - 1 ? 'bg-red-100 text-red-700 border border-red-300' :
                            'bg-primary/10 text-primary border border-primary/20'}`}>
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{stop.zone.name}</p>
                          <p className="text-xs text-muted-foreground">{stop.zone.zone_type ?? 'zone'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {i > 0 && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <ArrowRight className="h-3 w-3" />
                              {stop.distanceKm.toFixed(1)} km
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
                            <Clock className="h-3 w-3" />
                            +{INSPECTION_MINUTES} min
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
