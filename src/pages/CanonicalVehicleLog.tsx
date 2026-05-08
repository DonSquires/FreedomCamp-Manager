import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Car, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type CanonicalVehicleRow = Database['public']['Tables']['canonical_vehicles']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function boolBadge(v: boolean | null, yes = 'yes', no = 'no') {
  if (v === true) return <Badge className="bg-green-100 text-green-800">{yes}</Badge>
  if (v === false) return <Badge className="bg-gray-100 text-gray-700">{no}</Badge>
  return <Badge className="bg-gray-100 text-gray-700">—</Badge>
}

export default function CanonicalVehicleLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [searchQuery, setSearchQuery] = useState('')
  const [flaggedFilter, setFlaggedFilter] = useState('all')
  const [homelessFilter, setHomelessFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalVehicleRow[]>({
    queryKey: ['canonical-vehicles-log', user?.role, orgId, searchQuery, flaggedFilter, homelessFilter, dateFrom],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (user?.role !== 'master') {
        const { data: matchingObservations, error: matchingObsError } = await supabase
          .from('observations')
          .select('plate_number')
          .eq('organization_id', orgId ?? '')
        if (matchingObsError) throw matchingObsError
        const matchingPlates = [...new Set((matchingObservations ?? []).map((o) => o.plate_number).filter(Boolean))]
        if (matchingPlates.length === 0) return []
        q = q.in('plate_number', matchingPlates as string[])
      }

      if (searchQuery.trim()) {
        const term = searchQuery.trim()
        q = q.or(`plate_number.ilike.%${term}%,vehicle_make.ilike.%${term}%,vehicle_model.ilike.%${term}%,owner_first_name.ilike.%${term}%,owner_last_name.ilike.%${term}%`)
      }
      if (flaggedFilter === 'flagged') q = q.eq('is_flagged', true)
      if (flaggedFilter === 'not_flagged') q = q.eq('is_flagged', false)
      if (homelessFilter === 'yes') q = q.eq('is_homeless', true)
      if (homelessFilter === 'no') q = q.eq('is_homeless', false)
      if (dateFrom) q = q.gte('last_seen_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const flaggedCount = rows.filter(r => r.is_flagged).length
  const homelessCount = rows.filter(r => r.is_homeless).length
  const breachCount = rows.filter(r => (r.total_breaches ?? 0) > 0).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="h-6 w-6 text-sky-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical Vehicle Log</h1>
              <p className="text-sm text-muted-foreground">Canonical vehicle records with compliance, enforcement, and owner metadata</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Vehicles', value: rows.length, colour: 'text-gray-700' },
            { label: 'Flagged', value: flaggedCount, colour: 'text-amber-700' },
            { label: 'Homeless', value: homelessCount, colour: 'text-violet-700' },
            { label: 'With Breaches', value: breachCount, colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plate, make/model, owner…" className="w-64" />
          <Select value={flaggedFilter} onValueChange={setFlaggedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Flagged" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="not_flagged">Not Flagged</SelectItem>
            </SelectContent>
          </Select>
          <Select value={homelessFilter} onValueChange={setHomelessFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Homeless" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
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
                  <TableHead>Plate</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Flagged</TableHead>
                  <TableHead>Homeless</TableHead>
                  <TableHead>Breaches</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.vehicle_id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.vehicle_id ? null : row.vehicle_id)}>
                      <TableCell className="font-mono text-xs">{row.plate_number}</TableCell>
                      <TableCell className="text-sm">{[row.vehicle_year, row.vehicle_make, row.vehicle_model, row.vehicle_color].filter(Boolean).join(' ') || '—'}</TableCell>
                      <TableCell>{boolBadge(row.is_flagged, 'flagged', 'no')}</TableCell>
                      <TableCell>{boolBadge(row.is_homeless, 'yes', 'no')}</TableCell>
                      <TableCell className="text-sm">{row.total_breaches ?? 0}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.last_seen_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.vehicle_id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.vehicle_id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">Vehicle ID:</span> {row.vehicle_id}</div>
                          <div><span className="font-medium">Owner:</span> {[row.owner_first_name, row.owner_last_name].filter(Boolean).join(' ') || '—'} &nbsp; <span className="font-medium">Company:</span> {row.owner_company_name ?? '—'}</div>
                          <div><span className="font-medium">Address:</span> {row.owner_address ?? '—'} &nbsp; <span className="font-medium">Verified:</span> {row.owner_address_verified == null ? '—' : row.owner_address_verified ? 'yes' : 'no'}</div>
                          <div><span className="font-medium">Self-contained:</span> {row.self_contained == null ? '—' : row.self_contained ? 'yes' : 'no'} &nbsp; <span className="font-medium">Expiry:</span> {row.self_contained_expiry ?? '—'}</div>
                          <div><span className="font-medium">Exempt:</span> {row.is_exempt ? 'yes' : 'no'} &nbsp; <span className="font-medium">FC Act exempt:</span> {row.fc_act_exempt == null ? '—' : row.fc_act_exempt ? 'yes' : 'no'}</div>
                          <div><span className="font-medium">Flag reason:</span> {row.flagged_reason ?? '—'} &nbsp; <span className="font-medium">Priority:</span> {row.flagged_priority ?? '—'}</div>
                          <div><span className="font-medium">Homeless status:</span> {row.homeless_status ?? '—'} &nbsp; <span className="font-medium">Notes:</span> {row.homeless_notes ?? '—'}</div>
                          <div><span className="font-medium">Observations:</span> {row.total_observations ?? 0} &nbsp; <span className="font-medium">Incidents:</span> {row.total_incidents ?? 0} &nbsp; <span className="font-medium">Enforcement:</span> {row.enforcement_count ?? 0}</div>
                          <div><span className="font-medium">First seen:</span> {fmtDate(row.first_seen_at)} &nbsp; <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
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
