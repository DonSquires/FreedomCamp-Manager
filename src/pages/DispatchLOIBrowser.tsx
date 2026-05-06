/**
 * DispatchLOIBrowser — Sprint 13 / B-44
 *
 * Org-scoped browser of `locations_of_interest` records.
 * Filterable by loi_kind; searchable by name/address.
 * Displays address, GPS coordinates, hazard and access summaries.
 *
 * Route: /loi-browser
 * Roles: admin, admin_officer, master, grand_master
 *
 * locations_of_interest is fully typed in database.ts — no `as any` required.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Globe, MapPin, Search } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Database } from '@/types/database'

// ─── Types ──────────────────────────────────────────────────────────────────────

type LOIRow = Database['public']['Tables']['locations_of_interest']['Row']

// ─── Constants ─────────────────────────────────────────────────────────────────

const LOI_KINDS = ['address', 'zone', 'hazard', 'client_site', 'patrol_point', 'checkpoint', 'dispatch_base'] as const

// ─── Helpers ────────────────────────────────────────────────────────────────────

function loiKindBadge(kind: string) {
  const styles: Record<string, string> = {
    address:        'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    zone:           'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    hazard:         'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    client_site:    'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    patrol_point:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    checkpoint:     'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
    dispatch_base:  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  }
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[kind] ?? 'bg-gray-100 text-gray-700'}`}>
      {kind.replace(/_/g, ' ')}
    </span>
  )
}

function formatAddress(row: LOIRow): string {
  if (row.display_address) return row.display_address
  const parts = [row.address_line1, row.suburb, row.city, row.region].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

function formatGPS(row: LOIRow): string {
  if (row.gps_lat == null || row.gps_lng == null) return '—'
  return `${row.gps_lat.toFixed(5)}, ${row.gps_lng.toFixed(5)}`
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function DispatchLOIBrowser() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const [loiKindFilter, setLoiKindFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)

  // Fetch locations of interest
  const { data: lois = [], isLoading, error, refetch } = useQuery<LOIRow[]>({
    queryKey: ['loi-browser', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await supabase
        .from('locations_of_interest')
        .select('*')
        .eq('organization_id', orgId)
        .order('name', { ascending: true })
        .limit(500)
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
    staleTime: 60_000,
    retry: false,
  })

  // Client-side filters
  const filtered = useMemo(() => {
    return lois.filter((loc) => {
      if (activeOnly && !loc.is_active) return false
      if (loiKindFilter !== 'all' && loc.loi_kind !== loiKindFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const name = (loc.name ?? '').toLowerCase()
        const addr = formatAddress(loc).toLowerCase()
        const hazard = (loc.hazard_summary ?? '').toLowerCase()
        if (!name.includes(q) && !addr.includes(q) && !hazard.includes(q)) return false
      }
      return true
    })
  }, [lois, loiKindFilter, search, activeOnly])

  // KPI counts
  const kpis = useMemo(() => {
    const active = lois.filter((l) => l.is_active)
    const hazards = active.filter((l) => l.loi_kind === 'hazard').length
    const canonical = active.filter((l) => l.is_canonical).length
    return { total: active.length, hazards, canonical }
  }, [lois])

  return (
    <AppLayout
      title="LOI Browser"
      description="Browse and search all Locations of Interest for dispatch, patrol planning, and hazard awareness"
    >
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/admin-portal')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Active LOIs', value: isLoading ? '—' : kpis.total, Icon: MapPin, color: 'text-blue-600' },
          { label: 'Hazard Sites', value: isLoading ? '—' : kpis.hazards, Icon: AlertTriangle, color: 'text-red-600' },
          { label: 'Canonical', value: isLoading ? '—' : kpis.canonical, Icon: CheckCircle2, color: 'text-emerald-600' },
        ].map(({ label, value, Icon, color }) => (
          <Card key={label} className="border shadow-sm">
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-2xl font-bold leading-tight">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name / address / hazard…"
                className="pl-8 w-60 h-8 text-xs"
              />
            </div>
            <Select value={loiKindFilter} onValueChange={setLoiKindFilter}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue placeholder="LOI kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                {LOI_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{k.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="rounded"
              />
              Active only
            </label>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => void refetch()}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {error ? (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              Failed to load locations: {(error as any)?.message ?? 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="rounded-xl overflow-hidden border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Kind</TableHead>
                  <TableHead className="text-xs">Address</TableHead>
                  <TableHead className="text-xs">GPS</TableHead>
                  <TableHead className="text-xs">Hazard Note</TableHead>
                  <TableHead className="text-xs">Access Note</TableHead>
                  <TableHead className="text-xs">Canonical</TableHead>
                  <TableHead className="text-xs">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}><Skeleton className="h-4 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      No locations match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((loc) => (
                    <TableRow key={loc.id} className={loc.loi_kind === 'hazard' ? 'bg-red-50/40 dark:bg-red-950/10' : ''}>
                      <TableCell className="py-2 text-sm font-medium max-w-[140px] truncate">{loc.name ?? '—'}</TableCell>
                      <TableCell className="py-2">{loiKindBadge(loc.loi_kind)}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground max-w-[200px] truncate">{formatAddress(loc)}</TableCell>
                      <TableCell className="py-2 text-xs font-mono text-muted-foreground">
                        {loc.gps_lat != null && loc.gps_lng != null ? (
                          <a
                            href={`https://www.google.com/maps?q=${loc.gps_lat},${loc.gps_lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <Globe className="h-3 w-3" />
                            {formatGPS(loc)}
                          </a>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="py-2 text-xs max-w-[140px] truncate" title={loc.hazard_summary ?? undefined}>
                        {loc.hazard_summary
                          ? <span className="text-red-700 dark:text-red-300">{loc.hazard_summary}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="py-2 text-xs max-w-[140px] truncate" title={loc.access_summary ?? undefined}>
                        {loc.access_summary ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2 text-xs">
                        {loc.is_canonical
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-label="Canonical" />
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant={loc.is_active ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                          {loc.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && filtered.length > 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-t">
              Showing {filtered.length} of {lois.length} location{lois.length !== 1 ? 's' : ''}
              {lois.length >= 500 && ' (capped at 500 — refine filters)'}
            </div>
          )}
        </Card>
      )}
    </AppLayout>
  )
}
