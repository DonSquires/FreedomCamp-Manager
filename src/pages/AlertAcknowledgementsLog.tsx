/**
 * AlertAcknowledgementsLog — B-133
 *
 * Admin log for alert_acknowledgements.
 *
 * Route: /alert-acknowledgements-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { BellRing, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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
import type { Database } from '@/types/database'

type AckRow = Database['public']['Tables']['alert_acknowledgements']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function AlertAcknowledgementsLog() {
  const [typeFilter, setTypeFilter] = useState('all')
  const [followUpFilter, setFollowUpFilter] = useState('all')
  const [userQuery, setUserQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<AckRow[]>({
    queryKey: ['alert-acknowledgements-log', typeFilter, followUpFilter, userQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('alert_acknowledgements')
        .select('*')
        .order('acknowledged_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (typeFilter !== 'all') q = q.eq('acknowledgement_type', typeFilter)
      if (followUpFilter === 'yes') q = q.eq('follow_up_required', true)
      if (followUpFilter === 'no') q = q.eq('follow_up_required', false)
      if (userQuery.trim()) q = q.ilike('user_id', `%${userQuery.trim()}%`)
      if (dateFrom) q = q.gte('acknowledged_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const uniqueTypes = [...new Set(rows.map(r => r.acknowledgement_type).filter(Boolean))].sort()
  const withFollowUp = rows.filter(r => r.follow_up_required).length
  const withEvidence = rows.filter(r => (r.evidence_photos?.length ?? 0) > 0).length
  const withReport = rows.filter(r => !!r.report_created_id).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BellRing className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Alert Acknowledgements Log</h1>
              <p className="text-sm text-muted-foreground">Alert acknowledgements, evidence, and follow-up requirements</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: rows.length, colour: 'text-gray-700' },
            { label: 'Follow-up Required', value: withFollowUp, colour: 'text-amber-700' },
            { label: 'With Evidence', value: withEvidence, colour: 'text-cyan-700' },
            { label: 'Created Reports', value: withReport, colour: 'text-green-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="Search user ID…" className="w-56" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {uniqueTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={followUpFilter} onValueChange={setFollowUpFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Follow-up" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All follow-up</SelectItem>
              <SelectItem value="yes">Follow-up required</SelectItem>
              <SelectItem value="no">No follow-up</SelectItem>
            </SelectContent>
          </Select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
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
                  <TableHead>Acknowledged</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{fmtDate(row.acknowledged_at)}</TableCell>
                    <TableCell className="text-sm">{row.acknowledgement_type}</TableCell>
                    <TableCell className="font-mono text-xs">{row.user_id}</TableCell>
                    <TableCell>
                      <Badge className={row.follow_up_required ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}>
                        {row.follow_up_required ? 'required' : 'none'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{row.evidence_photos?.length ?? 0}</TableCell>
                    <TableCell className="text-sm">{row.action_taken ?? '—'}</TableCell>
                    <TableCell className="max-w-[24rem] truncate text-sm" title={row.notes ?? ''}>{row.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
