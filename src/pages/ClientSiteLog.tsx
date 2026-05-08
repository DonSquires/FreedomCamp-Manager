import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { MapPin, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type SiteRow = Database['public']['Tables']['client_sites']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function ClientSiteLog() {
  const { user } = useAuthStore()
  const [activeFilter, setActiveFilter] = useState('all')
  const [siteTypeFilter, setSiteTypeFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<SiteRow[]>({
    queryKey: ['client-sites-log', activeFilter, siteTypeFilter, searchQuery],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('client_sites')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (siteTypeFilter !== 'all') q = q.eq('site_type', siteTypeFilter)
      if (searchQuery.trim()) q = q.or(`name.ilike.%${searchQuery.trim()}%,site_code.ilike.%${searchQuery.trim()}%,city.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((r) => r.is_active).length
  const inactiveCount = rows.length - activeCount
  const withGeofenceCount = rows.filter((r) => (r.geofence_radius_metres ?? 0) > 0).length
  const siteTypes = ['all', ...Array.from(new Set(rows.map((r) => r.site_type).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Client Site Log</h1>
              <p className="text-sm text-muted-foreground">Site records, contact metadata, and geofence settings</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Sites', value: rows.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Inactive', value: inactiveCount, color: 'text-slate-700' },
            { label: 'With Geofence', value: withGeofenceCount, color: 'text-cyan-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search site, code, city…"
            className="w-56"
          />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={siteTypeFilter} onValueChange={setSiteTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Site type" /></SelectTrigger>
            <SelectContent>
              {siteTypes.map((type) => (
                <SelectItem key={type} value={type}>{type === 'all' ? 'All site types' : type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No client sites found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Updated</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
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
                      <TableCell className="text-sm font-medium">{row.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.site_code ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.city ?? '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.site_type}</Badge></TableCell>
                      <TableCell>
                        <Badge className={row.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Site ID:</span> {row.id}</div>
                            <div><span className="font-medium">Organization:</span> {row.organization_id}</div>
                            <div><span className="font-medium">Zone:</span> {row.zone_id ?? '—'}</div>
                            <div><span className="font-medium">Radius (m):</span> {row.geofence_radius_metres}</div>
                            <div><span className="font-medium">Contact:</span> {row.contact_name ?? '—'}</div>
                            <div><span className="font-medium">Phone:</span> {row.contact_phone ?? '—'}</div>
                          </div>
                          {row.address && <div><span className="font-medium">Address:</span> {row.address}</div>}
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
