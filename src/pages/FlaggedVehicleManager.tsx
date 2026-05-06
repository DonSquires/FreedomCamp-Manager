/**
 * FlaggedVehicleManager — B-85
 *
 * Manager for flagged_vehicles — vehicles flagged for enforcement attention.
 *
 * Features:
 *  - KPI cards: Total / Active / Confirmed Homeless / High Priority
 *  - Filters: is_active toggle, priority, plate search
 *  - Table: plate, description, priority, is_active badge, confirmed_homeless, date_recorded, reason
 *  - Deactivate / Reactivate inline toggle action
 *
 * Route: /flagged-vehicles-manager — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Flag, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, XCircle,
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
import { Checkbox } from '@/components/ui/checkbox'
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
import type { Database } from '@/types/database'

// ─── Types ─────────────────────────────────────────────────────────────────────

type FlaggedVehicle = Database['public']['Tables']['flagged_vehicles']['Row']

// ─── Styling maps ──────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-yellow-100 text-yellow-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FlaggedVehicleManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [plateSearch, setPlateSearch]     = useState('')
  const [prioFilter, setPrioFilter]       = useState('all')
  const [activeOnly, setActiveOnly]       = useState(true)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<FlaggedVehicle[]>({
    queryKey: ['flagged-vehicles', orgId, prioFilter, activeOnly],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('flagged_vehicles')
        .select('*')
        .eq('organization_id', orgId!)
        .order('date_recorded', { ascending: false })
        .limit(500)

      if (activeOnly)           q = q.eq('is_active', true)
      if (prioFilter !== 'all') q = q.eq('priority', prioFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const displayed = plateSearch
    ? rows.filter(r => r.plate_number.toLowerCase().includes(plateSearch.toLowerCase()))
    : rows

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total             = rows.length
  const active            = rows.filter(r => r.is_active).length
  const confirmedHomeless = rows.filter(r => r.confirmed_homeless).length
  const highPriority      = rows.filter(r => r.priority === 'high' || r.priority === 'critical').length

  // ── Mutation ──────────────────────────────────────────────────────────────

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('flagged_vehicles')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(vars.is_active ? 'Vehicle reactivated' : 'Vehicle deactivated')
      qc.invalidateQueries({ queryKey: ['flagged-vehicles'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Flag className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Flagged Vehicle Manager</h1>
              <p className="text-sm text-muted-foreground">Vehicles flagged for enforcement attention</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total',              value: total,             colour: 'text-gray-700' },
            { label: 'Active',             value: active,            colour: 'text-green-700' },
            { label: 'Confirmed Homeless', value: confirmedHomeless, colour: 'text-orange-700' },
            { label: 'High/Critical',      value: highPriority,      colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Input placeholder="Search plate…" value={plateSearch} onChange={e => setPlateSearch(e.target.value)} className="w-44" />
          <Select value={prioFilter} onValueChange={setPrioFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox id="active" checked={activeOnly} onCheckedChange={v => setActiveOnly(!!v)} />
            <Label htmlFor="active" className="text-sm cursor-pointer">Active only</Label>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No flagged vehicles found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plate</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Homeless</TableHead>
                  <TableHead>Date Recorded</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(row => {
                  const prioClass = PRIORITY_STYLES[row.priority ?? ''] ?? 'bg-gray-100 text-gray-600'
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono font-semibold">{row.plate_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{row.vehicle_description ?? '—'}</TableCell>
                      <TableCell>{row.priority ? <Badge className={prioClass}>{row.priority}</Badge> : '—'}</TableCell>
                      <TableCell>
                        {row.is_active
                          ? <Badge className="bg-green-100 text-green-800">Active</Badge>
                          : <Badge className="bg-gray-100 text-gray-600">Inactive</Badge>}
                      </TableCell>
                      <TableCell>
                        {row.confirmed_homeless
                          ? <Badge className="bg-orange-100 text-orange-800">Yes</Badge>
                          : <span className="text-muted-foreground text-sm">No</span>}
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.date_recorded)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{row.reason ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm" variant="outline"
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate({ id: row.id, is_active: !row.is_active })}
                        >
                          {row.is_active
                            ? <><XCircle className="h-4 w-4 mr-1" /> Deactivate</>
                            : <><CheckCircle2 className="h-4 w-4 mr-1" /> Reactivate</>}
                        </Button>
                      </TableCell>
                    </TableRow>
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
