/**
 * PatrolCheckpointLog — B-177
 *
 * Admin viewer for patrol_checkpoints.
 * Displays patrol checkpoint configurations including zone assignments,
 * NFC tags, QR codes, check-in radius, and active/required status.
 *
 * Route: /patrol-checkpoints-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Navigation2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type PatrolCheckpointRow = Database['public']['Tables']['patrol_checkpoints']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function boolBadge(val: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  if (val == null) return <span className="text-muted-foreground">—</span>
  return (
    <Badge className={val ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'}>
      {val ? trueLabel : falseLabel}
    </Badge>
  )
}

export default function PatrolCheckpointLog() {
  const { user } = useAuthStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [requiredFilter, setRequiredFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolCheckpointRow[]>({
    queryKey: ['patrol-checkpoints-log', user?.organization_id, searchQuery, activeFilter, requiredFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('patrol_checkpoints')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (searchQuery.trim()) q = q.ilike('name', `%${searchQuery.trim()}%`)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (requiredFilter === 'required') q = q.eq('required_on_patrol', true)
      if (requiredFilter === 'optional') q = q.eq('required_on_patrol', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(r => r.is_active).length
  const requiredCount = rows.filter(r => r.required_on_patrol).length
  const withNfcCount = rows.filter(r => r.nfc_tag_id).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Navigation2 className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Checkpoint Log</h1>
              <p className="text-sm text-muted-foreground">Patrol checkpoint configurations including zone assignments, NFC tags, QR codes, and check-in radius</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-emerald-700' },
            { label: 'Required on Patrol', value: requiredCount, colour: 'text-sky-700' },
            { label: 'With NFC', value: withNfcCount, colour: 'text-purple-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search checkpoint name…" className="w-52" />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Active status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={requiredFilter} onValueChange={setRequiredFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Required on patrol" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="required">Required</SelectItem>
              <SelectItem value="optional">Optional</SelectItem>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Radius (m)</TableHead>
                  <TableHead>NFC Tag</TableHead>
                  <TableHead>QR Code</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="font-medium text-sm">{row.name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.zone_id ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">{row.check_in_radius_metres}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[100px] truncate">{row.nfc_tag_id ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[100px] truncate">{row.qr_code}</TableCell>
                      <TableCell>{boolBadge(row.is_active, 'Active', 'Inactive')}</TableCell>
                      <TableCell>{boolBadge(row.required_on_patrol, 'Required', 'Optional')}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={9} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
                          <div>
                            <span className="font-medium">Lat:</span> {row.location_lat ?? '—'} &nbsp;
                            <span className="font-medium">Lng:</span> {row.location_lng ?? '—'}
                          </div>
                          {row.created_by && <div><span className="font-medium">Created by:</span> {row.created_by}</div>}
                          <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {activeCount} active &nbsp;·&nbsp; {requiredCount} required on patrol &nbsp;·&nbsp; {rows.length} total checkpoints
          </p>
        )}
      </div>
    </AppLayout>
  )
}
