import { Fragment, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Loader2, AlertCircle, RefreshCw, MapPin, ChevronDown, ChevronRight } from 'lucide-react'
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

type LocationOfInterest = Database['public']['Tables']['locations_of_interest']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function LocationsOfInterestLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [kindFilter, setKindFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [canonicalFilter, setCanonicalFilter] = useState('all')
  const [cityFilter, setCityFilter] = useState('all')
  const [nameSearch, setNameSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<LocationOfInterest[]>({
    queryKey: ['locations-of-interest-log', orgId, kindFilter, activeFilter, canonicalFilter, cityFilter, nameSearch],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('locations_of_interest')
        .select('*')
        .eq('organization_id', orgId!)
        .order('updated_at', { ascending: false })
        .limit(600)

      if (kindFilter !== 'all') q = q.eq('loi_kind', kindFilter)
      if (cityFilter !== 'all') q = q.eq('city', cityFilter)
      if (activeFilter === 'yes') q = q.eq('is_active', true)
      if (activeFilter === 'no') q = q.eq('is_active', false)
      if (canonicalFilter === 'yes') q = q.eq('is_canonical', true)
      if (canonicalFilter === 'no') q = q.eq('is_canonical', false)
      if (nameSearch.trim()) q = q.ilike('name', `%${nameSearch.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const kinds = useMemo(() => [...new Set(rows.map((r) => r.loi_kind).filter(Boolean))].sort(), [rows])
  const cities = useMemo(() => [...new Set(rows.map((r) => r.city).filter(Boolean))].sort(), [rows])
  const activeCount = rows.filter((r) => r.is_active).length
  const canonicalCount = rows.filter((r) => r.is_canonical).length
  const withHazardCount = rows.filter((r) => !!r.hazard_summary).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">Locations of Interest Log</h1>
              <p className="text-sm text-muted-foreground">Tracked operational locations and hazard context</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Locations', value: rows.length, color: 'text-slate-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Canonical', value: canonicalCount, color: 'text-indigo-700' },
            { label: 'With Hazards', value: withHazardCount, color: 'text-orange-700' },
          ].map((k) => (
            <Card key={k.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${k.color}`}>{k.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Kind" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {kinds.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Active" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Active only</SelectItem>
              <SelectItem value="no">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={canonicalFilter} onValueChange={setCanonicalFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Canonical" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Canonical only</SelectItem>
              <SelectItem value="no">Non-canonical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search name…"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            className="w-56"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No locations found</p></div>
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
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{row.name ?? '—'}</TableCell>
                        <TableCell className="text-sm">{row.loi_kind}</TableCell>
                        <TableCell className="text-sm">{row.city ?? '—'}</TableCell>
                        <TableCell>{row.is_active ? <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge> : <Badge className="bg-slate-100 text-slate-800 text-xs">Inactive</Badge>}</TableCell>
                        <TableCell>{row.is_canonical ? <Badge className="bg-indigo-100 text-indigo-800 text-xs">Canonical</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.updated_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>ID: {row.id}</span>
                              <span>Address: {row.display_address ?? row.address_full ?? '—'}</span>
                              <span>GPS: {row.gps_lat ?? '—'}, {row.gps_lng ?? '—'}</span>
                              <span>Created: {fmtDate(row.created_at)}</span>
                              <span>Geocoder: {row.geocoder_source ?? '—'} ({row.geocoder_confidence ?? '—'})</span>
                            </div>
                            {row.hazard_summary && (
                              <div>
                                <p className="font-medium text-sm mb-1">Hazard Summary</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.hazard_summary}</p>
                              </div>
                            )}
                            {row.description && (
                              <div>
                                <p className="font-medium text-sm mb-1">Description</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.description}</p>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
