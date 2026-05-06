/**
 * DispatchLOIBrowser — B-44
 *
 * Browse and search the Locations of Interest (LOI) table used by the
 * dispatch system to resolve addresses, parks, reserves, freedom camping
 * spots, and other geographic points of interest for each organisation.
 *
 * Features:
 *   - KPI cards: Total LOIs, Active, Freedom Camp sites, Parks & Reserves
 *   - Filters: loi_kind dropdown, active/inactive toggle, keyword search
 *   - Sortable table: name/address, kind badge, GPS co-ordinates, hazard and
 *     access summaries, canonical indicator
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPin, Search, RefreshCw, Globe, Tent, TreePine, Navigation,
  Loader2, CheckCircle2, AlertCircle,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type LOI = Database['public']['Tables']['locations_of_interest']['Row']

// ─── Constants ────────────────────────────────────────────────────────────────

const LOI_KINDS = [
  { value: 'address',       label: 'Address',          icon: <MapPin className="h-3 w-3" /> },
  { value: 'park_reserve',  label: 'Park / Reserve',   icon: <TreePine className="h-3 w-3" /> },
  { value: 'freedom_camp',  label: 'Freedom Camp',     icon: <Tent className="h-3 w-3" /> },
  { value: 'poi',           label: 'Point of Interest',icon: <Globe className="h-3 w-3" /> },
  { value: 'intersection',  label: 'Intersection',     icon: <Navigation className="h-3 w-3" /> },
  { value: 'ad_hoc',        label: 'Ad-hoc (GPS)',     icon: <Navigation className="h-3 w-3" /> },
  { value: 'unknown',       label: 'Unknown',          icon: null },
]

const KIND_COLOURS: Record<string, string> = {
  address:      'bg-blue-100 text-blue-800',
  park_reserve: 'bg-green-100 text-green-800',
  freedom_camp: 'bg-emerald-100 text-emerald-800',
  poi:          'bg-purple-100 text-purple-800',
  intersection: 'bg-orange-100 text-orange-800',
  ad_hoc:       'bg-yellow-100 text-yellow-800',
  unknown:      'bg-gray-100 text-gray-600',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGps(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return null
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function kindLabel(kind: string) {
  return LOI_KINDS.find(k => k.value === kind)?.label ?? kind
}

function formatTs(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function getDisplayAddress(l: LOI): string | null {
  if (l.display_address) return l.display_address
  if (l.address_full) return l.address_full
  const parts = [l.address_line1, l.suburb, l.city].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DispatchLOIBrowser() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const [search, setSearch]       = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: lois = [], isLoading, refetch } = useQuery({
    queryKey: ['locations_of_interest', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations_of_interest')
        .select('*')
        .eq('organization_id', orgId)
        .order('name', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as LOI[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:        lois.length,
    active:       lois.filter(l => l.is_active).length,
    freedomCamp:  lois.filter(l => l.loi_kind === 'freedom_camp').length,
    parkReserve:  lois.filter(l => l.loi_kind === 'park_reserve').length,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = lois.filter(l => {
    if (kindFilter !== 'all' && l.loi_kind !== kindFilter) return false
    if (activeFilter === 'active' && !l.is_active) return false
    if (activeFilter === 'inactive' && l.is_active) return false
    if (search) {
      const q = search.toLowerCase()
      const name    = (l.name ?? '').toLowerCase()
      const address = (l.display_address ?? l.address_full ?? '').toLowerCase()
      const suburb  = (l.suburb ?? '').toLowerCase()
      const city    = (l.city ?? '').toLowerCase()
      if (!name.includes(q) && !address.includes(q) && !suburb.includes(q) && !city.includes(q)) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Dispatch LOI Browser" description="Browse and search dispatch locations of interest">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <span className="font-semibold text-lg">Dispatch LOI Browser</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total LOIs',      value: kpis.total,       color: 'text-foreground',  icon: <Globe className="h-4 w-4" /> },
          { label: 'Active',          value: kpis.active,      color: 'text-green-600',   icon: <CheckCircle2 className="h-4 w-4" /> },
          { label: 'Freedom Camps',   value: kpis.freedomCamp, color: 'text-emerald-600', icon: <Tent className="h-4 w-4" /> },
          { label: 'Parks & Reserves',value: kpis.parkReserve, color: 'text-teal-600',    icon: <TreePine className="h-4 w-4" /> },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, address, suburb, city…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="LOI kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {LOI_KINDS.map(k => (
              <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* No-data state */}
      {!isLoading && lois.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No locations of interest found for this organisation. Records are created automatically when patrol data or NCC import data is processed.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name / Label</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>GPS</TableHead>
              <TableHead>Hazard</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Canonical</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && lois.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No locations match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(l => {
              const gps     = formatGps(l.gps_lat, l.gps_lng)
              const address = getDisplayAddress(l)
              return (
                <TableRow key={l.id} className={!l.is_active ? 'opacity-50' : ''}>
                  <TableCell className="font-medium max-w-40">
                    {l.name
                      ? <span className="truncate block">{l.name}</span>
                      : <span className="italic text-muted-foreground">Unnamed</span>}
                    {l.description && (
                      <span className="text-xs text-muted-foreground truncate block max-w-36">{l.description}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${KIND_COLOURS[l.loi_kind] ?? KIND_COLOURS.unknown}`}>
                      {kindLabel(l.loi_kind)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm max-w-48">
                    <span className="truncate block">
                      {address ?? <span className="text-muted-foreground italic">No address</span>}
                    </span>
                    {l.city && l.region && (
                      <span className="text-xs text-muted-foreground">{l.city}, {l.region}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap text-muted-foreground">
                    {gps ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-32">
                    {l.hazard_summary
                      ? <span className="truncate block text-orange-700">{l.hazard_summary}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-32">
                    {l.access_summary
                      ? <span className="truncate block">{l.access_summary}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {l.is_canonical
                      ? <Badge variant="outline" className="text-xs text-blue-700 border-blue-300">Canonical</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTs(l.created_at)}
                  </TableCell>
                  <TableCell>
                    {l.is_active
                      ? <Badge variant="secondary" className="text-xs text-green-700">Active</Badge>
                      : <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Row count footer */}
      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {lois.length} locations
        </p>
      )}
    </AppLayout>
  )
}
