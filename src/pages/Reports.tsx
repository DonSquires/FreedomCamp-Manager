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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  FileText,
  Download,
  CheckCircle,
  AlertTriangle,
  BarChart3,
  Car,
  MapPin,
  Printer,
  Clock,
  Send,
  Mail,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { arrayToCSV, downloadCSV } from '@/lib/csvExport'
import { generateReportHTML, exportReportPDF } from '@/lib/pdfExport'
import type { PDFReportConfig, PDFSection } from '@/lib/pdfExport'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { AsyncStateWrapper } from '@/components/features/AsyncStateWrapper'

const EMAIL_TIMEOUT_MS = 45000

interface ObservationRow {
  observation_id: string
  plate_number: string | null
  recorded_at: string
  is_compliant: boolean | null
  nights_stayed_this_month: number | null
  gps_latitude: number | null
  gps_longitude: number | null
  zone: { name: string } | null
  recorded_by_user: { first_name: string; last_name: string } | null
}

interface BreachRow {
  id: string
  plate_number: string | null
  breach_type: string | null
  status: string | null
  created_at: string
  zone: { name: string } | null
  organization: { name: string } | null
}

/** Shape returned by the get_zone_compliance_breakdown RPC */
interface ZoneStatRow {
  zone_id: string
  zone_name: string
  organization_name: string | null
  is_active: boolean
  nights_per_month: number | null
  max_consecutive_nights: number | null
  self_contained_required: boolean
  day_visit_only: boolean
  obs_count: number
  breach_count: number
  compliance_pct: number
}

interface EnforcementRow {
  id: string
  plate_number: string | null
  action_type: string | null
  status: string | null
  created_at: string
  zone: { name: string } | null
}

async function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Returns a Tailwind text-colour class based on a 0-100 compliance percentage. */
function complianceColorClass(pct: number): string {
  if (pct >= 80) return 'text-green-600'
  if (pct >= 60) return 'text-orange-500'
  return 'text-red-600'
}

export default function Reports() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()

  const effectiveOrgId =
    user?.role !== 'master' ? user?.organization_id || null : organizationId || null

  const reportDateTo = dateTo || new Date().toISOString().slice(0, 10)
  const reportDateFrom =
    dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const startDate = nzDateToUTCStart(reportDateFrom)
  const endDate = nzDateToUTCEnd(reportDateTo)

  const [activeTab, setActiveTab] = useState('summary')

  // ── Server-side compliance stats (accurate, no row cap) ───────────────────
  // Uses the same get_compliance_stats RPC as ObservationsReport and CompliancePage
  // so the numbers on this page always agree with the rest of the admin portal.
  const { data: statsRpc, isLoading: loadingStats } = useQuery({
    queryKey: ['report-stats', effectiveOrgId, zoneId, reportDateFrom, reportDateTo],
    queryFn: async () => {
      const rpcPromise = (supabase.rpc as any)('get_compliance_stats', {
        p_start:            startDate,
        p_end:              endDate,
        p_organization_id:  effectiveOrgId ?? null,
        p_zone_id:          zoneId ?? null,
      })
      
      const result = await withTimeout(
        rpcPromise,
        30000,
        'Compliance stats query timed out (30s)'
      ) as {data: any; error: any}
      
      if (result.error) throw result.error
      const row = Array.isArray(result.data) ? result.data[0] : result.data
      return {
        total:             Number(row?.total_observations ?? 0),
        compliant:         Number(row?.compliant_count    ?? 0),
        breaches:          Number(row?.breach_count       ?? 0),
        compliance_rate:   Number(row?.compliance_rate    ?? 0),
        homeless_vehicles: Number(row?.homeless_vehicles  ?? 0),
      }
    },
    enabled: !!user,
  })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState(user?.email || '')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)

  // ── Observations query ───────────────────────────────────────────────
  const { data: observations = [], isLoading: loadingObs } = useQuery({
    queryKey: ['report-observations', effectiveOrgId, zoneId, reportDateFrom, reportDateTo],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(`
          observation_id, plate_number, recorded_at, is_compliant,
          nights_stayed_this_month, gps_latitude, gps_longitude,
          zone:zones!zone_id(name),
          recorded_by_user:user_profiles!recorded_by(first_name, last_name)
        `)
        .gte('recorded_at', startDate)
        .lte('recorded_at', endDate)
        .order('recorded_at', { ascending: false })
        .limit(1000)

      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (zoneId) q = q.eq('zone_id', zoneId)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as ObservationRow[]
    },
    enabled: !!user,
  })

  // ── Breach alerts query ──────────────────────────────────────────────
  const { data: breaches = [], isLoading: loadingBreaches } = useQuery({
    queryKey: ['report-breaches', effectiveOrgId, zoneId, reportDateFrom, reportDateTo],
    queryFn: async () => {
      let q = (supabase.from('breach_alerts') as any)
        .select(`
          id, plate_number, breach_type, status, created_at,
          zone:zones(name),
          organization:organizations(name)
        `)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false })
        .limit(500)

      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (zoneId) q = q.eq('zone_id', zoneId)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as BreachRow[]
    },
    enabled: !!user,
  })

  // ── Zone compliance summary (date-filtered via RPC) ────────────────────────
  // Replaces the old embedded-count query which returned all-time totals.
  const { data: zoneStats = [], isLoading: loadingZones } = useQuery({
    queryKey: ['report-zones', effectiveOrgId, reportDateFrom, reportDateTo],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_zone_compliance_breakdown', {
        p_start:            startDate,
        p_end:              endDate,
        p_organization_id:  effectiveOrgId ?? null,
      })
      if (error) throw error
      return (data ?? []) as ZoneStatRow[]
    },
    enabled: !!user,
  })

  // ── Enforcement actions query ────────────────────────────────────────
  const { data: enforcement = [], isLoading: loadingEnforcement } = useQuery({
    queryKey: ['report-enforcement', effectiveOrgId, zoneId, reportDateFrom, reportDateTo],
    queryFn: async () => {
      let q = supabase
        .from('enforcement_actions')
        .select(`
          id, plate_number, action_type, status, created_at,
          zone:zones(name)
        `)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false })
        .limit(500)

      if (effectiveOrgId) q = q.eq('organization_id', effectiveOrgId)
      if (zoneId) q = q.eq('zone_id', zoneId)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as EnforcementRow[]
    },
    enabled: !!user,
  })

  const isLoading = loadingObs || loadingBreaches || loadingStats || loadingZones || loadingEnforcement

  // ── Computed statistics ──────────────────────────────────────────────
  // Primary stats come from the server-side RPC (no 1000-row cap).
  // uniquePlates is derived from the fetched observation rows (display-capped at 1000)
  // and will under-count only when the period has > 1000 observations.
  const totalObs    = statsRpc?.total    ?? observations.length
  const compliantObs = statsRpc?.compliant ?? observations.filter((o) => o.is_compliant === true).length
  const breachObs    = statsRpc?.breaches  ?? observations.filter((o) => o.is_compliant === false).length
  const pendingObs   = observations.filter((o) => o.is_compliant === null).length
  // Use the RPC compliance_rate when available; it uses the same formula as CompliancePage / ObservationsReport
  const complianceRate = statsRpc != null
    ? statsRpc.compliance_rate.toFixed(1)
    : totalObs > 0 ? ((compliantObs / totalObs) * 100).toFixed(1) : '0.0'
  const uniquePlates = new Set(observations.map((o) => o.plate_number).filter(Boolean)).size

  // Active zones from the RPC breakdown (only zones with is_active flag)
  const activeZones = zoneStats.filter((z) => z.is_active)

  const breachByType: Record<string, number> = {}
  breaches.forEach((b) => {
    const t = b.breach_type || 'unknown'
    breachByType[t] = (breachByType[t] || 0) + 1
  })

  const breachByStatus: Record<string, number> = {}
  breaches.forEach((b) => {
    const s = b.status || 'unknown'
    breachByStatus[s] = (breachByStatus[s] || 0) + 1
  })

  const enforcementByType: Record<string, number> = {}
  enforcement.forEach((e) => {
    const t = e.action_type || 'unknown'
    enforcementByType[t] = (enforcementByType[t] || 0) + 1
  })

  const zoneRows = activeZones.map((z) => ({
    name: z.zone_name,
    observations: Number(z.obs_count),
    breaches: Number(z.breach_count),
    compliance_pct: Number(z.compliance_pct),
    self_contained_required: z.self_contained_required ? 'Yes' : 'No',
    max_stay_nights: z.max_consecutive_nights ?? '—',
  }))

  // Top offenders – plates with most breaches
  const plateCounts: Record<string, number> = {}
  breaches.forEach((b) => {
    if (b.plate_number) plateCounts[b.plate_number] = (plateCounts[b.plate_number] || 0) + 1
  })
  const topOffenders = Object.entries(plateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([plate, count]) => ({ plate_number: plate, breach_count: count }))

  // ── Export helpers ───────────────────────────────────────────────────

  const handleExportObservationsCSV = () => {
    const csv = arrayToCSV(
      observations.map((o) => ({
        plate_number: o.plate_number || '',
        zone: o.zone?.name || '',
        recorded_at: o.recorded_at
          ? new Date(o.recorded_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
          : '',
        result: o.is_compliant === true ? 'Compliant' : o.is_compliant === false ? 'Breach' : 'Pending',
        nights_this_month: o.nights_stayed_this_month ?? '',
        officer: o.recorded_by_user
          ? `${o.recorded_by_user.first_name} ${o.recorded_by_user.last_name}`
          : '',
      })),
      [
        { key: 'plate_number', label: 'Plate Number' },
        { key: 'zone', label: 'Zone' },
        { key: 'recorded_at', label: 'Recorded At' },
        { key: 'result', label: 'Result' },
        { key: 'nights_this_month', label: 'Nights This Month' },
        { key: 'officer', label: 'Officer' },
      ]
    )
    downloadCSV(csv, `observations-${reportDateFrom}-to-${reportDateTo}.csv`)
    toast.success('Observations CSV downloaded')
  }

  const handleExportBreachesCSV = () => {
    const csv = arrayToCSV(
      breaches.map((b) => ({
        plate_number: b.plate_number || '',
        zone: b.zone?.name || '',
        breach_type: b.breach_type || '',
        status: b.status || '',
        created_at: b.created_at
          ? new Date(b.created_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
          : '',
      })),
      [
        { key: 'plate_number', label: 'Plate Number' },
        { key: 'zone', label: 'Zone' },
        { key: 'breach_type', label: 'Breach Type' },
        { key: 'status', label: 'Status' },
        { key: 'created_at', label: 'Created At' },
      ]
    )
    downloadCSV(csv, `breaches-${reportDateFrom}-to-${reportDateTo}.csv`)
    toast.success('Breaches CSV downloaded')
  }

  const handleExportZonesCSV = () => {
    const csv = arrayToCSV(zoneRows, [
      { key: 'name', label: 'Zone Name' },
      { key: 'observations', label: 'Observations (Period)' },
      { key: 'breaches', label: 'Breaches (Period)' },
      { key: 'compliance_pct', label: 'Compliance %' },
      { key: 'self_contained_required', label: 'SC Required' },
      { key: 'max_stay_nights', label: 'Max Consecutive Nights' },
    ])
    downloadCSV(csv, `zones-report-${reportDateFrom}-to-${reportDateTo}.csv`)
    toast.success('Zones CSV downloaded')
  }

  const handleExportEnforcementCSV = () => {
    const csv = arrayToCSV(
      enforcement.map((e) => ({
        plate_number: e.plate_number || '',
        zone: e.zone?.name || '',
        action_type: e.action_type || '',
        status: e.status || '',
        created_at: e.created_at
          ? new Date(e.created_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
          : '',
      })),
      [
        { key: 'plate_number', label: 'Plate Number' },
        { key: 'zone', label: 'Zone' },
        { key: 'action_type', label: 'Action Type' },
        { key: 'status', label: 'Status' },
        { key: 'created_at', label: 'Created At' },
      ]
    )
    downloadCSV(csv, `enforcement-${reportDateFrom}-to-${reportDateTo}.csv`)
    toast.success('Enforcement CSV downloaded')
  }

  // ── PDF export ──────────────────────────────────────────────────────
  const buildPDFConfig = (): PDFReportConfig => ({
    title: 'Compliance Summary Report',
    subtitle: 'Freedom Camping Compliance Analysis',
    organizationName: user?.organization_id ? 'Organisation Report' : 'All Organisations',
    generatedBy: user?.email || 'System',
    generatedAt: new Date(),
    dateRange: { from: new Date(reportDateFrom), to: new Date(reportDateTo) },
  })

  const buildPDFSections = (): PDFSection[] => [
    {
      heading: 'Executive Summary',
      content: [
        `Total Observations: ${totalObs}`,
        `Compliant: ${compliantObs} (${complianceRate}%)`,
        `Breaches: ${breachObs}`,
        `Pending (null status): ${pendingObs}`,
        `Unique Vehicles (display sample): ${uniquePlates}`,
        `Total Breach Alerts: ${breaches.length}`,
        `Enforcement Actions: ${enforcement.length}`,
        `Homeless Vehicles in System: ${statsRpc?.homeless_vehicles ?? '—'}`,
      ],
      type: 'list',
    },
    {
      heading: 'Breach Type Breakdown',
      content: Object.entries(breachByType).map(([type, count]) => ({
        breach_type: type,
        count,
      })),
      type: 'table',
    },
    {
      heading: 'Top Offending Vehicles',
      content: topOffenders,
      type: 'table',
    },
    {
      heading: 'Zone Activity (Period)',
      content: zoneRows,
      type: 'table',
    },
    {
      heading: 'Enforcement Actions Summary',
      content: Object.entries(enforcementByType).map(([type, count]) => ({
        action_type: type,
        count,
      })),
      type: 'table',
    },
  ]

  const handleExportPDF = () => {
    setGeneratingReport(true)
    try {
      exportReportPDF(buildPDFConfig(), buildPDFSections())
      toast.success('PDF report opened for printing')
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate PDF')
    } finally {
      setGeneratingReport(false)
    }
  }

  const handlePreviewPDF = () => {
    setGeneratingReport(true)
    try {
      const html = generateReportHTML(buildPDFConfig(), buildPDFSections())
      setPreviewHtml(html)
      setPreviewOpen(true)
    } finally {
      setGeneratingReport(false)
    }
  }

  function downloadHtml(html: string, filename: string) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Email send (edge function, optional) ────────────────────────────
  const handleSendEmail = async () => {
    if (!emailRecipient.trim()) {
      toast.error('Recipient email is required')
      return
    }
    setSendingEmail(true)
    try {
      const { error } = await withTimeout(
        edgeFunctions.sendReportEmail({
          report_type: 'compliance',
          recipient_email: emailRecipient.trim(),
          organization_id: effectiveOrgId || undefined,
          zone_id: zoneId || undefined,
          date_from: reportDateFrom,
          date_to: reportDateTo,
        }),
        EMAIL_TIMEOUT_MS,
        'Email send timed out'
      )
      if (error) throw new Error(error)
      toast.success(`Report sent to ${emailRecipient.trim()}`)
      setEmailDialogOpen(false)
    } catch (error: any) {
      toast.error('Failed to send report email', {
        description: error?.message || 'Unknown error',
      })
    } finally {
      setSendingEmail(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <>
      <AppLayout title="Reports" description="Generate compliance reports, view data previews, and export" showBackButton>
        <GlobalFilterRibbon />

        <AsyncStateWrapper isLoading={isLoading} loadingText="Loading report data…">
        {/* Summary statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          {[
            { label: 'Observations', value: totalObs, icon: <FileText className="h-5 w-5 text-blue-500" />, color: 'text-blue-600' },
            { label: 'Compliant', value: compliantObs, icon: <CheckCircle className="h-5 w-5 text-green-500" />, color: 'text-green-600' },
            { label: 'Breaches', value: breachObs, icon: <AlertTriangle className="h-5 w-5 text-red-500" />, color: 'text-red-600' },
            { label: 'Compliance Rate', value: `${complianceRate}%`, icon: <BarChart3 className="h-5 w-5 text-blue-500" />, color: 'text-blue-600' },
            { label: 'Unique Vehicles', value: uniquePlates, icon: <Car className="h-5 w-5 text-purple-500" />, color: 'text-purple-600' },
            { label: 'Zones', value: activeZones.length, icon: <MapPin className="h-5 w-5 text-orange-500" />, color: 'text-orange-600' },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`text-2xl font-bold ${s.color}`}>{isLoading ? '…' : s.value}</div>
                    <div className="text-sm text-muted-foreground">{s.label}</div>
                  </div>
                  {s.icon}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Export actions bar */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            {generatingReport && (
              <div className="mb-3">
                <div className="h-1.5 w-full overflow-hidden rounded bg-blue-100 dark:bg-blue-900/25">
                  <div className="h-full w-1/2 animate-pulse rounded bg-blue-500" />
                </div>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">Generating report…</p>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button onClick={handlePreviewPDF} disabled={isLoading || generatingReport}>
                <FileText className="h-4 w-4 mr-2" />
                Preview Report
              </Button>
              <Button onClick={handleExportPDF} variant="outline" disabled={isLoading || generatingReport}>
                <Printer className="h-4 w-4 mr-2" />
                Export PDF
              </Button>
              <Button onClick={handleExportObservationsCSV} variant="outline" disabled={isLoading}>
                <Download className="h-4 w-4 mr-2" />
                Export Observations CSV
              </Button>
              <Button onClick={handleExportBreachesCSV} variant="outline" disabled={isLoading}>
                <Download className="h-4 w-4 mr-2" />
                Export Breaches CSV
              </Button>
              <Button
                variant="outline"
                disabled={isLoading}
                onClick={() => {
                  setEmailRecipient(user?.email || '')
                  setEmailDialogOpen(true)
                }}
              >
                <Mail className="h-4 w-4 mr-2" />
                Send by Email
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabbed data preview */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="observations">Observations ({totalObs})</TabsTrigger>
            <TabsTrigger value="breaches">Breaches ({breaches.length})</TabsTrigger>
            <TabsTrigger value="zones">Zones ({activeZones.length})</TabsTrigger>
            <TabsTrigger value="enforcement">Enforcement ({enforcement.length})</TabsTrigger>
          </TabsList>

          {/* Summary tab */}
          <TabsContent value="summary" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Breach Type Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Breach Type Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(breachByType).length > 0 ? (
                    <div className="space-y-3">
                      {Object.entries(breachByType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => {
                          const pct = breaches.length > 0 ? ((count / breaches.length) * 100).toFixed(0) : '0'
                          return (
                            <div key={type}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                                <span className="font-semibold">{count} ({pct}%)</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-red-500 rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No breach data for this period</p>
                  )}
                </CardContent>
              </Card>

              {/* Breach Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Breach Status</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(breachByStatus).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(breachByStatus)
                        .sort((a, b) => b[1] - a[1])
                        .map(([status, count]) => (
                          <div key={status} className="flex justify-between items-center">
                            <Badge variant={status === 'resolved' ? 'default' : 'secondary'} className="capitalize">
                              {status.replace(/_/g, ' ')}
                            </Badge>
                            <span className="font-semibold">{count}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No breach data for this period</p>
                  )}
                </CardContent>
              </Card>

              {/* Top offenders */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Offending Vehicles</CardTitle>
                </CardHeader>
                <CardContent>
                  {topOffenders.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium">Plate</th>
                            <th className="text-right px-3 py-2 font-medium">Breaches</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {topOffenders.map((v) => (
                            <tr key={v.plate_number}>
                              <td className="px-3 py-2 font-mono font-semibold">{v.plate_number}</td>
                              <td className="px-3 py-2 text-right">{v.breach_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No breaches in this period</p>
                  )}
                </CardContent>
              </Card>

              {/* Enforcement summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Enforcement Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(enforcementByType).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(enforcementByType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex justify-between items-center">
                            <span className="capitalize text-sm">{type.replace(/_/g, ' ')}</span>
                            <span className="font-semibold">{count}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No enforcement actions in this period</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Observations tab */}
          <TabsContent value="observations">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Observations</CardTitle>
                  <CardDescription>Showing up to 1,000 records for the selected period</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleExportObservationsCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingObs ? (
                  <div className="text-center py-12 text-muted-foreground">Loading…</div>
                ) : observations.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No observations for this period</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Plate</th>
                          <th className="text-left px-3 py-2 font-medium">Zone</th>
                          <th className="text-left px-3 py-2 font-medium">Recorded At</th>
                          <th className="text-left px-3 py-2 font-medium">Result</th>
                          <th className="text-left px-3 py-2 font-medium">Nights</th>
                          <th className="text-left px-3 py-2 font-medium">Officer</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {observations.slice(0, 200).map((obs) => (
                          <tr key={obs.observation_id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono font-semibold">{obs.plate_number || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground">{obs.zone?.name || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground">{formatDateTime(obs.recorded_at)}</td>
                            <td className="px-3 py-2">
                              {obs.is_compliant === true && <Badge className="bg-green-600 text-xs">Compliant</Badge>}
                              {obs.is_compliant === false && <Badge variant="destructive" className="text-xs">Breach</Badge>}
                              {obs.is_compliant === null && <Badge variant="secondary" className="text-xs">Pending</Badge>}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{obs.nights_stayed_this_month ?? '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {obs.recorded_by_user
                                ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {observations.length > 200 && (
                      <div className="p-3 text-center text-xs text-muted-foreground border-t">
                        Showing first 200 of {observations.length} records. Export CSV for full dataset.
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Breaches tab */}
          <TabsContent value="breaches">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Breach Alerts</CardTitle>
                  <CardDescription>All breaches for the selected period</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleExportBreachesCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingBreaches ? (
                  <div className="text-center py-12 text-muted-foreground">Loading…</div>
                ) : breaches.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No breaches for this period</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Plate</th>
                          <th className="text-left px-3 py-2 font-medium">Zone</th>
                          <th className="text-left px-3 py-2 font-medium">Type</th>
                          <th className="text-left px-3 py-2 font-medium">Status</th>
                          <th className="text-left px-3 py-2 font-medium">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {breaches.slice(0, 200).map((b) => (
                          <tr key={b.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono font-semibold">{b.plate_number || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground">{b.zone?.name || '—'}</td>
                            <td className="px-3 py-2 capitalize">{(b.breach_type || '').replace(/_/g, ' ')}</td>
                            <td className="px-3 py-2">
                              <Badge
                                variant={b.status === 'resolved' ? 'default' : 'secondary'}
                                className="text-xs capitalize"
                              >
                                {(b.status || '').replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{formatDateTime(b.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {breaches.length > 200 && (
                      <div className="p-3 text-center text-xs text-muted-foreground border-t">
                        Showing first 200 of {breaches.length} records. Export CSV for full dataset.
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Zones tab */}
          <TabsContent value="zones">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Zone Summary</CardTitle>
                  <CardDescription>Active zones with observation and breach counts</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleExportZonesCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingZones ? (
                  <div className="text-center py-12 text-muted-foreground">Loading…</div>
                ) : activeZones.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No zones found</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Zone</th>
                          <th className="text-right px-3 py-2 font-medium">Observations</th>
                          <th className="text-right px-3 py-2 font-medium">Breaches</th>
                          <th className="text-right px-3 py-2 font-medium">Compliance %</th>
                          <th className="text-center px-3 py-2 font-medium">SC Required</th>
                          <th className="text-right px-3 py-2 font-medium">Max Nights</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {zoneRows.map((z) => (
                          <tr key={z.name} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium">{z.name}</td>
                            <td className="px-3 py-2 text-right">{z.observations}</td>
                            <td className="px-3 py-2 text-right">{z.breaches}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`font-semibold ${complianceColorClass(z.compliance_pct)}`}>
                                {z.compliance_pct}%
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">{z.self_contained_required}</td>
                            <td className="px-3 py-2 text-right">{z.max_stay_nights}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Enforcement tab */}
          <TabsContent value="enforcement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Enforcement Actions</CardTitle>
                  <CardDescription>Actions taken during the selected period</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleExportEnforcementCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </Button>
              </CardHeader>
              <CardContent>
                {loadingEnforcement ? (
                  <div className="text-center py-12 text-muted-foreground">Loading…</div>
                ) : enforcement.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No enforcement actions for this period</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Plate</th>
                          <th className="text-left px-3 py-2 font-medium">Zone</th>
                          <th className="text-left px-3 py-2 font-medium">Type</th>
                          <th className="text-left px-3 py-2 font-medium">Status</th>
                          <th className="text-left px-3 py-2 font-medium">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {enforcement.slice(0, 200).map((e) => (
                          <tr key={e.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono font-semibold">{e.plate_number || '—'}</td>
                            <td className="px-3 py-2 text-muted-foreground">{e.zone?.name || '—'}</td>
                            <td className="px-3 py-2 capitalize">{(e.action_type || '').replace(/_/g, ' ')}</td>
                            <td className="px-3 py-2">
                              <Badge
                                variant={e.status === 'completed' ? 'default' : 'secondary'}
                                className="text-xs capitalize"
                              >
                                {(e.status || '').replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{formatDateTime(e.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {enforcement.length > 200 && (
                      <div className="p-3 text-center text-xs text-muted-foreground border-t">
                        Showing first 200 of {enforcement.length} records. Export CSV for full dataset.
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </AsyncStateWrapper>
      </AppLayout>

      {/* PDF Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="w-[98vw] max-w-[98vw] h-[96vh] flex flex-col p-4">
          <DialogHeader>
            <DialogTitle>Compliance Report Preview</DialogTitle>
            <DialogDescription>In-app preview. Use Print/Download buttons below.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 border rounded-md overflow-hidden bg-white">
            <iframe title="Compliance report preview" className="w-full h-full" srcDoc={previewHtml} />
          </div>
          <DialogFooter className="gap-2">
            <Button onClick={handleExportPDF}>
              <Printer className="h-4 w-4 mr-2" />
              Print / Save as PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (previewHtml) downloadHtml(previewHtml, `compliance-report-${reportDateFrom}-to-${reportDateTo}.html`)
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download HTML
            </Button>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={(open) => { if (!open) setSendingEmail(false); setEmailDialogOpen(open) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-600" />
              Send Compliance Report by Email
            </DialogTitle>
            <DialogDescription>
              Sends compliance report for {reportDateFrom} to {reportDateTo}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="report-email-recipient">Recipient email address</Label>
              <Input
                id="report-email-recipient"
                type="email"
                placeholder="e.g. manager@example.com"
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
                disabled={sendingEmail}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setSendingEmail(false); setEmailDialogOpen(false) }}>Cancel</Button>
            <Button onClick={handleSendEmail} disabled={sendingEmail || !emailRecipient.trim()}>
              {sendingEmail ? (
                <><Clock className="h-4 w-4 mr-2 animate-spin" />Sending…</>
              ) : (
                <><Send className="h-4 w-4 mr-2" />Send Report</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
