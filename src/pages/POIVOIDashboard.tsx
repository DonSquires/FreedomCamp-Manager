/**
 * POIVOIDashboard — B-40
 *
 * Watch-list dashboard for Persons of Interest and Vehicles of Interest.
 *
 * Features:
 *   - KPI cards: Active POIs, Active VOIs, Expiring (≤7 days), Expired
 *   - Expiry alert banner
 *   - Two-tab layout: Persons of Interest | Vehicles of Interest
 *   - Each tab: searchable table with status, reason, expiry, photos
 *   - Linked person indicator on VOI rows
 */

import { useState } from 'react'
import { format, parseISO, isPast, isWithinInterval, addDays } from 'date-fns'
import {
  ShieldAlert, User, Car, Search, RefreshCw, AlertTriangle, Link2,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ─── Types ────────────────────────────────────────────────────────────────────

type POI = {
  id: string
  full_name: string
  status: string
  reason: string | null
  description: string | null
  date_of_birth: string | null
  expires_at: string | null
  active: boolean | null
  photos: string[] | null
  gender: string | null
  site_specific: boolean
  privacy_notice_given: boolean | null
}

type VOI = {
  id: string
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  vehicle_color: string | null
  status: string
  reason: string | null
  expires_at: string | null
  active: boolean | null
  linked_person_id: string | null
  photos: string[] | null
  zone_last_observed_at: string | null
  persons_of_interest: { full_name: string } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function expiryClass(expires_at: string | null) {
  if (!expires_at) return null
  if (isPast(parseISO(expires_at))) return 'expired'
  if (isWithinInterval(parseISO(expires_at), { start: new Date(), end: addDays(new Date(), 7) })) return 'expiring'
  return null
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active:    'bg-red-100 text-red-800',
    watching:  'bg-orange-100 text-orange-800',
    suspended: 'bg-gray-100 text-gray-600',
    expired:   'bg-slate-100 text-slate-500',
    cleared:   'bg-green-100 text-green-700',
  }
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function POIVOIDashboard() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  const [poiSearch, setPoiSearch] = useState('')
  const [voiSearch, setVoiSearch] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: pois = [], isLoading: poisLoading, refetch: refetchPOI } = useQuery({
    queryKey: ['persons_of_interest', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('persons_of_interest')
        .select('id, full_name, status, reason, description, date_of_birth, expires_at, active, photos, gender, site_specific, privacy_notice_given')
        .eq('organization_id', orgId)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as POI[]
    },
  })

  const { data: vois = [], isLoading: voisLoading, refetch: refetchVOI } = useQuery({
    queryKey: ['vehicles_of_interest', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles_of_interest')
        .select('id, plate_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, status, reason, expires_at, active, linked_person_id, photos, zone_last_observed_at, persons_of_interest(full_name)')
        .eq('organization_id', orgId)
        .order('plate_number')
      if (error) throw error
      return (data ?? []) as unknown as VOI[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const activePOIs   = pois.filter(p => p.active && p.status === 'active').length
  const activeVOIs   = vois.filter(v => v.active && v.status === 'active').length
  const expiringPOIs = pois.filter(p => expiryClass(p.expires_at) === 'expiring').length
  const expiringVOIs = vois.filter(v => expiryClass(v.expires_at) === 'expiring').length
  const expiredPOIs  = pois.filter(p => expiryClass(p.expires_at) === 'expired').length
  const expiredVOIs  = vois.filter(v => expiryClass(v.expires_at) === 'expired').length
  const totalExpiring = expiringPOIs + expiringVOIs
  const totalExpired  = expiredPOIs + expiredVOIs

  // ── Filtered lists ─────────────────────────────────────────────────────────

  const filteredPOIs = pois.filter(p => {
    if (!poiSearch) return true
    const q = poiSearch.toLowerCase()
    return (
      p.full_name.toLowerCase().includes(q) ||
      (p.reason ?? '').toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    )
  })

  const filteredVOIs = vois.filter(v => {
    if (!voiSearch) return true
    const q = voiSearch.toLowerCase()
    return (
      v.plate_number.toLowerCase().includes(q) ||
      (v.vehicle_make ?? '').toLowerCase().includes(q) ||
      (v.vehicle_model ?? '').toLowerCase().includes(q) ||
      (v.reason ?? '').toLowerCase().includes(q)
    )
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="POI / VOI Dashboard" description="Persons and vehicles of interest watch-list">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <span className="font-semibold text-lg">POI / VOI Watch-list</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetchPOI(); refetchVOI() }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Active POIs', value: activePOIs,   color: 'text-red-600',    icon: <User className="h-4 w-4" /> },
          { label: 'Active VOIs', value: activeVOIs,   color: 'text-orange-600', icon: <Car className="h-4 w-4" /> },
          { label: 'Expiring ≤7d', value: totalExpiring, color: 'text-yellow-600', icon: <AlertTriangle className="h-4 w-4" /> },
          { label: 'Expired',      value: totalExpired,  color: 'text-gray-500',   icon: null },
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

      {/* Expiry warning */}
      {totalExpiring > 0 && (
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-md px-4 py-2 mb-4 text-sm text-yellow-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            {totalExpiring} watch-list entr{totalExpiring > 1 ? 'ies' : 'y'} expiring within 7 days — review and extend or clear.
          </span>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="poi">
        <TabsList className="mb-4">
          <TabsTrigger value="poi" className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            Persons of Interest
            <Badge variant="secondary" className="ml-1 text-xs">{pois.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="voi" className="flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5" />
            Vehicles of Interest
            <Badge variant="secondary" className="ml-1 text-xs">{vois.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── POI Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="poi">
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, reason, status…"
              value={poiSearch}
              onChange={e => setPoiSearch(e.target.value)}
              className="pl-8 max-w-80"
            />
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>D.O.B.</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Privacy Notice</TableHead>
                  <TableHead>Site-Specific</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poisLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                )}
                {!poisLoading && filteredPOIs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No persons found.</TableCell>
                  </TableRow>
                )}
                {filteredPOIs.map(p => {
                  const ec = expiryClass(p.expires_at)
                  return (
                    <TableRow key={p.id} className={ec === 'expiring' ? 'bg-yellow-50/50' : ec === 'expired' ? 'bg-gray-50/50' : ''}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {p.photos && p.photos.length > 0
                            ? <img src={p.photos[0]} alt="" className="h-7 w-7 rounded-full object-cover border" />
                            : <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center"><User className="h-4 w-4 text-muted-foreground" /></div>}
                          {p.full_name}
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                      <TableCell className="text-sm max-w-40 truncate">{p.reason ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatTs(p.date_of_birth)}</TableCell>
                      <TableCell className="text-xs">
                        {p.expires_at
                          ? <span className={ec === 'expired' ? 'text-red-600' : ec === 'expiring' ? 'text-yellow-700 font-medium' : ''}>{formatTs(p.expires_at)}</span>
                          : <span className="text-muted-foreground">No expiry</span>}
                      </TableCell>
                      <TableCell>
                        {p.privacy_notice_given
                          ? <Badge variant="outline" className="text-xs text-green-700 border-green-300">Given</Badge>
                          : <Badge variant="outline" className="text-xs text-yellow-700 border-yellow-300">Pending</Badge>}
                      </TableCell>
                      <TableCell>
                        {p.site_specific
                          ? <Badge variant="outline" className="text-xs">Site</Badge>
                          : <Badge variant="secondary" className="text-xs">Org-wide</Badge>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── VOI Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="voi">
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search plate, make, model, reason…"
              value={voiSearch}
              onChange={e => setVoiSearch(e.target.value)}
              className="pl-8 max-w-80"
            />
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plate</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Linked Person</TableHead>
                  <TableHead>Last Observed</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {voisLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                )}
                {!voisLoading && filteredVOIs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No vehicles found.</TableCell>
                  </TableRow>
                )}
                {filteredVOIs.map(v => {
                  const ec = expiryClass(v.expires_at)
                  return (
                    <TableRow key={v.id} className={ec === 'expiring' ? 'bg-yellow-50/50' : ec === 'expired' ? 'bg-gray-50/50' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {v.photos && v.photos.length > 0
                            ? <img src={v.photos[0]} alt="" className="h-7 w-10 rounded object-cover border" />
                            : <div className="h-7 w-10 rounded bg-muted flex items-center justify-center"><Car className="h-4 w-4 text-muted-foreground" /></div>}
                          <span className="font-mono font-semibold">{v.plate_number}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {[v.vehicle_year, v.vehicle_color, v.vehicle_make, v.vehicle_model].filter(Boolean).join(' ') || '—'}
                      </TableCell>
                      <TableCell>{statusBadge(v.status)}</TableCell>
                      <TableCell className="text-sm max-w-36 truncate">{v.reason ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {v.persons_of_interest
                          ? <span className="flex items-center gap-1 text-blue-700"><Link2 className="h-3 w-3" />{v.persons_of_interest.full_name}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatTs(v.zone_last_observed_at)}</TableCell>
                      <TableCell className="text-xs">
                        {v.expires_at
                          ? <span className={ec === 'expired' ? 'text-red-600' : ec === 'expiring' ? 'text-yellow-700 font-medium' : ''}>{formatTs(v.expires_at)}</span>
                          : <span className="text-muted-foreground">No expiry</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
