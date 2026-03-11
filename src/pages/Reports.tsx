import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { StatCard } from '@/components/features/StatCard'
import { FileText, Download, TrendingUp, Users, MapPin, AlertCircle, Clock, CheckCircle, HeartPulse, Scale, Mail, Send } from 'lucide-react'
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

/** Maximum ms to wait for the generate-dashboard-report Edge Function before giving up. */
const REPORT_TIMEOUT_MS = 120_000
/** Maximum ms to wait for the send-report-email Edge Function before giving up. */
const EMAIL_TIMEOUT_MS = 60_000

async function callFunctionDirect<T = any>(
  functionName: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ data: T | null; error: string | null }> {
  async function invokeWithToken(accessToken: string): Promise<{ status: number; parsed: any; networkError: string | null }> {
    const controller = new AbortController()
    const timerId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const text = await response.text()
      let parsed: any = null
      if (text) {
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = { message: text }
        }
      }

      return { status: response.status, parsed, networkError: null }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { status: 0, parsed: null, networkError: 'Request timed out. Please try a smaller date range.' }
      }
      return { status: 0, parsed: null, networkError: error?.message || 'Unknown request error' }
    } finally {
      clearTimeout(timerId)
    }
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) {
    return { data: null, error: 'No active session found. Please sign in again.' }
  }

  let result = await invokeWithToken(sessionData.session.access_token)
  let attemptedRefresh = false
  let refreshFailureMessage: string | null = null

  // Retry once with a freshly refreshed token when the gateway rejects JWT.
  if (result.status === 401) {
    attemptedRefresh = true
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError || !refreshData.session?.access_token) {
      refreshFailureMessage = refreshError?.message || 'No refreshed access token returned'
    } else {
      result = await invokeWithToken(refreshData.session.access_token)
    }
  }

  if (result.networkError) {
    return { data: null, error: result.networkError }
  }

  if (result.status < 200 || result.status >= 300) {
    if (result.status === 401) {
      if (refreshFailureMessage) {
        return {
          data: null,
          error:
            `HTTP 401: Session expired and refresh failed (${refreshFailureMessage}). ` +
            'Please sign out and sign in again.',
        }
      }

      if (attemptedRefresh) {
        return {
          data: null,
          error:
            'HTTP 401: Token still invalid after refresh. ' +
            'This usually means a project URL/anon key mismatch in the deployed frontend. ' +
            'Confirm VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY point to the same Supabase project as your login session.',
        }
      }
    }

    const messageParts = [
      result.parsed?.error,
      result.parsed?.message,
      result.parsed?.code ? `code=${result.parsed.code}` : null,
      result.parsed?.details,
      result.parsed?.hint,
    ].filter(Boolean)

    const message =
      messageParts.length > 0
        ? messageParts.join(' | ')
        : `Request failed with status ${result.status}`

    return { data: null, error: `HTTP ${result.status}: ${String(message)}` }
  }

  return { data: result.parsed as T, error: null }
}

function formatErrorDetail(error: unknown): string {
  if (typeof error === 'string') return error

  if (error instanceof Error) {
    const anyError = error as any
    const messageParts = [
      anyError.message,
      anyError.code ? `code=${anyError.code}` : null,
      anyError.details,
      anyError.hint,
      anyError.status ? `status=${anyError.status}` : null,
    ].filter(Boolean)

    return messageParts.join(' | ') || 'Unknown error'
  }

  if (error && typeof error === 'object') {
    const anyError = error as any
    const messageParts = [
      anyError.error,
      anyError.message,
      anyError.code ? `code=${anyError.code}` : null,
      anyError.details,
      anyError.hint,
      anyError.status ? `status=${anyError.status}` : null,
    ].filter(Boolean)

    if (messageParts.length > 0) return messageParts.join(' | ')

    try {
      return JSON.stringify(anyError)
    } catch {
      return 'Unknown error'
    }
  }

  return 'Unknown error'
}

function showDetailedErrorToast(title: string, error: unknown) {
  toast.error(title, {
    description: formatErrorDetail(error),
  })
}

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

  // In-app report preview state
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false)
  const [reportPreviewTitle, setReportPreviewTitle] = useState('')
  const [reportPreviewHtml, setReportPreviewHtml] = useState('')

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailReportType, setEmailReportType] = useState<string>('')
  const [emailRecipient, setEmailRecipient] = useState<string>('')
  const [sendingEmail, setSendingEmail] = useState(false)

  const effectiveOrganizationId =
    user?.role !== 'master' ? user?.organization_id || null : organizationId || null
  const startDate = dateFrom ? `${dateFrom}T00:00:00Z` : null
  const endDate = dateTo ? `${dateTo}T23:59:59Z` : null
  const reportDateTo = dateTo || new Date().toISOString().slice(0, 10)
  const reportDateFrom =
    dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Fetch report statistics
  const { data: stats, isLoading, error: statsError } = useQuery({
    queryKey: ['report-stats', organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      // Get observation count
      let obsQuery = (supabase.from('observations') as any)
        .select('observation_id, is_compliant', { count: 'exact' })
        

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

      const { data: observations, count: observationCount, error: observationsError } = await obsQuery
      if (observationsError) throw observationsError

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

      const { count: enforcementCount, error: enforcementError } = await enforcementQuery
      if (enforcementError) throw enforcementError

      // Get zone count
      let zoneQuery = supabase
        .from('zones')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)

      if (effectiveOrganizationId) {
        zoneQuery = zoneQuery.eq('organization_id', effectiveOrganizationId)
      }

      const { count: zoneCount, error: zonesError } = await zoneQuery
      if (zonesError) throw zonesError

      return {
        observations: observationCount || 0,
        enforcement: enforcementCount || 0,
        compliance_rate: complianceRate,
        zones: zoneCount || 0,
      }
    },
  })

  useEffect(() => {
    if (!statsError) return
    showDetailedErrorToast('Failed to load report statistics', statsError)
  }, [statsError])

  // Generate report mutation
  const generateReportMutation = useMutation({
    mutationFn: async (reportType: string) => {
      setGeneratingReport(reportType)

      const { data, error } = await callFunctionDirect<any>(
        'generate-dashboard-report',
        {
        report_type: reportType,
        organization_id: effectiveOrganizationId || undefined,
        zone_id: zoneId || undefined,
        date_from: reportDateFrom,
        date_to: reportDateTo,
        },
        REPORT_TIMEOUT_MS
      )

      if (error) {
        throw new Error(error)
      }

      return data
    },
    onSuccess: (data, reportType) => {
      try {
        toast.success(`${reportType} report generated successfully`)

        if (data?.html) {
          setReportPreviewTitle(reportType.replace(/-/g, ' '))
          setReportPreviewHtml(data.html)
          setReportPreviewOpen(true)
        } else if (data?.url) {
          // Keep UX in-app by embedding a lightweight redirect page.
          setReportPreviewTitle(reportType.replace(/-/g, ' '))
          setReportPreviewHtml(
            `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:16px"><p>Open generated report:</p><p><a href="${String(data.url)}" target="_blank" rel="noopener noreferrer">${String(data.url)}</a></p></body></html>`
          )
          setReportPreviewOpen(true)
        } else {
          toast.error('Report generated but no printable content was returned', {
            description: `Expected html or url payload. Received keys: ${Object.keys(data || {}).join(', ') || 'none'}`,
          })
        }
      } catch (handlerError) {
        showDetailedErrorToast('Report generated, but opening/downloading failed', handlerError)
      } finally {
        setGeneratingReport(null)
      }
    },
    onError: (error: any, reportType) => {
      showDetailedErrorToast(`Failed to generate ${reportType} report`, error)
      setGeneratingReport(null)
    },
    onSettled: () => {
      // Defensive reset so the UI never gets stuck in "Generating...".
      setGeneratingReport(null)
    },
  })

  const handleGenerateReport = (reportType: string) => {
    setReportPreviewOpen(false)
    setReportPreviewHtml('')
    setReportPreviewTitle('')
    generateReportMutation.mutate(reportType)
  }

  // ── Email report helpers ───────────────────────────────────────────────────
  const handleOpenEmailDialog = (reportType: string) => {
    setEmailReportType(reportType)
    // Default to the currently signed-in user's email
    setEmailRecipient(user?.email || '')
    setEmailDialogOpen(true)
  }

  const handleSendEmail = async () => {
    if (!emailRecipient.trim()) {
      toast.error('Please enter a recipient email address')
      return
    }
    setSendingEmail(true)

    try {
      const { error } = await callFunctionDirect(
        'send-report-email',
        {
          report_type:     emailReportType,
          recipient_email: emailRecipient.trim(),
          organization_id: effectiveOrganizationId || undefined,
          zone_id:         zoneId || undefined,
          date_from:       reportDateFrom,
          date_to:         reportDateTo,
        },
        EMAIL_TIMEOUT_MS
      )
      if (error) {
        showDetailedErrorToast('Failed to send email', error)
      } else {
        toast.success(`Report emailed to ${emailRecipient}`)
        setEmailDialogOpen(false)
      }
    } catch (err: any) {
      showDetailedErrorToast('Failed to send email', err)
    } finally {
      setSendingEmail(false)
    }
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
      showDetailedErrorToast('H&S register export failed', err)
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
      showDetailedErrorToast('Infringement export failed', err)
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
      showDetailedErrorToast('Client patrol report export failed', err)
    } finally {
      setExportingPatrol(false)
    }
  }

  return (
    <>
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
              className="w-full mb-2"
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
            <Button
              variant="outline"
              onClick={() => handleOpenEmailDialog('compliance')}
              className="w-full"
              disabled={generatingReport === 'compliance'}
            >
              <Mail className="h-4 w-4 mr-2" />
              Send by Email
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
              className="w-full mb-2"
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
            <Button
              variant="outline"
              onClick={() => handleOpenEmailDialog('enforcement')}
              className="w-full"
              disabled={generatingReport === 'enforcement'}
            >
              <Mail className="h-4 w-4 mr-2" />
              Send by Email
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
              className="w-full mb-2"
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
            <Button
              variant="outline"
              onClick={() => handleOpenEmailDialog('vehicle-activity')}
              className="w-full"
              disabled={generatingReport === 'vehicle-activity'}
            >
              <Mail className="h-4 w-4 mr-2" />
              Send by Email
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
              className="w-full mb-2"
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
            <Button
              variant="outline"
              onClick={() => handleOpenEmailDialog('zone-stats')}
              className="w-full"
              disabled={generatingReport === 'zone-stats'}
            >
              <Mail className="h-4 w-4 mr-2" />
              Send by Email
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

    {/* ── In-app report preview dialog ── */}
    <Dialog open={reportPreviewOpen} onOpenChange={setReportPreviewOpen}>
      <DialogContent className="sm:max-w-6xl w-[95vw] h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {reportPreviewTitle || 'Generated report'}
          </DialogTitle>
          <DialogDescription>
            Review the report in-app and use the report's "Download PDF" button.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 border rounded-md overflow-hidden bg-white">
          <iframe
            title="Generated report preview"
            className="w-full h-full"
            srcDoc={reportPreviewHtml}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (!reportPreviewHtml) return
              downloadReportHtml(reportPreviewHtml)
            }}
          >
            Download HTML Copy
          </Button>
          <Button variant="outline" onClick={() => setReportPreviewOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Send Report by Email dialog ── */}
    <Dialog open={emailDialogOpen} onOpenChange={(open) => { if (!open) setSendingEmail(false); setEmailDialogOpen(open) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-blue-600" />
            Send Report by Email
          </DialogTitle>
          <DialogDescription>
            The{' '}
            <span className="font-medium capitalize">
              {emailReportType.replace(/-/g, ' ')}
            </span>{' '}
            report will be sent as a formatted email for the period{' '}
            <span className="font-medium">
              {reportDateFrom} → {reportDateTo}
            </span>
            .
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
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!sendingEmail) handleSendEmail() } }}
              disabled={sendingEmail}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => { setSendingEmail(false); setEmailDialogOpen(false) }}>
            Cancel
          </Button>
          <Button onClick={handleSendEmail} disabled={sendingEmail || !emailRecipient.trim()}>
            {sendingEmail ? (
              <>
                <Clock className="h-4 w-4 mr-2 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
