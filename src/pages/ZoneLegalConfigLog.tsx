/**
 * ZoneLegalConfigLog — B-173
 *
 * Admin viewer for zone_legal_config.
 * Displays legal configuration per zone including enforcement type, land act,
 * fine amounts, stay limits, breach templates, and authority contact details.
 *
 * Route: /zone-legal-config-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Scale, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
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

type ZoneLegalConfigRow = Database['public']['Tables']['zone_legal_config']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function ZoneLegalConfigLog() {
  const [enforcementTypeFilter, setEnforcementTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneLegalConfigRow[]>({
    queryKey: ['zone-legal-config-log', enforcementTypeFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('zone_legal_config')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (enforcementTypeFilter !== 'all') q = q.eq('enforcement_type', enforcementTypeFilter)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const { data: enforcementTypes = [] } = useQuery<string[]>({
    queryKey: ['zone-legal-config-enforcement-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zone_legal_config')
        .select('enforcement_type')
      if (error) throw error
      const unique = Array.from(new Set((data ?? []).map(r => r.enforcement_type).filter(Boolean)))
      return unique
    },
  })

  const withFine = rows.filter(r => r.fine_amount != null).length
  const withMaxStay = rows.filter(r => r.max_stay_nights != null).length
  const withAuthority = rows.filter(r => r.enforcement_authority).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Legal Config</h1>
              <p className="text-sm text-muted-foreground">Legal configuration per zone: enforcement type, land act, fine amounts, stay limits, and authority contacts</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Configs', value: rows.length, colour: 'text-gray-700' },
            { label: 'With Fine', value: withFine, colour: 'text-red-700' },
            { label: 'With Max Stay', value: withMaxStay, colour: 'text-amber-700' },
            { label: 'With Authority', value: withAuthority, colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={enforcementTypeFilter} onValueChange={setEnforcementTypeFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Enforcement type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {enforcementTypes.map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-44" />
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
                  <TableHead>Enforcement Type</TableHead>
                  <TableHead>Land Act</TableHead>
                  <TableHead>Authority</TableHead>
                  <TableHead>Fine (NZD)</TableHead>
                  <TableHead>Max Stay</TableHead>
                  <TableHead>Max Consecutive</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm font-medium">{row.enforcement_type}</TableCell>
                      <TableCell className="text-sm">{row.land_act}</TableCell>
                      <TableCell className="text-sm">{row.enforcement_authority ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">
                        {row.fine_amount != null ? `$${row.fine_amount.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-right">{row.max_stay_nights ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">{row.max_consecutive_nights ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id} &nbsp; <span className="font-medium">Zone ID:</span> {row.zone_id}</div>
                          {row.legal_description && <div><span className="font-medium">Legal description:</span> {row.legal_description}</div>}
                          <div><span className="font-medium">Land owner:</span> {row.land_owner}</div>
                          {row.breach_template && <div><span className="font-medium">Breach template:</span> {row.breach_template}</div>}
                          {row.dispute_portal_url && <div><span className="font-medium">Dispute portal:</span> <a href={row.dispute_portal_url} className="text-sky-600 underline" target="_blank" rel="noopener noreferrer">{row.dispute_portal_url}</a></div>}
                          {row.objections_email && <div><span className="font-medium">Objections email:</span> {row.objections_email}</div>}
                          {row.managing_authority && <div><span className="font-medium">Managing authority:</span> {row.managing_authority}</div>}
                          <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {withFine} configs with fine &nbsp;·&nbsp; {rows.length} total zone legal configs
          </p>
        )}
      </div>
    </AppLayout>
  )
}
