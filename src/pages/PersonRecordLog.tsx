/**
 * PersonRecordLog — B-152
 *
 * Admin log and viewer for the person_records table.
 * Displays tracked persons with risk level, trespass notice status, interaction
 * count, FCA applicability, and last-contact timestamps.
 * Supports name search, risk/trespass/FCA filters, and an expandable detail row.
 *
 * Route: /person-records-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { UserSearch, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type PersonRow = Database['public']['Tables']['person_records']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const RISK_COLOURS: Record<string, string> = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low:    'bg-blue-100 text-blue-800',
}
function riskBadge(v: string | null) {
  return RISK_COLOURS[v?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-700'
}

export default function PersonRecordLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery,   setSearchQuery]   = useState('')
  const [riskFilter,    setRiskFilter]    = useState('all')
  const [trespassFilter, setTrespassFilter] = useState('all')
  const [fcaFilter,     setFcaFilter]     = useState('all')
  const [expanded,      setExpanded]      = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PersonRow[]>({
    queryKey: ['person-records-log', orgId, searchQuery, riskFilter, trespassFilter, fcaFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('person_records')
        .select('*')
        .eq('organization_id', orgId!)
        .order('last_contact_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (riskFilter !== 'all')  q = q.eq('risk_level', riskFilter)
      if (trespassFilter === 'yes') q = q.eq('trespass_notice_issued', true)
      if (trespassFilter === 'no')  q = q.eq('trespass_notice_issued', false)
      if (fcaFilter === 'yes')   q = q.eq('freedom_camping_act_applies', true)
      if (fcaFilter === 'no')    q = q.eq('freedom_camping_act_applies', false)
      if (searchQuery.trim())    q = q.or(`first_name.ilike.%${searchQuery.trim()}%,last_name.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const ofInterestCount = rows.filter(r => r.is_of_interest).length
  const trespassCount   = rows.filter(r => r.trespass_notice_issued).length
  const fcaCount        = rows.filter(r => r.freedom_camping_act_applies).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserSearch className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Person Record Log</h1>
              <p className="text-sm text-muted-foreground">Tracked persons with risk level, trespass and FCA status, and interaction history</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records',      value: rows.length,      colour: 'text-gray-700' },
            { label: 'Of Interest',        value: ofInterestCount,  colour: 'text-rose-700' },
            { label: 'Trespass Issued',    value: trespassCount,    colour: 'text-amber-700' },
            { label: 'FCA Applies',        value: fcaCount,         colour: 'text-indigo-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search first or last name…" className="w-52" />
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Risk level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              {['high','medium','low'].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={trespassFilter} onValueChange={setTrespassFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Trespass notice" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="yes">Trespass issued</SelectItem>
              <SelectItem value="no">No trespass notice</SelectItem>
            </SelectContent>
          </Select>
          <Select value={fcaFilter} onValueChange={setFcaFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="FCA applies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="yes">FCA applies</SelectItem>
              <SelectItem value="no">FCA does not apply</SelectItem>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Of Interest</TableHead>
                  <TableHead>Trespass</TableHead>
                  <TableHead>FCA</TableHead>
                  <TableHead>Interactions</TableHead>
                  <TableHead>Last Contact</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-medium text-sm">
                        {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                      </TableCell>
                      <TableCell><Badge className={riskBadge(row.risk_level)}>{row.risk_level ?? '—'}</Badge></TableCell>
                      <TableCell>
                        <Badge className={row.is_of_interest ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-700'}>
                          {row.is_of_interest ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={row.trespass_notice_issued ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}>
                          {row.trespass_notice_issued ? 'Issued' : 'None'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={row.freedom_camping_act_applies ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'}>
                          {row.freedom_camping_act_applies ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-center">{row.total_interactions ?? 0}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.last_contact_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Record ID:</span> {row.id}</div>
                          {row.date_of_birth    && <div><span className="font-medium">Date of birth:</span> {row.date_of_birth}</div>}
                          {row.vehicle_association && <div><span className="font-medium">Vehicle:</span> {row.vehicle_association}</div>}
                          {row.trespass_notice_date && <div><span className="font-medium">Trespass notice date:</span> {row.trespass_notice_date}</div>}
                          {row.tent_location_description && <div><span className="font-medium">Tent location:</span> {row.tent_location_description}</div>}
                          {row.notes            && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)} &nbsp; <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
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
