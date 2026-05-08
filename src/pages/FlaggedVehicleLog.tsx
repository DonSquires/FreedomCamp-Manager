import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Flag, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type FlaggedVehicleRow = Database['public']['Tables']['flagged_vehicles']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const PRIORITY_COLOURS: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-blue-100 text-blue-800',
}

function priorityBadge(priority: string | null) {
  return PRIORITY_COLOURS[priority?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-700'
}

export default function FlaggedVehicleLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<FlaggedVehicleRow[]>({
    queryKey: ['flagged-vehicles-log', user?.role, orgId, searchQuery, activeFilter, priorityFilter, dateFrom],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from('flagged_vehicles')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (user?.role !== 'master') q = q.eq('organization_id', orgId ?? '')
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`plate_number.ilike.%${term}%,reason.ilike.%${term}%,name_contact.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(r => r.is_active).length
  const homelessCount = rows.filter(r => r.confirmed_homeless).length
  const highPriorityCount = rows.filter(r => r.priority === 'high').length
  const priorities = [...new Set(rows.map(r => r.priority).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Flag className="h-6 w-6 text-rose-600" />
            <div>
              <h1 className="text-2xl font-bold">Flagged Vehicle Log</h1>
              <p className="text-sm text-muted-foreground">Vehicle flags with priority, homelessness confirmation, and lifecycle metadata</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Flags', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-blue-700' },
            { label: 'High Priority', value: highPriorityCount, colour: 'text-rose-700' },
            { label: 'Confirmed Homeless', value: homelessCount, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate, reason, contact…" className="w-64" />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorities.map(p => <SelectItem key={p} value={p!}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono text-xs">{row.plate_number}</TableCell>
                      <TableCell><Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>{row.is_active ? 'active' : 'inactive'}</Badge></TableCell>
                      <TableCell><Badge className={priorityBadge(row.priority)}>{row.priority ?? '—'}</Badge></TableCell>
                      <TableCell className="text-sm max-w-[18rem] truncate">{row.reason ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.name_contact ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Flag ID:</span> {row.id}</div>
                          <div><span className="font-medium">Vehicle description:</span> {row.vehicle_description ?? '—'} &nbsp; <span className="font-medium">Last known site:</span> {row.last_known_site ?? '—'}</div>
                          <div><span className="font-medium">Confirmed homeless:</span> {row.confirmed_homeless == null ? '—' : row.confirmed_homeless ? 'yes' : 'no'} &nbsp; <span className="font-medium">Date recorded:</span> {fmtDate(row.date_recorded)}</div>
                          <div><span className="font-medium">Created by:</span> {row.created_by ?? '—'} &nbsp; <span className="font-medium">Flagged by:</span> {row.flagged_by ?? '—'}</div>
                          <div><span className="font-medium">Organization:</span> {row.organization_id ?? '—'} &nbsp; <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
