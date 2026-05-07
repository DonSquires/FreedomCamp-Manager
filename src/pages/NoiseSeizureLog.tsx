import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Speaker, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

type NoiseSeizure = Database['public']['Tables']['noise_seizures']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function money(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(v)
}

function statusBadge(v: string) {
  const s = v.toLowerCase()
  if (s.includes('active') || s.includes('held')) return 'bg-yellow-100 text-yellow-800'
  if (s.includes('disposed')) return 'bg-slate-100 text-slate-800'
  if (s.includes('returned')) return 'bg-green-100 text-green-800'
  return 'bg-blue-100 text-blue-800'
}

export default function NoiseSeizureLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<NoiseSeizure[]>({
    queryKey: ['noise-seizure-log', orgId, statusFilter, equipmentTypeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('noise_seizures')
        .select('*')
        .eq('organization_id', orgId!)
        .order('seized_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (equipmentTypeFilter !== 'all') q = q.eq('equipment_type', equipmentTypeFilter)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows])
  const equipmentTypes = useMemo(() => [...new Set(rows.map((r) => r.equipment_type).filter(Boolean))].sort(), [rows])
  const estTotal = rows.reduce((sum, row) => sum + (row.estimated_value_nzd ?? 0), 0)
  const withPolice = rows.filter((r) => r.police_present).length
  const withPhotos = rows.filter((r) => (r.photos?.length ?? 0) > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Speaker className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Noise Seizure Log</h1>
              <p className="text-sm text-muted-foreground">Equipment seizures under noise enforcement workflows</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Seizures', value: rows.length, color: 'text-slate-700' },
            { label: 'Estimated Value', value: money(estTotal), color: 'text-amber-700' },
            { label: 'Police Present', value: withPolice, color: 'text-blue-700' },
            { label: 'With Photos', value: withPhotos, color: 'text-emerald-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={equipmentTypeFilter} onValueChange={setEquipmentTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Equipment type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All equipment</SelectItem>
              {equipmentTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No seizures found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Seized At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Seizure #</TableHead>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Est. Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.seized_at)}</TableCell>
                        <TableCell><Badge className={`text-xs ${statusBadge(row.status)}`}>{row.status}</Badge></TableCell>
                        <TableCell className="font-mono text-sm">{row.seizure_number}</TableCell>
                        <TableCell className="text-sm">{row.equipment_type ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.equipment_count}</TableCell>
                        <TableCell className="text-sm">{money(row.estimated_value_nzd)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Address: {row.address}</span>
                              <span>Owner: {row.owner_name ?? '—'}</span>
                              <span>Officer: {row.seizing_officer_name ?? row.seizing_officer_id ?? '—'}</span>
                              <span>Storage: {row.storage_location ?? '—'}</span>
                              <span>GPS: {row.gps_lat ?? '—'}, {row.gps_lng ?? '—'}</span>
                              <span>Police present: {row.police_present ? 'Yes' : 'No'}</span>
                            </div>
                            <div>
                              <p className="font-medium text-sm mb-1">Equipment</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.equipment_description}</p>
                            </div>
                            {row.notes && (
                              <div>
                                <p className="font-medium text-sm mb-1">Notes</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.notes}</p>
                              </div>
                            )}
                            {row.photos && row.photos.length > 0 && (
                              <div>
                                <p className="font-medium text-sm mb-1">Photos</p>
                                <div className="space-y-1">
                                  {row.photos.map((photo) => (
                                    <a
                                      key={photo}
                                      href={photo}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block text-xs text-blue-600 underline break-all"
                                    >
                                      {photo}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
