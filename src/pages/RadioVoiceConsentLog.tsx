import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Mic, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
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

type VoiceConsentRow = Database['public']['Views']['radio_voice_consents']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function RadioVoiceConsentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [providerFilter, setProviderFilter] = useState('all')
  const [revokedFilter, setRevokedFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<VoiceConsentRow[]>({
    queryKey: ['radio-voice-consent-log', orgId, providerFilter, revokedFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_voice_consents')
        .select('*')
        .eq('org_id', orgId!)
        .order('consented_at', { ascending: false })
        .limit(500)

      if (providerFilter !== 'all') q = q.eq('provider', providerFilter)
      if (revokedFilter === 'revoked') q = q.not('revoked_at', 'is', null)
      if (revokedFilter === 'active') q = q.is('revoked_at', null)
      if (dateFrom) q = q.gte('consented_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const providers = [...new Set(rows.map(r => r.provider).filter(Boolean))].sort()
  const revokedCount = rows.filter(r => !!r.revoked_at).length
  const activeCount = rows.length - revokedCount
  const avgRetention = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + (r.retention_days ?? 0), 0) / rows.length)
    : 0

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mic className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Voice Consent Log</h1>
              <p className="text-sm text-muted-foreground">Consent records for radio voice profiles and retention settings</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Consents', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-green-700' },
            { label: 'Revoked', value: revokedCount, colour: 'text-red-700' },
            { label: 'Avg Retention', value: `${avgRetention}d`, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={revokedFilter} onValueChange={setRevokedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Revocation" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="revoked">Revoked only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No radio voice consent records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Consented At</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Revoked At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.consented_at)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id.slice(0, 8)}…</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.provider}</Badge></TableCell>
                        <TableCell className="text-sm max-w-44 truncate">{row.purpose}</TableCell>
                        <TableCell className="text-sm">{row.retention_days} days</TableCell>
                        <TableCell>
                          {row.revoked_at
                            ? <Badge className="bg-red-100 text-red-800">Revoked</Badge>
                            : <Badge className="bg-green-100 text-green-800">Active</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.revoked_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Consent ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                              <div><span className="font-medium">Voice Profile:</span> <span className="font-mono text-xs">{row.voice_profile_id ?? '—'}</span></div>
                              <div><span className="font-medium">Org:</span> <span className="font-mono text-xs">{row.org_id}</span></div>
                              <div><span className="font-medium">Created:</span> <span className="text-muted-foreground">{fmtDate(row.created_at)}</span></div>
                              <div className="md:col-span-2"><span className="font-medium">Revocation Reason:</span> <span className="text-muted-foreground">{row.revocation_reason ?? '—'}</span></div>
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
