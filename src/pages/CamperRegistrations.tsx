/**
 * CamperRegistrations — B-56
 *
 * Staff admin view of all camper stay registrations submitted via the
 * public /public/register portal.
 *
 * Features:
 *  - KPI cards: Active / Departed / Cancelled / Total tonight
 *  - Mark Departed / Cancel actions
 *  - Expandable row: vehicle details, contact, stay notes
 *  - Filters: zone, status, date, plate / confirmation code search
 *  - Link to public portal  
 *
 * Route: /camper-registrations  — admin / admin_officer / master
 * Note: camper_registrations not in database.ts snapshot — uses (supabase as any)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Tent, CheckCircle, XCircle, Moon, Car, Users,
  Loader2, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, Phone, Mail, User, ExternalLink, MapPin,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ─── Types ───────────────────────────────────────────────────────────────────

type RegStatus = 'active' | 'departed' | 'cancelled'

interface ZoneOption { id: string; name: string }

interface CamperRegistration {
  id: string
  zone_id: string
  zone?: ZoneOption
  confirmation_code: string
  plate_number: string | null
  vehicle_type: string | null
  is_self_contained: boolean
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  party_size: number
  arrival_date: string
  departure_date: string
  nights: number
  notes: string | null
  status: RegStatus
  created_at: string
  updated_at: string
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<RegStatus, { label: string; colour: string }> = {
  active:    { label: 'Active',    colour: 'text-green-700 bg-green-50 dark:bg-green-900/30' },
  departed:  { label: 'Departed',  colour: 'text-blue-700 bg-blue-50 dark:bg-blue-900/30'   },
  cancelled: { label: 'Cancelled', colour: 'text-gray-600 bg-gray-100 dark:bg-gray-800'     },
}

const VEHICLE_LABELS: Record<string, string> = {
  self_contained: 'Self-contained',
  campervan:      'Campervan',
  tent:           'Tent',
  car:            'Car',
  motorhome:      'Motorhome',
  other:          'Other',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CamperRegistrations() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [zoneFilter, setZoneFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Zones query (for filter dropdown) ─────────────────────────────────────
  const { data: zones = [] } = useQuery<ZoneOption[]>({
    queryKey: ['zones_simple', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', orgId as string)
        .order('name')
      if (error) throw error
      return data as ZoneOption[]
    },
  })

  // ── Registrations query ────────────────────────────────────────────────────
  const { data: regs = [], isLoading, error, refetch } = useQuery<CamperRegistration[]>({
    queryKey: ['camper_registrations', orgId, statusFilter, zoneFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = (supabase as any)
        .from('camper_registrations')
        .select(`
          *,
          zone:zones!zone_id ( id, name )
        `)
        .in('zone_id', (
          await supabase
            .from('zones')
            .select('id')
            .eq('organization_id', orgId as string)
            .then(r => (r.data ?? []).map((z: { id: string }) => z.id))
        ))
        .order('created_at', { ascending: false })

      if (statusFilter !== 'all')    q = q.eq('status', statusFilter)
      if (zoneFilter  !== 'all')     q = q.eq('zone_id', zoneFilter)
      if (dateFrom)                  q = q.gte('arrival_date', dateFrom)
      if (dateTo)                    q = q.lte('arrival_date', dateTo)

      const { data, error } = await q
      if (error) throw error
      return data as CamperRegistration[]
    },
  })

  // ── Mutation: update status ────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RegStatus }) => {
      const { error } = await (supabase as any)
        .from('camper_registrations')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { status }) => {
      toast.success(`Registration marked as ${STATUS_CONFIG[status].label.toLowerCase()}.`)
      qc.invalidateQueries({ queryKey: ['camper_registrations'] })
    },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = regs.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.confirmation_code.toLowerCase().includes(q) ||
      (r.plate_number?.toLowerCase().includes(q) ?? false) ||
      (r.contact_name?.toLowerCase().includes(q) ?? false)
    )
  })

  const kpi = {
    active:    regs.filter(r => r.status === 'active').length,
    departed:  regs.filter(r => r.status === 'departed').length,
    cancelled: regs.filter(r => r.status === 'cancelled').length,
    tonight:   regs.filter(r => {
      if (r.status !== 'active') return false
      const today = format(new Date(), 'yyyy-MM-dd')
      return r.arrival_date <= today && r.departure_date >= today
    }).length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tent className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Camper Registrations</h1>
              <p className="text-sm text-muted-foreground">Self-registered camper stays across all zones</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/public/register" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" /> Public Portal
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Active</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-green-600">{kpi.active}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Moon className="h-3.5 w-3.5" /> Staying Tonight</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-emerald-600">{kpi.tonight}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Car className="h-3.5 w-3.5" /> Departed</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-blue-600">{kpi.departed}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> Cancelled</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-gray-500">{kpi.cancelled}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-xs">Search</Label>
                <Input
                  placeholder="Confirmation code, plate, contact name…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Zone</Label>
                <Select value={zoneFilter} onValueChange={setZoneFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All zones</SelectItem>
                    {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="departed">Departed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Arrival Date Range</Label>
                <div className="flex gap-1">
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-xs" />
                  <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="text-xs" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center">
            <AlertCircle className="h-5 w-5" /> Failed to load registrations.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Tent className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No registrations match your filters.</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Code</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Arrival</TableHead>
                  <TableHead>Nights</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(reg => {
                  const expanded = expandedId === reg.id
                  const cfg = STATUS_CONFIG[reg.status]
                  return (
                    <>
                      <TableRow
                        key={reg.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : reg.id)}
                      >
                        <TableCell className="py-2">
                          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">{reg.confirmation_code}</TableCell>
                        <TableCell className="text-sm">{reg.zone?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{reg.plate_number ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(parseISO(reg.arrival_date), 'dd MMM yyyy')}
                        </TableCell>
                        <TableCell className="text-sm">{reg.nights}</TableCell>
                        <TableCell className="text-sm">
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />{reg.party_size}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.colour}`}>{cfg.label}</span>
                        </TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {reg.status === 'active' && (
                              <>
                                <Button
                                  size="sm" variant="outline"
                                  className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                                  onClick={() => updateStatus.mutate({ id: reg.id, status: 'departed' })}
                                  disabled={updateStatus.isPending}
                                >
                                  <Car className="h-3 w-3 mr-1" /> Departed
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
                                  onClick={() => updateStatus.mutate({ id: reg.id, status: 'cancelled' })}
                                  disabled={updateStatus.isPending}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> Cancel
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded detail */}
                      {expanded && (
                        <TableRow key={`${reg.id}-detail`} className="bg-muted/30">
                          <TableCell colSpan={9} className="py-4 px-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-muted-foreground">Vehicle</p>
                                <div className="space-y-0.5">
                                  {reg.vehicle_type && <p className="text-sm flex items-center gap-1.5"><Car className="h-3.5 w-3.5 text-muted-foreground" />{VEHICLE_LABELS[reg.vehicle_type] ?? reg.vehicle_type}</p>}
                                  <p className="text-sm text-muted-foreground">{reg.is_self_contained ? '✅ Self-contained (CSC)' : '❌ Not self-contained'}</p>
                                </div>
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-muted-foreground">Stay Details</p>
                                <div className="space-y-0.5">
                                  <p className="text-sm flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{reg.zone?.name ?? '—'}</p>
                                  <p className="text-sm text-muted-foreground">{format(parseISO(reg.arrival_date), 'dd MMM')} → {format(parseISO(reg.departure_date), 'dd MMM yyyy')} ({reg.nights} night{reg.nights !== 1 ? 's' : ''})</p>
                                  {reg.notes && <p className="text-sm italic text-muted-foreground">"{reg.notes}"</p>}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-muted-foreground">Contact</p>
                                <div className="space-y-0.5">
                                  {reg.contact_name  && <p className="text-sm flex items-center gap-1.5"><User  className="h-3.5 w-3.5 text-muted-foreground" />{reg.contact_name}</p>}
                                  {reg.contact_email && <p className="text-sm flex items-center gap-1.5"><Mail  className="h-3.5 w-3.5 text-muted-foreground" />{reg.contact_email}</p>}
                                  {reg.contact_phone && <p className="text-sm flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{reg.contact_phone}</p>}
                                  {!reg.contact_name && !reg.contact_email && !reg.contact_phone && <p className="text-sm text-muted-foreground italic">No contact provided</p>}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
