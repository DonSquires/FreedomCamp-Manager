import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Building2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ClientSiteRow = Database['public']['Tables']['client_sites']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

const PRIORITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-amber-100 text-amber-800',
  medium: 'bg-blue-100 text-blue-800',
  low: 'bg-slate-100 text-slate-700',
}

function priorityBadge(priority: string | null) {
  return PRIORITY_COLOURS[priority?.toLowerCase() ?? ''] ?? 'bg-slate-100 text-slate-700'
}

export default function ClientSiteLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [siteTypeFilter, setSiteTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ClientSiteRow[]>({
    queryKey: ['client-site-log', user?.role, orgId, searchQuery, activeFilter, siteTypeFilter, priorityFilter, dateFrom],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from('client_sites')
        .select('*')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (user?.role !== 'master') {
        if (!orgId) return []
        q = q.eq('organization_id', orgId)
      }

      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (siteTypeFilter !== 'all') q = q.eq('site_type', siteTypeFilter)
      if (priorityFilter !== 'all') q = q.eq('priority_override', priorityFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`name.ilike.%${term}%,site_code.ilike.%${term}%,address.ilike.%${term}%,contact_name.ilike.%${term}%,contact_email.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((row) => row.is_active).length
  const inactiveCount = rows.length - activeCount
  const types = [...new Set(rows.map((row) => row.site_type).filter(Boolean))].sort()
  const priorities = [...new Set(rows.map((row) => row.priority_override).filter(Boolean))].sort()

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Client Site Log</h1>
              <p className="text-sm text-muted-foreground">Client site registry with contract, contact, geofence, and commercial metadata</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Sites', value: rows.length, colour: 'text-slate-700' },
            { label: 'Active', value: activeCount, colour: 'text-green-700' },
            { label: 'Inactive', value: inactiveCount, colour: 'text-rose-700' },
            { label: 'Site Types', value: types.length, colour: 'text-violet-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search site, code, address, contact…" className="w-72" />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={siteTypeFilter} onValueChange={setSiteTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Site type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All site types</SelectItem>
              {types.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {priorities.map((priority) => <SelectItem key={priority} value={priority!}>{priority}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Site</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Contract End</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{row.site_code ?? row.id}</div>
                      </TableCell>
                      <TableCell className="text-sm">{row.site_type}</TableCell>
                      <TableCell><Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}>{row.is_active ? 'active' : 'inactive'}</Badge></TableCell>
                      <TableCell><Badge className={priorityBadge(row.priority_override)}>{row.priority_override ?? 'standard'}</Badge></TableCell>
                      <TableCell className="text-sm">{row.contact_name ?? row.contact_email ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.contract_end_date)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Address:</span> {row.address ?? '—'}{row.city ? `, ${row.city}` : ''}</div>
                          <div><span className="font-medium">Contact:</span> {row.contact_name ?? '—'} · {row.contact_email ?? '—'} · {row.contact_phone ?? '—'}</div>
                          <div><span className="font-medium">Emergency:</span> {row.emergency_contact_name ?? '—'} · {row.emergency_contact_phone ?? '—'}</div>
                          <div><span className="font-medium">Contract:</span> {fmtDate(row.contract_start_date)} → {fmtDate(row.contract_end_date)} · <span className="font-medium">PO:</span> {row.purchase_order_number ?? '—'}</div>
                          <div><span className="font-medium">Charge/Pay:</span> {row.default_charge_rate ?? '—'} / {row.default_pay_rate ?? '—'} · <span className="font-medium">Response mins:</span> {row.default_response_minutes ?? '—'}</div>
                          <div><span className="font-medium">Geo:</span> {row.gps_lat ?? '—'}, {row.gps_lng ?? '—'} · <span className="font-medium">Radius:</span> {row.geofence_radius_metres}m · <span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                          {row.special_instructions && <div><span className="font-medium">Special instructions:</span> {row.special_instructions}</div>}
                          {row.hazards && <div><span className="font-medium">Hazards:</span> {row.hazards}</div>}
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
