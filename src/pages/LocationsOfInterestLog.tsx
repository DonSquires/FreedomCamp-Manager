/**
 * LocationsOfInterestLog — B-115
 *
 * Log viewer for locations_of_interest — named locations (sites, camps, zones)
 * linked to enforcement operations.
 *
 * Features:
 *  - KPI cards: Total / Active / Canonical / Unique Cities
 *  - Filters: loi_kind (dynamic), is_active, is_canonical, city (dynamic)
 *  - Search: name / address_full
 *  - Table: name, loi_kind badge, display_address, city, is_canonical indicator,
 *           is_active badge, created_at
 *  - Expandable row: description, hazard_summary, access_summary, GPS, geo_zone_ids,
 *                    geocoder_source + confidence, canonical_loi_id, updated_at
 *
 * Route: /locations-of-interest-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPin, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

// ─── Types ─────────────────────────────────────────────────────────────────────

type LocationOfInterest = Database['public']['Tables']['locations_of_interest']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function kindColor(kind: string) {
  if (kind === 'camp_site')          return 'bg-green-100 text-green-800'
  if (kind === 'freedom_camp')       return 'bg-emerald-100 text-emerald-800'
  if (kind === 'park')               return 'bg-teal-100 text-teal-800'
  if (kind === 'enforcement_zone')   return 'bg-orange-100 text-orange-800'
  if (kind === 'client_site')        return 'bg-blue-100 text-blue-800'
  if (kind === 'hazard')             return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LocationsOfInterestLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [kindFilter,      setKindFilter]      = useState('all')
  const [activeFilter,    setActiveFilter]    = useState('all')
  const [canonicalFilter, setCanonicalFilter] = useState('all')
  const [cityFilter,      setCityFilter]      = useState('all')
  const [searchTerm,      setSearchTerm]      = useState('')
  const [expandedId,      setExpandedId]      = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<LocationOfInterest[]>({
    queryKey: ['locations-of-interest-log', orgId, kindFilter, activeFilter, canonicalFilter, cityFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('locations_of_interest')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (kindFilter      !== 'all') q = q.eq('loi_kind', kindFilter)
      if (activeFilter    !== 'all') q = q.eq('is_active', activeFilter === 'yes')
      if (canonicalFilter !== 'all') q = q.eq('is_canonical', canonicalFilter === 'yes')
      if (cityFilter      !== 'all') q = q.eq('city', cityFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered = searchTerm
    ? rows.filter(r =>
        (r.name ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.address_full ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.display_address ?? '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    : rows

  const activeCount    = filtered.filter(r => r.is_active).length
  const canonicalCount = filtered.filter(r => r.is_canonical).length
  const uniqueCities   = new Set(filtered.map(r => r.city).filter(Boolean)).size
  const kinds          = [...new Set(rows.map(r => r.loi_kind).filter(Boolean))].sort()
  const cities         = [...new Set(rows.map(r => r.city).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Locations of Interest Log</h1>
              <p className="text-sm text-muted-foreground">Named locations linked to enforcement operations</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Locations', value: filtered.length, colour: 'text-gray-700' },
            { label: 'Active',          value: activeCount,     colour: 'text-green-700' },
            { label: 'Canonical',       value: canonicalCount,  colour: 'text-blue-700' },
            { label: 'Unique Cities',   value: uniqueCities,    colour: 'text-teal-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="LOI kind" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {kinds.map(k => <SelectItem key={k} value={k!}>{k!.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Active only</SelectItem>
              <SelectItem value="no">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={canonicalFilter} onValueChange={setCanonicalFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Canonical" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Canonical only</SelectItem>
              <SelectItem value="no">Non-canonical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map(c => <SelectItem key={c} value={c!}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search name / address…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-56"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No locations found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Canonical</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-medium text-sm">{row.name ?? '—'}</TableCell>
                        <TableCell><Badge className={kindColor(row.loi_kind)}>{row.loi_kind.replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-48">{row.display_address ?? row.address_full ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.city ?? '—'}</TableCell>
                        <TableCell className="text-center">
                          {row.is_canonical
                            ? <span className="text-blue-600 text-xs font-medium">✓</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell>
                          {row.is_active
                            ? <Badge className="bg-green-100 text-green-800">Active</Badge>
                            : <Badge className="bg-gray-100 text-gray-600">Inactive</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              {row.gps_lat != null && row.gps_lng != null && (
                                <span>GPS: {row.gps_lat.toFixed(5)}, {row.gps_lng.toFixed(5)}</span>
                              )}
                              {row.geocoder_source     && <span>Geocoder: {row.geocoder_source}</span>}
                              {row.geocoder_confidence != null && <span>Confidence: {(row.geocoder_confidence * 100).toFixed(0)}%</span>}
                              {row.canonical_loi_id    && <span>Canonical ID: {row.canonical_loi_id.slice(0, 8)}…</span>}
                              {row.geo_zone_ids && row.geo_zone_ids.length > 0 && <span>Zones: {row.geo_zone_ids.length}</span>}
                              {row.updated_at          && <span>Updated: {fmtDate(row.updated_at)}</span>}
                            </div>
                            {row.description && (
                              <div>
                                <p className="font-medium text-sm mb-1">Description</p>
                                <p className="text-sm text-muted-foreground">{row.description}</p>
                              </div>
                            )}
                            {row.hazard_summary && (
                              <div>
                                <p className="font-medium text-sm mb-1">Hazard Summary</p>
                                <p className="text-sm text-muted-foreground">{row.hazard_summary}</p>
                              </div>
                            )}
                            {row.access_summary && (
                              <div>
                                <p className="font-medium text-sm mb-1">Access Summary</p>
                                <p className="text-sm text-muted-foreground">{row.access_summary}</p>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
