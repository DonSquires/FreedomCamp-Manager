import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPin, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

type LoiRow = Database['public']['Tables']['locations_of_interest']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function pct(v: number | null) {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

export default function LocationsOfInterestLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [kindFilter, setKindFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [canonicalFilter, setCanonicalFilter] = useState('all')
  const [cityFilter, setCityFilter] = useState('all')
  const [nameQuery, setNameQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<LoiRow[]>({
    queryKey: ['locations-of-interest-log', orgId, kindFilter, activeFilter, canonicalFilter, cityFilter, nameQuery],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('locations_of_interest')
        .select('*')
        .eq('organization_id', orgId!)
        .order('updated_at', { ascending: false })
        .limit(500)

      if (kindFilter !== 'all') q = q.eq('loi_kind', kindFilter)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (canonicalFilter === 'yes') q = q.eq('is_canonical', true)
      if (canonicalFilter === 'no') q = q.eq('is_canonical', false)
      if (cityFilter !== 'all') q = q.eq('city', cityFilter)
      if (nameQuery.trim()) q = q.ilike('name', `%${nameQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const kinds = [...new Set(rows.map(r => r.loi_kind).filter(Boolean))].sort()
  const cities = [...new Set(rows.map(r => r.city).filter(Boolean))].sort()
  const activeCount = rows.filter(r => r.is_active).length
  const canonicalCount = rows.filter(r => r.is_canonical).length
  const hazardCount = rows.filter(r => !!r.hazard_summary).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Locations of Interest Log</h1>
              <p className="text-sm text-muted-foreground">Registered locations, geocoding details, and hazard context</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total LOIs', value: rows.length, colour: 'text-gray-700' },
            { label: 'Active', value: activeCount, colour: 'text-emerald-700' },
            { label: 'Canonical', value: canonicalCount, colour: 'text-blue-700' },
            { label: 'With Hazards', value: hazardCount, colour: 'text-orange-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="Search name…"
            className="w-52"
          />
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="LOI kind" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {kinds.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Active" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={canonicalFilter} onValueChange={setCanonicalFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Canonical" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="yes">Canonical only</SelectItem>
              <SelectItem value="no">Non-canonical only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No locations of interest found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Canonical</TableHead>
                  <TableHead>Geo Confidence</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm font-medium">{row.name ?? '—'}</TableCell>
                        <TableCell><Badge className="bg-blue-100 text-blue-800">{row.loi_kind}</Badge></TableCell>
                        <TableCell className="text-sm">{row.city ?? '—'}</TableCell>
                        <TableCell>{row.is_active ? <Badge className="bg-green-100 text-green-800">Active</Badge> : <Badge className="bg-gray-100 text-gray-700">Inactive</Badge>}</TableCell>
                        <TableCell>{row.is_canonical ? <Badge className="bg-violet-100 text-violet-800">Canonical</Badge> : <span className="text-muted-foreground text-xs">No</span>}</TableCell>
                        <TableCell className="text-sm font-mono">{pct(row.geocoder_confidence)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.updated_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div><span className="font-medium">Address:</span> <span className="text-muted-foreground">{row.display_address ?? row.address_full ?? '—'}</span></div>
                              <div><span className="font-medium">GPS:</span> <span className="text-muted-foreground">{row.gps_lat != null && row.gps_lng != null ? `${row.gps_lat}, ${row.gps_lng}` : '—'}</span></div>
                              <div><span className="font-medium">Hazard:</span> <span className="text-muted-foreground">{row.hazard_summary ?? '—'}</span></div>
                              <div><span className="font-medium">Access:</span> <span className="text-muted-foreground">{row.access_summary ?? '—'}</span></div>
                              <div><span className="font-medium">Canonical LOI:</span> <span className="font-mono text-xs">{row.canonical_loi_id ?? '—'}</span></div>
                              <div><span className="font-medium">Geo Source:</span> <span className="text-muted-foreground">{row.geocoder_source ?? '—'}</span></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
