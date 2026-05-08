/**
 * LmrBridgeConfigLog — B-145
 *
 * Admin log and viewer for lmr_bridge_config.
 * Displays bridge configuration endpoints, channel direction,
 * active status, and organization coverage without exposing secrets.
 *
 * Route: /lmr-bridge-config-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { RadioTower, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type BridgeConfigRow = Database['public']['Tables']['lmr_bridge_config']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtGatewayToken(token: string | null) {
  if (!token) return 'Not configured'
  return `Configured (${token.length} chars)`
}

export default function LmrBridgeConfigLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [directionFilter, setDirectionFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<BridgeConfigRow[]>({
    queryKey: ['lmr-bridge-config-log', orgId, searchQuery, directionFilter, activeFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('lmr_bridge_config')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (searchQuery.trim()) q = q.or(`label.ilike.%${searchQuery.trim()}%,gateway_url.ilike.%${searchQuery.trim()}%,radio_channel.ilike.%${searchQuery.trim()}%`)
      if (directionFilter !== 'all') q = q.eq('direction', directionFilter)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const directions = [...new Set(rows.map(row => row.direction).filter(Boolean))].sort()
  const activeCount = rows.filter(row => row.is_active).length
  const inboundCount = rows.filter(row => row.direction === 'inbound').length
  const withToken = rows.filter(row => !!row.gateway_token).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RadioTower className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">LMR Bridge Config Log</h1>
              <p className="text-sm text-muted-foreground">Bridge endpoint configuration with direction, channel, and activation status</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Configs', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-emerald-700' },
            { label: 'Inbound', value: inboundCount, colour: 'text-sky-700' },
            { label: 'Gateway Token Set', value: withToken, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search label, gateway, or channel…" className="w-72" />
          <Select value={directionFilter} onValueChange={setDirectionFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Direction" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All directions</SelectItem>
              {directions.map(direction => <SelectItem key={direction} value={direction}>{direction}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
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
                  <TableHead>Label</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-medium text-sm">{row.label}</TableCell>
                      <TableCell><Badge className={row.direction === 'inbound' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'}>{row.direction}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.radio_channel}</TableCell>
                      <TableCell>
                        <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[16rem] truncate">{row.gateway_url}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.updated_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div><span className="font-medium">Organization:</span> {row.organization_id}</div>
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                          <div><span className="font-medium">Gateway token:</span> {fmtGatewayToken(row.gateway_token)}</div>
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
