/**
 * MobilePlateFinder — B-22 / B-30
 *
 * Partial-plate cross-search across two sources:
 *   1. canonical_vehicles   — the vehicle registry (all ever-seen plates)
 *   2. observations         — recent patrol observations matching the query
 *
 * Designed for mobile use by officers who have a partial plate (e.g. "ABC")
 * and need to identify the full plate quickly.
 *
 * Results are deduped by plate_number and sorted by last_seen_at.
 *
 * B-30 enhancement: shows the latest observation photo thumbnail inline and
 * flags any result zone that has a fixed camera covering it.
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search,
  Car,
  AlertTriangle,
  ShieldCheck,
  Clock,
  MapPin,
  ScanSearch,
  ChevronRight,
  Loader2,
  Camera,
  ImageOff,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type CanonicalVehicle = Pick<
  Database['public']['Tables']['canonical_vehicles']['Row'],
  | 'plate_number'
  | 'last_seen_at'
  | 'vehicle_make'
  | 'vehicle_model'
  | 'vehicle_color'
  | 'vehicle_year'
  | 'is_flagged'
  | 'is_exempt'
  | 'total_breaches'
  | 'self_contained'
>

type ObsHit = {
  plate_number: string
  recorded_at: string
  zone_name_at_import: string | null
  zone_id: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_color: string | null
  vehicle_year: number | null
  is_breach: boolean | null
  photo_url: string | null
}

interface ResultRow {
  plate_number: string
  last_seen_at: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_color: string | null
  vehicle_year: number | null
  is_flagged: boolean | null
  is_exempt: boolean | null
  total_breaches: number | null
  self_contained: boolean | null
  /** Latest observation zone */
  last_zone: string | null
  /** zone_id for fixed camera lookup (from latest obs) */
  last_zone_id: string | null
  /** Latest observation photo URL (B-30) */
  photo_url: string | null
  /** Whether this plate has any breach observation in recent results */
  has_recent_breach: boolean
  /** Source: 'registry' = canonical_vehicles only, 'observation' = obs only, 'both' */
  source: 'registry' | 'observation' | 'both'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIN_LENGTH = 2 // require at least 2 chars before searching

// ─── Component ────────────────────────────────────────────────────────────────

export default function MobilePlateFinder() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const orgId = user?.organization_id ?? ''

  const [query, setQuery]     = useState('')
  const [submitted, setSubmitted] = useState('')

  function handleSearch() {
    const q = query.trim().toUpperCase()
    if (q.length < MIN_LENGTH) return
    setSubmitted(q)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch()
  }

  // ── Canonical vehicles query ───────────────────────────────────────────────
  const { data: vehicles = [], isFetching: fetchingVeh } = useQuery<CanonicalVehicle[]>({
    queryKey: ['plate-finder-vehicles', orgId, submitted],
    queryFn: async () => {
      if (!submitted || submitted.length < MIN_LENGTH) return []
      const { data } = await supabase
        .from('canonical_vehicles')
        .select(`
          plate_number,
          last_seen_at,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          vehicle_year,
          is_flagged,
          is_exempt,
          total_breaches,
          self_contained
        `)
        .ilike('plate_number', `%${submitted}%`)
        .order('last_seen_at', { ascending: false })
        .limit(50)
      return (data ?? []) as CanonicalVehicle[]
    },
    enabled: !!orgId && submitted.length >= MIN_LENGTH,
  })

  // ── Observations query (last 90 days) ─────────────────────────────────────
  const { data: observations = [], isFetching: fetchingObs } = useQuery<ObsHit[]>({
    queryKey: ['plate-finder-obs', orgId, submitted],
    queryFn: async () => {
      if (!submitted || submitted.length < MIN_LENGTH) return []
      const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString()
      const { data } = await supabase
        .from('observations')
        .select(`
          plate_number,
          recorded_at,
          zone_name_at_import,
          zone_id,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          vehicle_year,
          is_breach,
          photo_url
        `)
        .eq('organization_id', orgId)
        .ilike('plate_number', `%${submitted}%`)
        .gte('recorded_at', cutoff)
        .order('recorded_at', { ascending: false })
        .limit(100)
      return (data ?? []) as ObsHit[]
    },
    enabled: !!orgId && submitted.length >= MIN_LENGTH,
  })

  // ── Merge results ──────────────────────────────────────────────────────────
  const results = useMemo<ResultRow[]>(() => {
    const map = new Map<string, ResultRow>()

    // Seed from canonical vehicles
    for (const v of vehicles) {
      map.set(v.plate_number, {
        plate_number: v.plate_number,
        last_seen_at: v.last_seen_at,
        vehicle_make: v.vehicle_make,
        vehicle_model: v.vehicle_model,
        vehicle_color: v.vehicle_color,
        vehicle_year: v.vehicle_year,
        is_flagged: v.is_flagged,
        is_exempt: v.is_exempt,
        total_breaches: v.total_breaches,
        self_contained: v.self_contained,
        last_zone: null,
        last_zone_id: null,
        photo_url: null,
        has_recent_breach: false,
        source: 'registry',
      })
    }

    // Merge observations
    for (const o of observations) {
      const existing = map.get(o.plate_number)
      if (existing) {
        existing.source = 'both'
        if (!existing.last_zone && o.zone_name_at_import) existing.last_zone = o.zone_name_at_import
        if (!existing.last_zone_id && o.zone_id) existing.last_zone_id = o.zone_id
        if (!existing.photo_url && o.photo_url) existing.photo_url = o.photo_url
        if (o.is_breach) existing.has_recent_breach = true
        // Prefer richer make/model/color from obs if canonical lacks it
        if (!existing.vehicle_make && o.vehicle_make)   existing.vehicle_make  = o.vehicle_make
        if (!existing.vehicle_model && o.vehicle_model) existing.vehicle_model = o.vehicle_model
        if (!existing.vehicle_color && o.vehicle_color) existing.vehicle_color = o.vehicle_color
      } else {
        map.set(o.plate_number, {
          plate_number: o.plate_number,
          last_seen_at: o.recorded_at,
          vehicle_make: o.vehicle_make,
          vehicle_model: o.vehicle_model,
          vehicle_color: o.vehicle_color,
          vehicle_year: o.vehicle_year,
          is_flagged: null,
          is_exempt: null,
          total_breaches: null,
          self_contained: null,
          last_zone: o.zone_name_at_import,
          last_zone_id: o.zone_id,
          photo_url: o.photo_url,
          has_recent_breach: !!o.is_breach,
          source: 'observation',
        })
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '')
    )
  }, [vehicles, observations])

  const isFetching = fetchingVeh || fetchingObs
  const hasResults = submitted.length >= MIN_LENGTH

  // ── Fixed cameras lookup (B-30): query cameras for all zones in current results ──
  const resultZoneIds = useMemo(
    () => [...new Set(results.map(r => r.last_zone_id).filter(Boolean))] as string[],
    [results]
  )

  const { data: zoneCameras = [] } = useQuery({
    queryKey: ['plate-finder-cameras', orgId, resultZoneIds],
    queryFn: async () => {
      if (!resultZoneIds.length) return []
      const { data } = await supabase
        .from('fixed_cameras')
        .select('zone_id, name, snapshot_url, stream_url, status')
        .eq('organization_id', orgId)
        .in('zone_id', resultZoneIds)
        .eq('status', 'active')
      return (data ?? []) as Array<{ zone_id: string | null; name: string; snapshot_url: string | null; stream_url: string | null; status: string }>
    },
    enabled: !!orgId && resultZoneIds.length > 0,
  })

  // Build zone_id → camera map for fast lookup
  const cameraByZone = useMemo(() => {
    const m = new Map<string, { name: string; snapshot_url: string | null; stream_url: string | null }>()
    for (const c of zoneCameras) {
      if (c.zone_id && !m.has(c.zone_id)) m.set(c.zone_id, c)
    }
    return m
  }, [zoneCameras])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-lg mx-auto">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScanSearch className="h-6 w-6 text-primary" />
            Mobile Plate Finder
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Enter a full or partial plate number to cross-search the vehicle registry and recent patrol observations
          </p>
        </div>

        {/* Search bar */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-10 h-11 text-base font-mono uppercase tracking-widest"
                  placeholder="e.g. ABC or ABC123"
                  value={query}
                  onChange={e => setQuery(e.target.value.toUpperCase())}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <Button
                className="h-11 px-5"
                onClick={handleSearch}
                disabled={query.trim().length < MIN_LENGTH || isFetching}
              >
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Search className="h-4 w-4 mr-1.5" />}
                Search
              </Button>
            </div>
            {query.trim().length > 0 && query.trim().length < MIN_LENGTH && (
              <p className="text-xs text-amber-600 mt-1.5">Enter at least {MIN_LENGTH} characters to search</p>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {hasResults && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Results for <span className="font-mono text-primary">{submitted}</span></span>
                {!isFetching && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {results.length} plate{results.length !== 1 ? 's' : ''} found
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isFetching ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Searching…</span>
                </div>
              ) : results.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Car className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No plates matching <span className="font-mono font-semibold">{submitted}</span> found.</p>
                  <p className="text-xs mt-1">Try fewer characters or check for typos.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plate</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Last Seen</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map(r => {
                      const cam = r.last_zone_id ? cameraByZone.get(r.last_zone_id) : null
                      return (
                        <TableRow
                          key={r.plate_number}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/vehicles?plate=${encodeURIComponent(r.plate_number)}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {r.is_flagged
                                ? <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                : <Car className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                              <span className="font-mono font-bold tracking-wider">{r.plate_number}</span>
                            </div>
                            {/* B-30: observation photo thumbnail */}
                            {r.photo_url ? (
                              <img
                                src={r.photo_url}
                                alt="Observation photo"
                                className="mt-1.5 h-12 w-20 object-cover rounded border border-border"
                                onClick={e => { e.stopPropagation(); window.open(r.photo_url!, '_blank') }}
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                              />
                            ) : (
                              r.source !== 'registry' && (
                                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <ImageOff className="h-3 w-3" />
                                  No photo
                                </div>
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="text-foreground">
                              {[r.vehicle_color, r.vehicle_make, r.vehicle_model, r.vehicle_year]
                                .filter(Boolean)
                                .join(' ')
                                || <span className="text-muted-foreground italic">Unknown</span>}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3 shrink-0" />
                              {r.last_seen_at ? formatDateTime(r.last_seen_at) : '—'}
                            </div>
                          </TableCell>
                          <TableCell>
                            {r.last_zone ? (
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1 text-xs">
                                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                                  {r.last_zone}
                                </div>
                                {/* B-30: fixed camera badge */}
                                {cam && (
                                  <div
                                    className="flex items-center gap-1 text-[10px] text-blue-600 cursor-pointer hover:underline"
                                    title={`Fixed camera: ${cam.name}`}
                                    onClick={e => { e.stopPropagation(); window.open('/fixed-cameras', '_blank') }}
                                  >
                                    <Camera className="h-3 w-3" />
                                    {cam.name}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {r.is_flagged && (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Flagged</Badge>
                              )}
                              {r.is_exempt && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300">Exempt</Badge>
                              )}
                              {r.self_contained && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-300">SC</Badge>
                              )}
                              {r.has_recent_breach && (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Breach (90d)</Badge>
                              )}
                              {(r.total_breaches ?? 0) > 0 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-300">
                                  {r.total_breaches} breach{(r.total_breaches ?? 0) !== 1 ? 'es' : ''}
                                </Badge>
                              )}
                              {r.source === 'observation' && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Obs only</Badge>
                              )}
                              {!r.is_flagged && !r.is_exempt && !r.has_recent_breach && (r.total_breaches ?? 0) === 0 && (
                                <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Hint when no search yet */}
        {!hasResults && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <ScanSearch className="h-14 w-14 opacity-20" />
            <p className="text-sm">Enter a partial or full plate to begin</p>
            <p className="text-xs max-w-xs text-center">
              Searches the vehicle registry and the last 90 days of patrol observations across your organisation.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
