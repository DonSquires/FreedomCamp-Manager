/**
 * FlaggedVehicleManager — B-85
 *
 * Admin manager for flagged_vehicles.
 *
 * Features:
 *  - KPI cards: Total / Active / Inactive / Confirmed Homeless
 *  - Filters: is_active toggle, priority select, free-text (plate / reason / notes)
 *  - Table: plate_number, vehicle_description, priority badge, confirmed_homeless badge,
 *           is_active badge, last_known_site, date_recorded
 *  - Expandable row: reason, notes, name_contact, attachments note
 *  - Actions: Deactivate (is_active → false) / Reactivate (is_active → true) per row
 *
 * Route: /flagged-vehicles-manager — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Flag, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Car,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type FlaggedVehicle = Database['public']['Tables']['flagged_vehicles']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function priorityBadge(p: string | null) {
  switch (p) {
    case 'high':   return <Badge variant="destructive" className="text-xs">High</Badge>
    case 'medium': return <Badge variant="outline" className="text-xs text-amber-700">Medium</Badge>
    case 'low':    return <Badge variant="secondary" className="text-xs">Low</Badge>
    default:       return <Badge variant="outline" className="text-xs text-muted-foreground">{p ?? '—'}</Badge>
  }
}

function activeBadge(active: boolean) {
  return active
    ? <Badge variant="secondary" className="text-xs text-green-700"><CheckCircle2 className="h-3 w-3 mr-1 inline" />Active</Badge>
    : <Badge variant="outline" className="text-xs text-muted-foreground"><XCircle className="h-3 w-3 mr-1 inline" />Inactive</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlaggedVehicleManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]             = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [priorityFilter, setPriority]   = useState('all')
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: vehicles = [], isLoading, refetch } = useQuery({
    queryKey: ['flagged-vehicles', orgId, activeFilter, priorityFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('flagged_vehicles')
        .select('*')
        .eq('organization_id', orgId!)
        .order('date_recorded', { ascending: false })
        .limit(500)

      if (activeFilter === 'active')   q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (priorityFilter !== 'all')    q = q.eq('priority', priorityFilter)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as FlaggedVehicle[]
    },
  })

  // ── Toggle active mutation ─────────────────────────────────────────────────

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('flagged_vehicles')
        .update({ is_active: active, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['flagged-vehicles'] })
      toast.success(vars.active ? 'Vehicle reactivated' : 'Vehicle deactivated')
    },
    onError: (e: any) => toast.error(e.message || 'Update failed'),
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:     vehicles.length,
    active:    vehicles.filter(v => v.is_active).length,
    inactive:  vehicles.filter(v => !v.is_active).length,
    homeless:  vehicles.filter(v => v.confirmed_homeless).length,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = vehicles.filter(v => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !v.plate_number.toLowerCase().includes(q) &&
        !v.reason?.toLowerCase().includes(q) &&
        !v.notes?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Flagged Vehicle Manager" description="Manage flagged vehicles and their active status">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-red-600" />
          <span className="font-semibold text-lg">Flagged Vehicle Manager</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',             value: kpis.total,    icon: <Car className="h-4 w-4" />,          color: 'text-foreground' },
          { label: 'Active',            value: kpis.active,   icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-600' },
          { label: 'Inactive',          value: kpis.inactive, icon: <XCircle className="h-4 w-4" />,      color: 'text-muted-foreground' },
          { label: 'Confirmed Homeless',value: kpis.homeless, icon: <Flag className="h-4 w-4" />,         color: 'text-amber-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
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
            placeholder="Search plate, reason, notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriority}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Empty state */}
      {!isLoading && vehicles.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No flagged vehicles found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Plate</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Homeless</TableHead>
              <TableHead>Last Site</TableHead>
              <TableHead>Date</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && vehicles.length > 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No vehicles match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(v => {
              const expanded = expandedId === v.id
              return [
                <TableRow
                  key={v.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : v.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono font-semibold">{v.plate_number}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-36 truncate">
                    {v.vehicle_description ?? '—'}
                  </TableCell>
                  <TableCell>{priorityBadge(v.priority)}</TableCell>
                  <TableCell>{activeBadge(v.is_active)}</TableCell>
                  <TableCell>
                    {v.confirmed_homeless
                      ? <Badge variant="outline" className="text-xs text-amber-700">Yes</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-36 truncate">
                    {v.last_known_site ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(v.date_recorded)}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-7 text-xs ${v.is_active ? 'text-red-600 hover:text-red-700' : 'text-green-700 hover:text-green-800'}`}
                      onClick={() => toggleActive.mutate({ id: v.id, active: !v.is_active })}
                      disabled={toggleActive.isPending}
                    >
                      {toggleActive.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : v.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${v.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={8} className="py-3 space-y-2 text-sm">
                      {v.reason && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason</span>
                          <p className="mt-0.5">{v.reason}</p>
                        </div>
                      )}
                      {v.notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                          <p className="mt-0.5">{v.notes}</p>
                        </div>
                      )}
                      {v.name_contact && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact</span>
                          <p className="mt-0.5">{v.name_contact}</p>
                        </div>
                      )}
                      {v.attachments && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Attachments</span>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {typeof v.attachments === 'string' ? v.attachments : JSON.stringify(v.attachments)}
                          </p>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {vehicles.length} vehicles
        </p>
      )}
    </AppLayout>
  )
}
