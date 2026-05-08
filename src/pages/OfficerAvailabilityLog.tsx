import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarCheck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type OfficerAvailabilityRow = Database['public']['Tables']['officer_availability']['Row']

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtTime(t: string | null) {
  if (!t) return '—'
  return t
}

export default function OfficerAvailabilityLog() {
  const { user } = useAuthStore()
  const [availableFilter, setAvailableFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState('all')
  const [officerQuery, setOfficerQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<OfficerAvailabilityRow[]>({
    queryKey: ['officer-availability-log', availableFilter, dayFilter, officerQuery, dateFrom],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('officer_availability')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (availableFilter === 'available') q = q.eq('is_available', true)
      if (availableFilter === 'unavailable') q = q.eq('is_available', false)
      if (dayFilter !== 'all') q = q.eq('day_of_week', parseInt(dayFilter, 10))
      if (officerQuery.trim()) q = q.ilike('officer_id', `%${officerQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const availableCount = rows.filter((r) => r.is_available).length
  const unavailableCount = rows.filter((r) => !r.is_available).length
  const uniqueOfficers = new Set(rows.map((r) => r.officer_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarCheck className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Availability Log</h1>
              <p className="text-sm text-muted-foreground">Officer availability schedules with day-of-week and specific-date records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: rows.length, color: 'text-gray-700' },
            { label: 'Available', value: availableCount, color: 'text-green-700' },
            { label: 'Unavailable', value: unavailableCount, color: 'text-red-700' },
            { label: 'Unique Officers', value: uniqueOfficers, color: 'text-teal-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={availableFilter} onValueChange={setAvailableFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Availability" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="unavailable">Unavailable</SelectItem>
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
          <Input
            value={officerQuery}
            onChange={(e) => setOfficerQuery(e.target.value)}
            placeholder="Officer ID…"
            className="w-44"
          />
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
            <p>No officer availability records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Available</TableHead>
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
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[120px]">{row.officer_id ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {row.specific_date
                          ? row.specific_date
                          : row.day_of_week !== null
                            ? DAY_NAMES[row.day_of_week] ?? row.day_of_week
                            : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{fmtTime(row.available_from)}</TableCell>
                      <TableCell className="text-sm">{fmtTime(row.available_to)}</TableCell>
                      <TableCell>
                        {row.is_available ? (
                          <Badge className="bg-green-100 text-green-800 text-xs">Available</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 text-xs">Unavailable</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Specific Date:</span> {row.specific_date ?? '—'}</div>
                            <div><span className="font-medium">Updated At:</span> {fmtDate(row.updated_at)}</div>
                          </div>
                          {row.unavailability_reason && <div><span className="font-medium">Unavailability Reason:</span> {row.unavailability_reason}</div>}
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
