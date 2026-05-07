import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, Mic, ChevronDown, ChevronRight } from 'lucide-react'
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

type RadioVoiceConsent = Database['public']['Views']['radio_voice_consents']['Row']

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

  const { data: rows = [], isLoading, refetch } = useQuery<RadioVoiceConsent[]>({
    queryKey: ['radio-voice-consent-log', orgId, providerFilter, revokedFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_voice_consents')
        .select('*')
        .eq('org_id', orgId!)
        .order('consented_at', { ascending: false })
        .limit(600)

      if (providerFilter !== 'all') q = q.eq('provider', providerFilter)
      if (revokedFilter === 'yes') q = q.not('revoked_at', 'is', null)
      if (revokedFilter === 'no') q = q.is('revoked_at', null)
      if (dateFrom) q = q.gte('consented_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const providers = useMemo(() => [...new Set(rows.map((r) => r.provider).filter(Boolean))].sort(), [rows])
  const revokedCount = rows.filter((r) => !!r.revoked_at).length
  const activeCount = rows.length - revokedCount
  const avgRetention = rows.length ? Math.round(rows.reduce((sum, r) => sum + (r.retention_days ?? 0), 0) / rows.length) : null

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mic className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Voice Consent Log</h1>
              <p className="text-sm text-muted-foreground">Officer voice profile consent and revocation records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Consents', value: rows.length, color: 'text-slate-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Revoked', value: revokedCount, color: 'text-red-700' },
            { label: 'Avg Retention', value: avgRetention == null ? '—' : `${avgRetention}d`, color: 'text-violet-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={revokedFilter} onValueChange={setRevokedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Revoked" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Revoked only</SelectItem>
              <SelectItem value="no">Active only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-44" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No voice consents found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Consented At</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  const revoked = !!row.revoked_at
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.consented_at)}</TableCell>
                        <TableCell className="text-sm">{row.provider}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id?.slice(0, 8) ?? '—'}…</TableCell>
                        <TableCell className="text-sm">{row.retention_days}d</TableCell>
                        <TableCell>{revoked ? <Badge className="bg-red-100 text-red-800 text-xs">Revoked</Badge> : <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge>}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>Org: {row.org_id}</span>
                              <span>Voice profile: {row.voice_profile_id ?? '—'}</span>
                              <span>Created: {fmtDate(row.created_at)}</span>
                              <span>Revoked at: {fmtDate(row.revoked_at)}</span>
                            </div>
                            <div>
                              <p className="font-medium text-sm mb-1">Purpose</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.purpose}</p>
                            </div>
                            {row.revocation_reason && (
                              <div>
                                <p className="font-medium text-sm mb-1">Revocation Reason</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.revocation_reason}</p>
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
