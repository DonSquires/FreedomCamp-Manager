import { useState, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/features/StatCard'
import { FileText, Download, TrendingUp, Users, MapPin, AlertCircle, Clock, CheckCircle, HeartPulse, Scale, Mail } from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { toast } from 'sonner'

// ── CSV helpers ───────────────────────────────────────────────────────────────
function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: any) => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join(
    '\n'
  )
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const REPORT_LOADING_HTML =
  '<!DOCTYPE html><html><head><title>Generating Report\u2026</title>' +
  '<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;' +
  'min-height:100vh;margin:0;background:#f8fafc}h2{color:#374151;font-weight:500}</style></head>' +
  '<body><h2>&#8987; Generating report, please wait\u2026</h2></body></html>'

function downloadReportHtml(html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report-${new Date().toISOString().slice(0, 10)}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export default function Reports() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [generatingReport, setGeneratingReport] = useState<string | null>(null)
  const reportWindowRef = useRef<Window | null>(null)
  const effectiveOrganizationId =
    user?.role !== 'master' ? user?.organization_id || null : organizationId || null
  const startDate = dateFrom ? `${dateFrom}T00:00:00Z` : null
  const endDate = dateTo ? `${dateTo}T23:59:59Z` : null
  const reportDateTo = dateTo || new Date().toISOString().slice(0, 10)
  const reportDateFrom =
    dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Fetch report statistics
  const { data: stats, isLoading } = useQuery({
    queryKey: ['report-stats', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      // Get observation count
      let obsQuery = (supabase.from('observations') as any)
        .select('id, is_compliant', { count: 'exact' })
        

      if (effectiveOrganizationId) {
        obsQuery = obsQuery.eq('organization_id', effectiveOrganizationId)
      }

      if (startDate) {
        obsQuery = obsQuery.gte('recorded_at', startDate)
      }
      if (endDate) {
        obsQuery = obsQuery.lte('recorded_at', endDate)
      }
      if (zoneId) {
        obsQuery = obsQuery.eq('zone_id', zoneId)
      }

      const { data: observations, count: observationCount } = await obsQuery

      const compliantCount = observations?.filter(o => o.is_compliant).length || 0
      const complianceRate = observationCount && observationCount > 0 
        ? (compliantCount / observationCount) * 100 
        : 0

      // Get enforcement count
      let enforcementQuery = supabase
        .from('enforcement_actions')
        .select('id', { count: 'exact', head: true })

      if (effectiveOrganizationId) {
        enforcementQuery = enforcementQuery.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        enforcementQuery = enforcementQuery.eq('zone_id', zoneId)
      }

      if (startDate) {
        enforcementQuery = enforcementQuery.gte('created_at', startDate)
      }
      if (endDate) {
        enforcementQuery = enforcementQuery.lte('created_at', endDate)
      }

      const { count: enforcementCount } = await enforcementQuery

      // Get zone count
      let zoneQuery = supabase
        .from('zones')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)

      if (effectiveOrganizationId) {
        zoneQuery = zoneQuery.eq('organization_id', effectiveOrganizationId)
      }

      const { count: zoneCount } = await zoneQuery

      return {
        observations: observationCount || 0,
        enforcement: enforcementCount || 0,
        compliance_rate: complianceRate,
        zones: zoneCount || 0,
      }
    },
  })

  // Generate report mutation
  const generateReportMutation = useMutation({
    mutationFn: async (reportType: string) => {
      setGeneratingReport(reportType)

      // Use shared edgeFunction caller so JWT refresh/invalid-session handling is centralized.
      const { data, error } = await edgeFunctions.generateDashboardReport({
        report_type: reportType,
        organization_id: effectiveOrganizationId || undefined,
        zone_id: zoneId || undefined,
        date_from: reportDateFrom,
        date_to: reportDateTo,
      })

      if (error) {
        throw new Error(error)
      }
      return data
    },
    onSuccess: (data, reportType) => {
      toast.success(`${reportType} report generated successfully`)
      const win = reportWindowRef.current
      reportWindowRef.current = null
      try {
        if (data?.html) {
          if (win && !win.closed) {
            // Write report HTML into the pre-opened window
            win.document.open()
            win.document.write(data.html)
            win.document.close()
          } else {
            // Popup was blocked or closed — download as HTML file instead
            downloadReportHtml(data.html)
            toast.info('Report downloaded as an HTML file (popups appear to be blocked)')
          }
        } else if (data?.url) {
          if (win && !win.closed) {
            win.location.href = data.url
          } else {
            window.open(data.url, '_blank')
          }
        } else {
          if (win && !win.closed) win.close()
          toast.error('Report generated but no printable content was returned')
        }
      } finally {
        setGeneratingReport(null)
      }
    },
    onError: (error: any, reportType) => {
      const win = reportWindowRef.current
      reportWindowRef.current = null
      if (win && !win.closed) win.close()
      toast.error(`Failed to generate ${reportType} report: ${error.message}`)
      setGeneratingReport(null)
    },
  })

  const handleGenerateReport = (reportType: string) => {
    // Open the report window NOW while inside the user-gesture event handler so
    // browser popup blockers don't interfere. We'll write the HTML into it once
    // the Edge Function responds.
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(REPORT_LOADING_HTML)
      win.document.close()
    }
    reportWindowRef.current = win
    generateReportMutation.mutate(reportType)
  }

  // ── H&S Register CSV export ────────────────────────────────────────────────
  const [exportingHS, setExportingHS] = useState(false)
  const handleExportHS = async () => {
    setExportingHS(true)
    try {
      let q = supabase
        .from('health_safety_reports')
        .select('id, severity, status, details, resolution_notes, created_at, updated_at, zone:zones(name), reporter:user_profiles!health_safety_reports_reported_by_fkey(first_name,last_name)')
        .order('created_at', { ascending: false })

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      const { data, error } = await q
      if (error) throw error

      const rows = (data || []).map((r: any) => ({
        id: r.id,
        severity: r.severity,
        status: r.status,
        details: r.details,
        zone: r.zone?.name || '',
        reported_by: r.reporter ? `${r.reporter.first_name} ${r.reporter.last_name}` : '',
        resolution_notes: r.resolution_notes || '',
        created_at: r.created_at,
        updated_at: r.updated_at,
      }))

      downloadCSV(toCSV(rows), `hs-register-${new Date().toISOString().slice(0, 10)}.csv`)
      toast.success('H&S Register exported')
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`)
    } finally {
      setExportingHS(false)
    }
  }

  // ── Infringement Bureau Export ─────────────────────────────────────────────
  const [exportingInfringement, setExportingInfringement] = useState(false)
  const handleExportInfringement = async () => {
    setExportingInfringement(true)
    try {
      let q = supabase
        .from('enforcement_actions')
        .select('id, action_type, plate_number, notes, outcome, created_at, zone:zones(name), officer:user_profiles!enforcement_actions_officer_id_fkey(first_name,last_name)')
        .order('created_at', { ascending: false })

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      const { data, error } = await q
      if (error) throw error

      const exportData = (data || []).map((ea: any) => ({
        infringement_id: ea.id,
        plate_number: ea.plate_number || '',
        action_type: ea.action_type || '',
        zone: ea.zone?.name || '',
        officer: ea.officer ? `${ea.officer.first_name} ${ea.officer.last_name}` : '',
        notes: ea.notes || '',
        outcome: ea.outcome || '',
        date: ea.created_at,
      }))

      // Export as both JSON and CSV
      downloadJSON(exportData, `infringement-bureau-${new Date().toISOString().slice(0, 10)}.json`)
      toast.success('Infringement Bureau export downloaded (JSON)')
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`)
    } finally {
      setExportingInfringement(false)
    }
  }

  // ── Client Patrol Report CSV ───────────────────────────────────────────────
  const [exportingPatrol, setExportingPatrol] = useState(false)
  const handleExportPatrolReport = async () => {
    setExportingPatrol(true)
    try {
      let q = supabase
        .from('patrols')
        .select('id, started_at, ended_at, status, notes, zone:zones(name), officer:user_profiles!patrols_officer_id_fkey(first_name,last_name)')
        .order('started_at', { ascending: false })

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('started_at', startDate)
      if (endDate) q = q.lte('started_at', endDate)

      const { data: patrols, error } = await q
      if (error) throw error

      const rows = (patrols || []).map((p: any) => ({
        patrol_id: p.id,
        officer: p.officer ? `${p.officer.first_name} ${p.officer.last_name}` : '',
        zone: p.zone?.name || '',
        started_at: p.started_at,
        ended_at: p.ended_at || '',
        status: p.status,
        notes: p.notes || '',
      }))

      downloadCSV(toCSV(rows), `client-patrol-report-${new Date().toISOString().slice(0, 10)}.csv`)
      toast.success('Client Patrol Report exported')
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`)
    } finally {
      setExportingPatrol(false)
    }
  }

  return (
    <AppLayout title="Reports" description="Generate compliance and enforcement reports" showBackButton>
      <GlobalFilterRibbon />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Observations"
          value={stats?.observations || 0}
          icon={TrendingUp}
          description="in selected period"
        />
        <StatCard
          title="Enforcement Actions"
          value={stats?.enforcement || 0}
          icon={AlertCircle}
          description="warnings & notices"
        />
        <StatCard
          title="Compliance Rate"
          value={`${stats?.compliance_rate?.toFixed(1) || 0}%`}
          icon={CheckCircle}
          variant={stats?.compliance_rate && stats.compliance_rate > 80 ? 'success' : 'warning'}
        />
        <StatCard
          title="Active Zones"
          value={stats?.zones || 0}
          icon={MapPin}
          description="monitored zones"
        />
      </div>

      {/* Report Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Compliance Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <FileText className="h-8 w-8 text-blue-600 mb-2" />
            <CardTitle>Compliance Report</CardTitle>
            <CardDescription>
              Detailed compliance statistics and trends
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Compliance rate by zone</li>
              <li>• Breach type breakdown</li>
              <li>• Monthly trends</li>
              <li>• Top violators</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('compliance')}
              className="w-full"
              disabled={generatingReport === 'compliance'}
            >
              {generatingReport === 'compliance' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Enforcement Activity Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <AlertCircle className="h-8 w-8 text-orange-600 mb-2" />
            <CardTitle>Enforcement Activity</CardTitle>
            <CardDescription>
              Warnings, notices, and enforcement actions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Actions by type</li>
              <li>• Officer activity</li>
              <li>• Resolution rates</li>
              <li>• Timeline view</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('enforcement')}
              className="w-full"
              disabled={generatingReport === 'enforcement'}
            >
              {generatingReport === 'enforcement' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Vehicle Activity Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <Users className="h-8 w-8 text-green-600 mb-2" />
            <CardTitle>Vehicle Activity</CardTitle>
            <CardDescription>
              Vehicle observations and patterns
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Most frequent vehicles</li>
              <li>• Stay duration analysis</li>
              <li>• Zone preferences</li>
              <li>• Seasonal patterns</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('vehicle-activity')}
              className="w-full"
              disabled={generatingReport === 'vehicle-activity'}
            >
              {generatingReport === 'vehicle-activity' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Zone Statistics Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <MapPin className="h-8 w-8 text-purple-600 mb-2" />
            <CardTitle>Zone Statistics</CardTitle>
            <CardDescription>
              Zone-specific metrics and insights
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Observations per zone</li>
              <li>• Peak usage times</li>
              <li>• Compliance by zone</li>
              <li>• Capacity analysis</li>
            </ul>
            <Button
              onClick={() => handleGenerateReport('zone-stats')}
              className="w-full"
              disabled={generatingReport === 'zone-stats'}
            >
              {generatingReport === 'zone-stats' ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Legal & Compliance Exports */}
      <h2 className="text-lg font-semibold mt-2">Legal &amp; Compliance Exports</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Client Patrol Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <Mail className="h-8 w-8 text-blue-600 mb-2" />
            <CardTitle>Client Patrol Report</CardTitle>
            <CardDescription>
              Patrol times, checkpoints, incidents &amp; photos for client delivery
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Patrol start &amp; end times</li>
              <li>• Zone coverage</li>
              <li>• Officer assigned</li>
              <li>• Incident summary</li>
            </ul>
            <Button
              onClick={handleExportPatrolReport}
              className="w-full"
              disabled={exportingPatrol}
              variant="outline"
            >
              {exportingPatrol ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* H&S Register */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <HeartPulse className="h-8 w-8 text-red-600 mb-2" />
            <CardTitle>H&amp;S Register</CardTitle>
            <CardDescription>
              Health &amp; Safety register for internal audits (HSWA 2015)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Near misses &amp; hazards</li>
              <li>• Severity classification</li>
              <li>• Resolution status</li>
              <li>• Auditable CSV format</li>
            </ul>
            <Button
              onClick={handleExportHS}
              className="w-full"
              disabled={exportingHS}
              variant="outline"
            >
              {exportingHS ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Infringement Bureau Export */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <Scale className="h-8 w-8 text-orange-600 mb-2" />
            <CardTitle>Infringement Bureau Export</CardTitle>
            <CardDescription>
              JSON/CSV formatted for NZ Courts &amp; Fines processing (Datacom/Pathfinder)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-4">
              <li>• Infringement ID &amp; plate</li>
              <li>• Action type &amp; outcome</li>
              <li>• Officer &amp; zone</li>
              <li>• Court-admissible format</li>
            </ul>
            <Button
              onClick={handleExportInfringement}
              className="w-full"
              disabled={exportingInfringement}
              variant="outline"
            >
              {exportingInfringement ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export JSON
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Report History (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Reports</CardTitle>
          <CardDescription>
            Previously generated reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-600">
            No reports generated yet
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
