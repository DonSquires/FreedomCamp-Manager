/**
 * FlaggedVehicleManager — B-85
 * Manager for flagged_vehicles — vehicles of interest for patrol monitoring.
 * Route: /flagged-vehicles-manager — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Flag, Search, RefreshCw, AlertCircle, Loader2,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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

type FlaggedVehicleRow = Database['public']['Tables']['flagged_vehicles']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const PRIORITY_COLOURS: Record<string, string> = {
  high:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low:    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FlaggedVehicleManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]           = useState('')
  const [filterActive, setFilterActive] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: vehicles = [], isLoading, error, refetch } = useQuery<FlaggedVehicleRow[]>({
    queryKey: ['flagged-vehicles', orgId],
    queryFn: async () => {
      let q = supabase
        .from('flagged_vehicles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = vehicles.filter(e => {
    if (filterActive   === 'true'  && !e.is_active) return false
    if (filterActive   === 'false' && e.is_active)  return false
    if (filterPriority !== 'all'   && e.priority !== filterPriority) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.plate_number?.toLowerCase().includes(s) ||
        e.reason?.toLowerCase().includes(s) ||
        e.name_contact?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total             = vehicles.length
  const active            = vehicles.filter(e => e.is_active === true).length
  const confirmedHomeless = vehicles.filter(e => e.confirmed_homeless === true).length
  const highPriority      = vehicles.filter(e => e.priority === 'high').length

  // ── Mutations ─────────────────────────────────────────────────────────────

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('flagged_vehicles').update({ is_active: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['flagged-vehicles'] }); toast.success('Vehicle deactivated') },
    onError: (e: Error) => toast.error(e.message),
  })

  const reactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('flagged_vehicles').update({ is_active: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['flagged-vehicles'] }); toast.success('Vehicle reactivated') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Flag className="h-7 w-7 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Flagged Vehicle Manager</h1>
              <p className="text-sm text-muted-foreground">Vehicles of interest for patrol monitoring</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',              value: total,             colour: 'text-slate-600' },
            { label: 'Active',             value: active,            colour: active > 0 ? 'text-orange-600' : 'text-muted-foreground' },
            { label: 'Confirmed Homeless', value: confirmedHomeless, colour: 'text-blue-600' },
            { label: 'High Priority',      value: highPriority,      colour: highPriority > 0 ? 'text-red-600' : 'text-muted-foreground' },
          ].map(({ label, value, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Plate, reason, contact…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterActive} onValueChange={setFilterActive}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Active" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              {['high', 'medium', 'low'].map(p => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No flagged vehicles match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Homeless</TableHead>
                    <TableHead>Last Site</TableHead>
                    <TableHead>Date Recorded</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => (
                    <TableRow key={e.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono font-bold">{e.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm max-w-[160px] truncate">{e.reason ?? '—'}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${PRIORITY_COLOURS[e.priority ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {e.priority ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {e.is_active === true && (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Active</Badge>
                        )}
                        {e.is_active === false && (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {e.confirmed_homeless === true && (
                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Yes</Badge>
                        )}
                        {e.confirmed_homeless === false && (
                          <Badge className="bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-400">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{e.last_known_site ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(e.date_recorded)}</TableCell>
                      <TableCell onClick={ev => ev.stopPropagation()}>
                        {e.is_active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2"
                            disabled={deactivate.isPending}
                            onClick={() => deactivate.mutate(e.id)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2"
                            disabled={reactivate.isPending}
                            onClick={() => reactivate.mutate(e.id)}
                          >
                            Reactivate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
