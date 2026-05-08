import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Users, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-green-100 text-green-800',
}

export default function PersonRecordLog() {
  const { user } = useAuthStore()
  const [riskFilter, setRiskFilter] = useState('all')
  const [interestFilter, setInterestFilter] = useState('all')
  const [trespassFilter, setTrespassFilter] = useState('all')
  const [nameQuery, setNameQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PersonRow[]>({
    queryKey: ['person-records-log', riskFilter, interestFilter, trespassFilter, nameQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('person_records')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (riskFilter !== 'all') q = q.eq('risk_level', riskFilter)
      if (interestFilter === 'yes') q = q.eq('is_of_interest', true)
      if (interestFilter === 'no') q = q.eq('is_of_interest', false)
      if (trespassFilter === 'yes') q = q.eq('trespass_notice_issued', true)
      if (trespassFilter === 'no') q = q.eq('trespass_notice_issued', false)
      if (nameQuery.trim()) q = q.or(`first_name.ilike.%${nameQuery.trim()}%,last_name.ilike.%${nameQuery.trim()}%`)
      if (dateFrom) q = q.gte('updated_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const ofInterestCount = rows.filter((r) => r.is_of_interest).length
  const trespassCount = rows.filter((r) => r.trespass_notice_issued).length
  const highRiskCount = rows.filter((r) => r.risk_level === 'high').length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Person Record Log</h1>
              <p className="text-sm text-muted-foreground">Individual records: risk level, trespass notices, and interactions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Of Interest', value: ofInterestCount, color: 'text-amber-700' },
            { label: 'Trespass Notice', value: trespassCount, color: 'text-orange-700' },
            { label: 'High Risk', value: highRiskCount, color: 'text-red-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search name…"
            className="w-44"
          />
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Risk level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={interestFilter} onValueChange={setInterestFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Of interest" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Of interest</SelectItem>
              <SelectItem value="no">Not of interest</SelectItem>
            </SelectContent>
          </Select>
          <Select value={trespassFilter} onValueChange={setTrespassFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Trespass" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Notice issued</SelectItem>
              <SelectItem value="no">No notice</SelectItem>
            </SelectContent>
          </Select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No person records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Updated</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Of Interest</TableHead>
                  <TableHead>Trespass</TableHead>
                  <TableHead>Interactions</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.updated_at)}</TableCell>
                      <TableCell className="text-sm font-medium">
                        {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className={RISK_COLOURS[row.risk_level ?? ''] ?? 'bg-slate-100 text-slate-700'}>
                          {row.risk_level ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.is_of_interest ? (
                          <Badge className="bg-amber-100 text-amber-800">Yes</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.trespass_notice_issued ? (
                          <Badge className="bg-orange-100 text-orange-800">Issued</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{row.total_interactions ?? 0}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">DOB:</span> {fmtDate(row.date_of_birth)}</div>
                            <div><span className="font-medium">Last contact:</span> {fmtDate(row.last_contact_at)}</div>
                            <div><span className="font-medium">FCA applies:</span> {row.freedom_camping_act_applies ? 'Yes' : 'No'}</div>
                            <div><span className="font-medium">Vehicle assoc.:</span> {row.vehicle_association ?? '—'}</div>
                            <div><span className="font-medium">Trespass date:</span> {fmtDate(row.trespass_notice_date)}</div>
                          </div>
                          {row.tent_location_description && (
                            <div><span className="font-medium">Tent location:</span> {row.tent_location_description}</div>
                          )}
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
