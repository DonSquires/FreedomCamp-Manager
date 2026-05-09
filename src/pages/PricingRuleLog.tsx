/**
 * PricingRuleLog — B-172
 *
 * Admin viewer for pricing_rules.
 * Displays pricing rule configurations including day-of-week schedules,
 * hourly windows, multipliers, and flat NZD overrides per organisation.
 *
 * Route: /pricing-rules-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { DollarSign, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type PricingRuleRow = Database['public']['Tables']['pricing_rules']['Row']

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function boolBadge(val: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  if (val == null) return <span className="text-muted-foreground">—</span>
  return (
    <Badge className={val ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'}>
      {val ? trueLabel : falseLabel}
    </Badge>
  )
}

export default function PricingRuleLog() {
  const { user } = useAuthStore()
  const [labelQuery, setLabelQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<PricingRuleRow[]>({
    queryKey: ['pricing-rule-log', user?.organization_id, labelQuery, activeFilter, dayFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('pricing_rules')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (labelQuery.trim()) q = q.ilike('label', `%${labelQuery.trim()}%`)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (dayFilter !== 'all') q = q.eq('day_of_week', parseInt(dayFilter))
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter(r => r.is_active).length
  const withZone = rows.filter(r => r.zone_id).length
  const withFlatOverride = rows.filter(r => r.flat_override_nzd != null).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DollarSign className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Pricing Rules</h1>
              <p className="text-sm text-muted-foreground">Day-of-week schedules, hourly windows, multipliers, and flat NZD override configurations</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Rules', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-emerald-700' },
            { label: 'With Zone', value: withZone, colour: 'text-sky-700' },
            { label: 'With Flat Override', value: withFlatOverride, colour: 'text-amber-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={labelQuery} onChange={e => setLabelQuery(e.target.value)} placeholder="Search label…" className="w-52" />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dayFilter} onValueChange={setDayFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Day of week" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All days</SelectItem>
              {DAY_NAMES.map((d, i) => (
                <SelectItem key={i} value={String(i)}>{d}</SelectItem>
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
                  <TableHead>Label</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Multiplier</TableHead>
                  <TableHead>Flat Override (NZD)</TableHead>
                  <TableHead>Active</TableHead>
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
                      <TableCell className="font-medium text-sm">{row.label}</TableCell>
                      <TableCell className="text-sm">{row.day_of_week != null ? DAY_NAMES[row.day_of_week] ?? row.day_of_week : '—'}</TableCell>
                      <TableCell className="text-sm">
                        {row.hour_from != null && row.hour_to != null
                          ? `${String(row.hour_from).padStart(2, '0')}:00 – ${String(row.hour_to).padStart(2, '0')}:00`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-right">{row.multiplier ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">
                        {row.flat_override_nzd != null ? `$${row.flat_override_nzd.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>{boolBadge(row.is_active, 'Active', 'Inactive')}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id} &nbsp; <span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                          <div><span className="font-medium">Zone ID:</span> {row.zone_id ?? '—'}</div>
                          <div>
                            <span className="font-medium">Hour from:</span> {row.hour_from ?? '—'} &nbsp;
                            <span className="font-medium">Hour to:</span> {row.hour_to ?? '—'}
                          </div>
                          <div>
                            <span className="font-medium">Multiplier:</span> {row.multiplier ?? '—'} &nbsp;
                            <span className="font-medium">Flat override:</span> {row.flat_override_nzd != null ? `$${row.flat_override_nzd.toFixed(2)}` : '—'}
                          </div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
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
            {activeCount} active &nbsp;·&nbsp; {rows.length} total pricing rules
          </p>
        )}
      </div>
    </AppLayout>
  )
}
