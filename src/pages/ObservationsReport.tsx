import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  FileText,
  Search,
  Download,
  CheckCircle,
  AlertTriangle,
  Car,
  MapPin,
  Calendar,
  BarChart3,
  Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface ObservationRow {
  id: string
  plate_number: string | null
  recorded_at: string
  is_compliant: boolean | null
  nights_stayed_this_month: number | null
  processing_status: string | null
  gps_latitude: number | null
  gps_longitude: number | null
  photo_url: string | null
  zone: { name: string } | null
  recorded_by_user: { first_name: string; last_name: string } | null
}

export default function ObservationsReport() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  const [search, setSearch] = useState('')
  const [complianceFilter, setComplianceFilter] = useState('all')
  const [exporting, setExporting] = useState(false)

  const orgId = user?.role === 'master' ? (organizationId || undefined) : user?.organization_id

  const { data: observations = [], isLoading } = useQuery({
    queryKey: ['observations-report', orgId, zoneId, dateFrom, dateTo, complianceFilter],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(`
          id, plate_number, recorded_at, is_compliant, nights_stayed_this_month,
          processing_status, gps_latitude, gps_longitude, photo_url,
          zone:zones!zone_id(name),
          recorded_by_user:user_profiles!recorded_by(first_name, last_name)
        `)
        
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (orgId) q = q.eq('organization_id', orgId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate) q = q.lte('recorded_at', endDate)

      if (complianceFilter === 'compliant') q = q.eq('is_compliant', true)
      else if (complianceFilter === 'breach') q = q.eq('is_compliant', false)
      else if (complianceFilter === 'pending') q = q.is('is_compliant', null)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as ObservationRow[]
    },
    enabled: !!user,
  })

  const handleExport = async () => {
    setExporting(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      const { data, error } = await supabase.functions.invoke('observations-export', {
        body: {
          organization_id: orgId,
          zone_id: zoneId || undefined,
          date_from: dateFrom || defaultFrom,
          date_to: dateTo || today,
          search: search || undefined,
        },
      })
      if (error) throw new Error(error.message)

      // Download the CSV - handle both string and {csv: string} response shapes
      const csvContent = typeof data === 'string' ? data : (data?.csv || data?.data || '')
      if (!csvContent) throw new Error('No CSV data in response')
      const blob = new Blob([csvContent], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `observations_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Export downloaded')
    } catch (err: any) {
      toast.error(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const filtered = observations.filter(o => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      o.plate_number?.toLowerCase().includes(q) ||
      o.zone?.name?.toLowerCase().includes(q)
    )
  })

  // Summary stats — computed on the server, not from the already-filtered list.
  const { data: stats } = useQuery({
    queryKey: ['obs-report-stats', orgId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const start = startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const end   = endDate   ?? new Date().toISOString()
      const { data, error } = await (supabase.rpc as any)('get_compliance_stats', {
        p_start:            start,
        p_end:              end,
        p_organization_id:  orgId  ?? null,
        p_zone_id:          zoneId ?? null,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return {
        total:     (row?.total_observations  ?? 0) as number,
        compliant: (row?.compliant_count     ?? 0) as number,
        breach:    (row?.breach_count        ?? 0) as number,
        rate:      (row?.compliance_rate     ?? null) as number | null,
      }
    },
  })

  return (
    <AppLayout title="Observations Report" description="View, filter and export observation records">
      <GlobalFilterRibbon showZoneFilter showDateFilter />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: stats.total, icon: <FileText className="h-5 w-5 text-blue-500" /> },
          { label: 'Compliant', value: stats.compliant, icon: <CheckCircle className="h-5 w-5 text-green-500" /> },
          { label: 'Breach', value: stats.breach, icon: <AlertTriangle className="h-5 w-5 text-red-500" /> },
          { label: 'Compliance Rate', value: stats.rate !== null ? `${stats.rate}%` : '—', icon: <BarChart3 className="h-5 w-5 text-blue-500" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search plate or zone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={complianceFilter} onValueChange={setComplianceFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Compliance" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All results</SelectItem>
            <SelectItem value="compliant">Compliant only</SelectItem>
            <SelectItem value="breach">Breaches only</SelectItem>
            <SelectItem value="pending">Pending only</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          <Download className="h-4 w-4 mr-2" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">No observations match your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Plate</th>
                <th className="text-left px-3 py-2 font-medium">Zone</th>
                <th className="text-left px-3 py-2 font-medium">Recorded At</th>
                <th className="text-left px-3 py-2 font-medium">Result</th>
                <th className="text-left px-3 py-2 font-medium">Night</th>
                <th className="text-left px-3 py-2 font-medium">Officer</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(obs => (
                <tr key={obs.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-mono font-semibold">
                    {obs.plate_number || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {obs.zone?.name || '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDateTime(obs.recorded_at)}
                  </td>
                  <td className="px-3 py-2">
                    {obs.is_compliant === true && <Badge className="bg-green-600 text-xs">Compliant</Badge>}
                    {obs.is_compliant === false && <Badge variant="destructive" className="text-xs">Breach</Badge>}
                    {obs.is_compliant === null && <Badge variant="secondary" className="text-xs">Pending</Badge>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {obs.nights_stayed_this_month != null ? obs.nights_stayed_this_month : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {obs.recorded_by_user
                      ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {observations.length >= 500 && (
            <div className="p-3 text-center text-xs text-muted-foreground border-t">
              Showing first 500 results. Use date filters or export CSV to see all records.
            </div>
          )}
        </div>
      )}
    </AppLayout>
  )
}
