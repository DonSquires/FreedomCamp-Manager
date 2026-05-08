/**
 * RadioVoiceProfileLog — B-146
 *
 * Admin log for radio_voice_profiles.
 * Tracks profile provider/model enrollment and revocation state.
 *
 * Route: /radio-voice-profiles-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Mic, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
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

type VoiceProfileRow = {
  id: string
  org_id: string
  officer_id: string
  provider: string
  model_ref: string
  enrolled_at: string
  revoked_at: string | null
  is_active: boolean
  created_at: string
}

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function RadioVoiceProfileLog() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [officerQuery, setOfficerQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<VoiceProfileRow[]>({
    queryKey: ['radio-voice-profiles-log', activeFilter, providerFilter, officerQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('radio_voice_profiles')
        .select('*')
        .order('enrolled_at', { ascending: false })
        .limit(500)

      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'revoked') q = q.eq('is_active', false)
      if (providerFilter !== 'all') q = q.eq('provider', providerFilter)
      if (officerQuery.trim()) q = q.ilike('officer_id', `%${officerQuery.trim()}%`)
      if (dateFrom) q = q.gte('enrolled_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(r => r.is_active).length
  const revokedCount = rows.filter(r => !!r.revoked_at || !r.is_active).length
  const providerCount = new Set(rows.map(r => r.provider).filter(Boolean)).size
  const orgCount = new Set(rows.map(r => r.org_id).filter(Boolean)).size
  const providers = ['all', ...Array.from(new Set(rows.map(r => r.provider).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mic className="h-6 w-6 text-fuchsia-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Voice Profile Log</h1>
              <p className="text-sm text-muted-foreground">Voice model enrollment/revocation records for radio operators</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Profiles', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-green-700' },
            { label: 'Revoked', value: revokedCount, colour: 'text-rose-700' },
            { label: 'Providers', value: providerCount, colour: 'text-fuchsia-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={officerQuery}
            onChange={(e) => setOfficerQuery(e.target.value)}
            placeholder="Search officer ID…"
            className="w-52"
          />
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p} value={p}>{p === 'all' ? 'All providers' : p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="revoked">Revoked only</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No voice profiles found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model Ref</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Org</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Revoked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.enrolled_at)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{row.provider}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{row.model_ref}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.org_id}</TableCell>
                    <TableCell>
                      <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-rose-100 text-rose-800'}>
                        {row.is_active ? 'Active' : 'Revoked'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(row.revoked_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            Showing {rows.length} profile{rows.length !== 1 ? 's' : ''} across {orgCount} organisation{orgCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </AppLayout>
  )
}
