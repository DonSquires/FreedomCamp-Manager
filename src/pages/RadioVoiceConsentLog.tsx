/**
 * RadioVoiceConsentLog — B-117
 *
 * Log viewer for radio_voice_consents — officer consent records for voice
 * profile enrollment and TTS synthesis usage.
 *
 * Features:
 *  - KPI cards: Total Consents / Active / Revoked / Unique Officers
 *  - Filters: provider (dynamic), is revoked (active/revoked), date from
 *  - Table: officer_id (truncated), purpose, provider, retention_days,
 *           consented_at, revoked_at badge
 *  - Expandable row: full officer_id, voice_profile_id, revocation_reason,
 *                    created_at
 *
 * Note: radio_voice_consents is scoped by org_id (not organization_id).
 *
 * Route: /radio-voice-consent-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ShieldCheck, RefreshCw, AlertCircle, Loader2,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type RadioVoiceConsent = Database['public']['Views']['radio_voice_consents']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RadioVoiceConsentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [revokedFilter, setRevokedFilter] = useState('all')
  const [providerFilter,setProviderFilter] = useState('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<RadioVoiceConsent[]>({
    queryKey: ['radio-voice-consent-log', orgId, revokedFilter, providerFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = (supabase as any)
        .from('radio_voice_consents')
        .select('*')
        .eq('org_id', orgId!)
        .order('consented_at', { ascending: false })
        .limit(500)

      if (revokedFilter  === 'active')  q = q.is('revoked_at', null)
      if (revokedFilter  === 'revoked') q = q.not('revoked_at', 'is', null)
      if (providerFilter !== 'all')     q = q.eq('provider', providerFilter)
      if (dateFrom)                     q = q.gte('consented_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount  = rows.filter(r => !r.revoked_at).length
  const revokedCount = rows.filter(r => !!r.revoked_at).length
  const uniqueOff    = new Set(rows.map(r => r.officer_id)).size
  const providers    = [...new Set(rows.map(r => r.provider).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-green-700" />
            <div>
              <h1 className="text-2xl font-bold">Radio Voice Consent Log</h1>
              <p className="text-sm text-muted-foreground">Officer consent records for voice profile enrollment and TTS synthesis</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Consents',  value: rows.length,   colour: 'text-gray-700' },
            { label: 'Active',          value: activeCount,   colour: 'text-green-700' },
            { label: 'Revoked',         value: revokedCount,  colour: 'text-red-700' },
            { label: 'Unique Officers', value: uniqueOff,     colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={revokedFilter} onValueChange={setRevokedFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All consents</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="revoked">Revoked only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(p => <SelectItem key={p} value={p!}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No consent records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Officer</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Consented</TableHead>
                  <TableHead>Revoked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const isRevoked = !!row.revoked_at
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm">{row.purpose}</TableCell>
                        <TableCell className="text-sm">{row.provider}</TableCell>
                        <TableCell className="text-sm">{row.retention_days}d</TableCell>
                        <TableCell>
                          {isRevoked
                            ? <Badge className="bg-red-100 text-red-800">Revoked</Badge>
                            : <Badge className="bg-green-100 text-green-800">Active</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.consented_at)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.revoked_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Officer: {row.officer_id}</span>
                              {row.voice_profile_id && <span>Profile: {row.voice_profile_id.slice(0, 8)}…</span>}
                              {row.created_at       && <span>Created: {fmtDate(row.created_at)}</span>}
                            </div>
                            {row.revocation_reason && (
                              <div>
                                <p className="font-medium text-sm mb-1">Revocation Reason</p>
                                <p className="text-sm text-muted-foreground">{row.revocation_reason}</p>
                              </div>
                            )}
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
