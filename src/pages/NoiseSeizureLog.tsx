import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Siren, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, ExternalLink,
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

type NoiseSeizureRow = Database['public']['Tables']['noise_seizures']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtNzd(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(v)
}

function statusTone(status: string) {
  const s = status.toLowerCase()
  if (s.includes('returned')) return 'bg-green-100 text-green-800'
  if (s.includes('disposed')) return 'bg-gray-100 text-gray-700'
  if (s.includes('custody') || s.includes('active')) return 'bg-red-100 text-red-800'
  return 'bg-blue-100 text-blue-800'
}

export default function NoiseSeizureLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [statusFilter, setStatusFilter] = useState('all')
  const [equipmentFilter, setEquipmentFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<NoiseSeizureRow[]>({
    queryKey: ['noise-seizures-log', orgId, statusFilter, equipmentFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('noise_seizures')
        .select('*')
        .eq('organization_id', orgId!)
        .order('seized_at', { ascending: false })
        .limit(500)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (equipmentFilter !== 'all') q = q.eq('equipment_type', equipmentFilter)
      if (dateFrom) q = q.gte('seized_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const statuses = [...new Set(rows.map(r => r.status).filter(Boolean))].sort()
  const equipmentTypes = [...new Set(rows.map(r => r.equipment_type).filter(Boolean))].sort()
  const inCustodyCount = rows.filter(r => !(r.status.toLowerCase().includes('returned') || r.status.toLowerCase().includes('disposed'))).length
  const totalValue = rows.reduce((sum, r) => sum + (r.estimated_value_nzd ?? 0), 0)

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Siren className="h-6 w-6 text-red-600" />
            <div>
              <h1 className="text-2xl font-bold">Noise Seizure Log</h1>
              <p className="text-sm text-muted-foreground">Equipment seizure records for noise enforcement actions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Seizures', value: rows.length, colour: 'text-gray-700' },
            { label: 'In Custody', value: inCustodyCount, colour: 'text-red-700' },
            { label: 'Est. Total Value', value: fmtNzd(totalValue), colour: 'text-violet-700' },
            { label: 'Equipment Types', value: equipmentTypes.length, colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={equipmentFilter} onValueChange={setEquipmentFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Equipment type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All equipment</SelectItem>
              {equipmentTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No seizure records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Seizure #</TableHead>
                  <TableHead>Seized At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Equipment Type</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Est. Value</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-medium">{row.seizure_number}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.seized_at)}</TableCell>
                        <TableCell><Badge className={statusTone(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell className="text-sm">{row.equipment_type ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.equipment_count}</TableCell>
                        <TableCell className="text-sm">{fmtNzd(row.estimated_value_nzd)}</TableCell>
                        <TableCell className="text-sm max-w-44 truncate">{row.address}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Description:</span> <span className="text-muted-foreground">{row.equipment_description}</span></div>
                              <div><span className="font-medium">Owner:</span> <span className="text-muted-foreground">{row.owner_name ?? '—'}</span></div>
                              <div><span className="font-medium">Storage:</span> <span className="text-muted-foreground">{row.storage_location ?? '—'}</span></div>
                              <div><span className="font-medium">Police Present:</span> <span className="text-muted-foreground">{row.police_present ? 'Yes' : 'No'}</span></div>
                              <div><span className="font-medium">Serial Numbers:</span> <span className="text-muted-foreground">{row.serial_numbers?.join(', ') || '—'}</span></div>
                              <div><span className="font-medium">Return Date:</span> <span className="text-muted-foreground">{fmtDate(row.return_date)}</span></div>
                              <div className="md:col-span-2"><span className="font-medium">Notes:</span> <span className="text-muted-foreground">{row.notes ?? '—'}</span></div>
                              <div className="md:col-span-2">
                                <span className="font-medium">Photos:</span>{' '}
                                {row.photos?.length ? (
                                  <span className="inline-flex flex-wrap gap-2">
                                    {row.photos.map((url, idx) => (
                                      <a key={`${row.id}-photo-${idx}`} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                                        Photo {idx + 1} <ExternalLink className="h-3 w-3" />
                                      </a>
                                    ))}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
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
          </div>
        )}
      </div>
    </AppLayout>
  )
}
