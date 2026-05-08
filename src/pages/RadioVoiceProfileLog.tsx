/**
 * RadioVoiceProfileLog — B-146
 *
 * Admin log and viewer for radio_voice_profiles.
 * Displays enrolled voice profiles, provider/model coverage,
 * active vs revoked state, and officer-level audit detail.
 *
 * Route: /radio-voice-profile-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Mic, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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
interface VoiceProfileRow {
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
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<VoiceProfileRow[]>({
    queryKey: ['radio-voice-profile-log', orgId, searchQuery, providerFilter, statusFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('radio_voice_profiles')
        .select('*')
        .eq('org_id', orgId!)
        .order('enrolled_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (searchQuery.trim()) q = q.or(`officer_id.ilike.%${searchQuery.trim()}%,model_ref.ilike.%${searchQuery.trim()}%`)
      if (providerFilter !== 'all') q = q.eq('provider', providerFilter)
      if (statusFilter === 'active') q = q.eq('is_active', true).is('revoked_at', null)
      if (statusFilter === 'revoked') q = q.not('revoked_at', 'is', null)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const providers = [...new Set(rows.map(row => row.provider).filter(Boolean))].sort()
  const activeCount = rows.filter(row => row.is_active && !row.revoked_at).length
  const revokedCount = rows.filter(row => !!row.revoked_at).length
  const uniqueOfficers = new Set(rows.map(row => row.officer_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mic className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Voice Profile Log</h1>
              <p className="text-sm text-muted-foreground">Enrolled officer voice profiles with provider, model, and revocation audit detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Profiles', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-emerald-700' },
            { label: 'Revoked', value: revokedCount, colour: 'text-rose-700' },
            { label: 'Unique Officers', value: uniqueOfficers, colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search officer or model…" className="w-60" />
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(provider => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
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
                  <TableHead>Officer</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Revoked</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono text-xs">{row.officer_id.slice(0, 8)}…</TableCell>
                      <TableCell className="text-sm">{row.provider}</TableCell>
                      <TableCell className="text-sm max-w-[14rem] truncate">{row.model_ref}</TableCell>
                      <TableCell>
                        <Badge className={row.revoked_at ? 'bg-rose-100 text-rose-800' : row.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                          {row.revoked_at ? 'Revoked' : row.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.enrolled_at)}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.revoked_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Profile ID:</span> {row.id}</div>
                          <div><span className="font-medium">Officer ID:</span> {row.officer_id}</div>
                          <div><span className="font-medium">Organization:</span> {row.org_id}</div>
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
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
