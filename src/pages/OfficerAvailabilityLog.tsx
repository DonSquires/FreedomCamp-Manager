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

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'HH:mm') } catch { return ts }
}

export default function OfficerAvailabilityLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [availableFilter, setAvailableFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<OfficerAvailabilityRow[]>({
    queryKey: ['officer-availability-log', orgId, searchQuery, availableFilter, dayFilter, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('officer_availability')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (availableFilter === 'available') q = q.eq('is_available', true)
      if (availableFilter === 'unavailable') q = q.eq('is_available', false)
      if (dayFilter !== 'all') q = q.eq('day_of_week', parseInt(dayFilter, 10))
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`officer_id.ilike.%${term}%,notes.ilike.%${term}%,unavailability_reason.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const availableCount = rows.filter(r => r.is_available).length
  const unavailableCount = rows.filter(r => !r.is_available).length
  const uniqueOfficers = new Set(rows.map(r => r.officer_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarCheck className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Availability Log</h1>
              <p className="text-sm text-muted-foreground">Officer availability schedules with day-of-week and specific-date overrides</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Total Entries', value: rows.length, colour: 'text-gray-700' },
            { label: 'Available', value: availableCount, colour: 'text-green-700' },
            { label: 'Unavailable', value: unavailableCount, colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Unique officers: {uniqueOfficers}</p>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search officer id, notes…" className="w-56" />
          <Select value={availableFilter} onValueChange={setAvailableFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Availability" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="unavailable">Unavailable</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dayFilter} onValueChange={setDayFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Day of week" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All days</SelectItem>
              {DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Available</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Specific Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="font-mono text-xs">{row.officer_id}</TableCell>
                      <TableCell><Badge className={row.is_available ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>{row.is_available ? 'yes' : 'no'}</Badge></TableCell>
                      <TableCell className="text-sm">{row.day_of_week != null ? DAY_NAMES[row.day_of_week] ?? row.day_of_week : '—'}</TableCell>
                      <TableCell className="text-sm">{row.specific_date ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtTime(row.available_from)}</TableCell>
                      <TableCell className="text-sm">{fmtTime(row.available_to)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          {row.unavailability_reason && <div><span className="font-medium">Unavailability reason:</span> {row.unavailability_reason}</div>}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
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
