import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ScanLine, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

export default function PatrolCheckpointLog() {
  const { user } = useAuthStore()
  const [activeFilter, setActiveFilter] = useState('all')
  const [requiredFilter, setRequiredFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PatrolCheckpointRow[]>({
    queryKey: ['patrol-checkpoints-log', activeFilter, requiredFilter, searchQuery, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('patrol_checkpoints')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (requiredFilter === 'required') q = q.eq('required_on_patrol', true)
      if (requiredFilter === 'optional') q = q.eq('required_on_patrol', false)
      if (searchQuery.trim()) q = q.or(`name.ilike.%${searchQuery.trim()}%,qr_code.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((row) => row.is_active).length
  const requiredCount = rows.filter((row) => row.required_on_patrol).length
  const geoCount = rows.filter((row) => row.location_lat != null && row.location_lng != null).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScanLine className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Patrol Checkpoint Log</h1>
              <p className="text-sm text-muted-foreground">Checkpoint audit view for patrol_checkpoints used in lone-worker patrol flows</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Checkpoints', value: rows.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Required', value: requiredCount, color: 'text-amber-700' },
            { label: 'With GPS', value: geoCount, color: 'text-sky-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Active state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={requiredFilter} onValueChange={setRequiredFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Patrol use" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="required">Required</SelectItem>
              <SelectItem value="optional">Optional</SelectItem>
            </SelectContent>
          </Select>
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Checkpoint or QR…" className="w-52" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No patrol checkpoints found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Radius</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.name ?? '—'}</TableCell>
                      <TableCell>{row.is_active ? <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge> : <Badge variant="outline" className="text-xs">Inactive</Badge>}</TableCell>
                      <TableCell>{row.required_on_patrol ? <Badge className="bg-amber-100 text-amber-800 text-xs">Required</Badge> : <Badge variant="outline" className="text-xs">Optional</Badge>}</TableCell>
                      <TableCell className="text-sm">{row.check_in_radius_metres ?? 0} m</TableCell>
                      <TableCell className="text-xs font-mono">{row.zone_id ?? '—'}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Checkpoint ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">QR Code:</span> {row.qr_code ?? '—'}</div>
                            <div><span className="font-medium">NFC Tag:</span> {row.nfc_tag_id ?? '—'}</div>
                            <div><span className="font-medium">Latitude:</span> {row.location_lat ?? '—'}</div>
                            <div><span className="font-medium">Longitude:</span> {row.location_lng ?? '—'}</div>
                          </div>
                          {row.description && <div><span className="font-medium">Description:</span> {row.description}</div>}
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
