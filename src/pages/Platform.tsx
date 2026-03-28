import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AppLayout } from '@/components/features/AppLayout'
import { edgeFunctions } from '@/lib/edgeFunctions'
import {
  Building2, Users, Scan, AlertTriangle, FileText, TrendingUp, Shield,
  Activity, Globe, DollarSign, Bug, Lightbulb, Zap, ChevronDown, ChevronUp,
  Sparkles, CheckCircle2, Clock, Loader2, Navigation, MonitorDot, RefreshCw,
  Code2,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlatformStats {
  total_organizations: number
  active_organizations: number
  total_users: number
  total_officers: number
  scans_in_period: number
  breaches_in_period: number
  notices_issued: number
  infringements_issued: number
  open_disputes: number
  period_from: string
  period_to: string
}

interface OrgUsageSummary {
  organization_id: string
  organization_name: string
  is_active: boolean
  officer_count: number
  scan_count: number
  breach_count: number
  notice_count: number
  infringement_count: number
}

interface FeedbackReport {
  id: string
  created_at: string
  title: string
  description: string
  severity: string
  issue_type: string
  status: string | null
  current_page: string | null
  steps_to_reproduce: string | null
  expected_behavior: string | null
  actual_behavior: string | null
  console_errors: any
  browser_info: any
  app_version: string
  user_role: string
  organization_id: string | null
  ai_analyzed: boolean | null
  ai_suggested_fix: string | null
  ai_analysis: any
  requires_human_review: boolean | null
  resolution_notes: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Platform() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [periodDays, setPeriodDays] = useState(30)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const isGrandMaster = user?.role === 'grand_master'

  const from = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()
  const to = new Date().toISOString()

  // Platform-wide stats
  const { data: stats, isLoading: statsLoading } = useQuery<PlatformStats>({
    queryKey: ['platform-stats', periodDays],
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase as any).rpc('get_platform_stats', {
        p_from: from,
        p_to: to,
      }).abortSignal(signal)
      if (error) throw error
      return data as unknown as PlatformStats
    },
    refetchInterval: 60_000,
    enabled: isGrandMaster,
  })

  // Per-org usage
  const { data: orgUsage, isLoading: orgLoading } = useQuery<OrgUsageSummary[]>({
    queryKey: ['org-usage-summary', periodDays],
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase as any).rpc('get_org_usage_summary', {
        p_from: from,
        p_to: to,
      }).abortSignal(signal)
      if (error) throw error
      return data as unknown as OrgUsageSummary[]
    },
    refetchInterval: 60_000,
    enabled: isGrandMaster,
  })

  const complianceRate = stats && stats.scans_in_period > 0
    ? Math.round(((stats.scans_in_period - stats.breaches_in_period) / stats.scans_in_period) * 100)
    : null

  // Bug / feedback reports
  const { data: feedbackReports, isLoading: feedbackLoading } = useQuery<FeedbackReport[]>({
    queryKey: ['platform-feedback'],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('bug_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
        .abortSignal(signal)
      if (error) throw error
      return (data ?? []) as unknown as FeedbackReport[]
    },
    refetchInterval: 30_000,
    enabled: isGrandMaster,
  })

  // AI self-healing: analyse a report and store diagnosis + fix suggestion
  const analyseWithAI = useCallback(async (report: FeedbackReport) => {
    setAnalyzingId(report.id)
    try {
      const navHistory: any[] = report.browser_info?.navigationHistory ?? []
      const consoleErrors: any[] = Array.isArray(report.console_errors) ? report.console_errors : []

      const prompt = `You are analysing a bug/feedback report for FreedomCamp Manager, a NZ freedom camping enforcement SaaS.

## Report
**Type**: ${report.issue_type}
**Severity**: ${report.severity}
**Title**: ${report.title}
**Description**: ${report.description}
${report.steps_to_reproduce ? `**Steps to reproduce**:\n${report.steps_to_reproduce}` : ''}
${report.expected_behavior ? `**Expected**: ${report.expected_behavior}` : ''}
${report.actual_behavior ? `**Actual**: ${report.actual_behavior}` : ''}

## Context at time of report
**Page**: ${report.current_page ?? 'unknown'}
**User role**: ${report.user_role}
**App version**: ${report.app_version}

## Navigation breadcrumb (most recent first)
${navHistory.slice(-10).reverse().map((n: any) => `- ${n.path} at ${n.timestamp}`).join('\n') || 'None captured'}

## Console errors
${consoleErrors.slice(-10).map((e: any) => `[${e.level}] ${e.message}${e.stack ? '\n  ' + e.stack.slice(0, 200) : ''}`).join('\n') || 'None captured'}

## Task
1. **Diagnose**: Identify the root cause. Reference specific files, components, or edge functions in FreedomCamp Manager that are likely responsible (e.g. src/pages/X.tsx, supabase/functions/Y/index.ts).
2. **Fix suggestion**: Provide a concrete, actionable code fix or implementation plan. Include file paths, function names, and the specific change required.
3. **Severity assessment**: Confirm or revise the severity (low/medium/high/critical) with justification.
4. **Effort estimate**: Low (< 1 hour) / Medium (half day) / High (1-2 days).

Be specific. Name exact files and line-level changes where possible.`

      const result = await edgeFunctions.aiChat({
        messages: [{ role: 'user', content: prompt }],
      })

      if (result.error) throw new Error(result.error)

      const aiText: string = result.data?.response ?? ''

      // Persist analysis back to bug_reports
      await supabase
        .from('bug_reports')
        .update({
          ai_analyzed: true,
          ai_suggested_fix: aiText,
          ai_analysis: { analyzed_at: new Date().toISOString(), model: result.data?.model ?? 'unknown', provider: result.data?.provider ?? 'unknown' } as any,
          status: 'in_progress',
          requires_human_review: true,
        })
        .eq('id', report.id)

      queryClient.invalidateQueries({ queryKey: ['platform-feedback'] })
      toast.success('AI analysis complete')
    } catch (err: any) {
      toast.error('AI analysis failed', { description: err.message })
    } finally {
      setAnalyzingId(null)
    }
  }, [queryClient])

  const updateStatus = useCallback(async (id: string, status: string) => {
    const { error } = await supabase.from('bug_reports').update({ status }).eq('id', id)
    if (error) { toast.error('Failed to update status'); return }
    queryClient.invalidateQueries({ queryKey: ['platform-feedback'] })
  }, [queryClient])

  // Redirect non-grand-master users away (after all hooks)
  if (!isGrandMaster) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Access restricted to platform administrators.
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />
              Platform Overview
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              FreedomCamp Manager — all organisations, all activity
            </p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map(d => (
              <Button
                key={d}
                variant={periodDays === d ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPeriodDays(d)}
              >
                {d}d
              </Button>
            ))}
          </div>
        </div>

        {/* Platform KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            icon={<Building2 className="h-5 w-5 text-blue-500" />}
            label="Active Orgs"
            value={stats?.active_organizations ?? '—'}
            sub={`of ${stats?.total_organizations ?? '—'} total`}
            loading={statsLoading}
          />
          <KpiCard
            icon={<Users className="h-5 w-5 text-green-500" />}
            label="Active Officers"
            value={stats?.total_officers ?? '—'}
            sub="across all orgs"
            loading={statsLoading}
          />
          <KpiCard
            icon={<Scan className="h-5 w-5 text-indigo-500" />}
            label="Scans"
            value={stats?.scans_in_period?.toLocaleString() ?? '—'}
            sub={`last ${periodDays} days`}
            loading={statsLoading}
          />
          <KpiCard
            icon={<TrendingUp className="h-5 w-5 text-emerald-500" />}
            label="Compliance Rate"
            value={complianceRate != null ? `${complianceRate}%` : '—'}
            sub="platform-wide"
            loading={statsLoading}
          />
          <KpiCard
            icon={<AlertTriangle className="h-5 w-5 text-orange-500" />}
            label="Breach Alerts"
            value={stats?.breaches_in_period?.toLocaleString() ?? '—'}
            sub={`last ${periodDays} days`}
            loading={statsLoading}
          />
          <KpiCard
            icon={<FileText className="h-5 w-5 text-yellow-500" />}
            label="Notices Issued"
            value={stats?.notices_issued?.toLocaleString() ?? '—'}
            sub={`last ${periodDays} days`}
            loading={statsLoading}
          />
          <KpiCard
            icon={<DollarSign className="h-5 w-5 text-red-500" />}
            label="Infringements"
            value={stats?.infringements_issued?.toLocaleString() ?? '—'}
            sub={`last ${periodDays} days`}
            loading={statsLoading}
          />
          <KpiCard
            icon={<Activity className="h-5 w-5 text-purple-500" />}
            label="Open Disputes"
            value={stats?.open_disputes ?? '—'}
            sub="awaiting review"
            loading={statsLoading}
          />
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="organisations">
          <TabsList>
            <TabsTrigger value="organisations">Organisations</TabsTrigger>
            <TabsTrigger value="billing">Usage / Billing</TabsTrigger>
            <TabsTrigger value="feedback" className="gap-1.5">
              Feedback & Issues
              {(feedbackReports ?? []).filter(r => r.status === 'open').length > 0 && (
                <span className="ml-1 rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none">
                  {(feedbackReports ?? []).filter(r => r.status === 'open').length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Organisations tab */}
          <TabsContent value="organisations" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>All Organisations</CardTitle>
                <CardDescription>
                  Every client organisation on the platform.
                  Use the Admin Portal for detailed per-org management.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {orgLoading ? (
                  <p className="text-muted-foreground text-sm">Loading…</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Organisation</th>
                          <th className="pb-2 pr-4 font-medium text-right">Officers</th>
                          <th className="pb-2 pr-4 font-medium text-right">Scans</th>
                          <th className="pb-2 pr-4 font-medium text-right">Breaches</th>
                          <th className="pb-2 pr-4 font-medium text-right">Notices</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(orgUsage ?? []).map(org => (
                          <tr key={org.organization_id} className="border-b last:border-0 hover:bg-muted/40">
                            <td className="py-2 pr-4 font-medium">{org.organization_name}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{org.officer_count}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{org.scan_count.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{org.breach_count.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{org.notice_count}</td>
                            <td className="py-2">
                              <Badge variant={org.is_active ? 'default' : 'secondary'}>
                                {org.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                        {(orgUsage ?? []).length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-4 text-center text-muted-foreground">
                              No organisations found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing tab */}
          <TabsContent value="billing" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Usage Summary</CardTitle>
                <CardDescription>
                  Per-organisation metrics for the selected period.
                  Export as CSV for invoicing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!orgUsage) return
                    const headers = ['Organisation', 'Active', 'Officers', 'Scans', 'Breaches', 'NTVs', 'Infringements']
                    const rows = orgUsage.map(o => [
                      o.organization_name,
                      o.is_active ? 'Yes' : 'No',
                      o.officer_count,
                      o.scan_count,
                      o.breach_count,
                      o.notice_count,
                      o.infringement_count,
                    ])
                    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
                    const blob = new Blob([csv], { type: 'text/csv' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `fcm-usage-${new Date().toISOString().slice(0, 10)}.csv`
                    a.click()
                    URL.revokeObjectURL(url)
                    toast.success('Usage CSV downloaded')
                  }}
                >
                  Export CSV
                </Button>

                {orgLoading ? (
                  <p className="text-muted-foreground text-sm">Loading…</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Organisation</th>
                          <th className="pb-2 pr-4 font-medium text-right">Officers</th>
                          <th className="pb-2 pr-4 font-medium text-right">Scans</th>
                          <th className="pb-2 pr-4 font-medium text-right">Notices</th>
                          <th className="pb-2 pr-4 font-medium text-right">Infringements</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(orgUsage ?? []).map(org => (
                          <tr key={org.organization_id} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{org.organization_name}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{org.officer_count}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{org.scan_count.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{org.notice_count}</td>
                            <td className="py-2 text-right tabular-nums">{org.infringement_count}</td>
                          </tr>
                        ))}
                      </tbody>
                      {(orgUsage ?? []).length > 0 && (
                        <tfoot>
                          <tr className="border-t font-semibold">
                            <td className="pt-2 pr-4">Totals</td>
                            <td className="pt-2 pr-4 text-right tabular-nums">
                              {orgUsage!.reduce((s, o) => s + o.officer_count, 0)}
                            </td>
                            <td className="pt-2 pr-4 text-right tabular-nums">
                              {orgUsage!.reduce((s, o) => s + o.scan_count, 0).toLocaleString()}
                            </td>
                            <td className="pt-2 pr-4 text-right tabular-nums">
                              {orgUsage!.reduce((s, o) => s + o.notice_count, 0)}
                            </td>
                            <td className="pt-2 text-right tabular-nums">
                              {orgUsage!.reduce((s, o) => s + o.infringement_count, 0)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Feedback & Issues tab ──────────────────────────────────────── */}
          <TabsContent value="feedback" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Feedback Inbox</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bug reports, feature requests and performance issues from all users. Use AI to diagnose and generate fix suggestions.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['platform-feedback'] })}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
              </Button>
            </div>

            {feedbackLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading reports…
              </div>
            ) : (feedbackReports ?? []).length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                  No feedback reports yet. Users can submit via the Feedback button on any page.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {(feedbackReports ?? []).map(report => (
                  <FeedbackReportCard
                    key={report.id}
                    report={report}
                    expanded={expandedId === report.id}
                    onToggle={() => setExpandedId(expandedId === report.id ? null : report.id)}
                    analyzing={analyzingId === report.id}
                    onAnalyse={() => analyseWithAI(report)}
                    onStatusChange={(s) => updateStatus(report.id, s)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

        </Tabs>

      </div>
    </AppLayout>
  )
}

// ─── KPI Card Helper ──────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub: string
  loading?: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">
              {loading ? <span className="text-muted-foreground text-base">…</span> : value}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
          </div>
          <div className="mt-1">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Feedback Report Card ─────────────────────────────────────────────────────

const ISSUE_ICON: Record<string, React.ReactNode> = {
  bug:             <Bug className="h-4 w-4 text-red-500" />,
  feature_request: <Lightbulb className="h-4 w-4 text-blue-500" />,
  performance:     <Zap className="h-4 w-4 text-orange-500" />,
}

const STATUS_BADGE: Record<string, string> = {
  open:        'bg-red-100 text-red-700 dark:bg-red-900/30',
  in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30',
  resolved:    'bg-green-100 text-green-700 dark:bg-green-900/30',
  closed:      'bg-gray-100 text-gray-500',
}

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-200 text-red-800',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-yellow-100 text-yellow-700',
  low:      'bg-gray-100 text-gray-600',
}

function renderAiMarkdown(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    if (/^#{1,3} /.test(line)) {
      return <p key={i} className="font-semibold text-sm mt-3 mb-1">{line.replace(/^#{1,3} /, '')}</p>
    }
    if (/^[-*] /.test(line)) {
      return <li key={i} className="ml-4 text-xs list-disc">{line.replace(/^[-*] /, '')}</li>
    }
    if (/^\d+\. /.test(line)) {
      return <li key={i} className="ml-4 text-xs list-decimal">{line.replace(/^\d+\. /, '')}</li>
    }
    if (line.trim() === '') return <div key={i} className="h-1.5" />
    return <p key={i} className="text-xs">{line}</p>
  })
}

function FeedbackReportCard({
  report,
  expanded,
  onToggle,
  analyzing,
  onAnalyse,
  onStatusChange,
}: {
  report: FeedbackReport
  expanded: boolean
  onToggle: () => void
  analyzing: boolean
  onAnalyse: () => void
  onStatusChange: (status: string) => void
}) {
  const navHistory: any[] = report.browser_info?.navigationHistory ?? []
  const consoleErrors: any[] = Array.isArray(report.console_errors) ? report.console_errors.filter((e: any) => e.level === 'error' || e.level === 'unhandled') : []

  return (
    <Card className={`overflow-hidden transition-shadow ${expanded ? 'shadow-md' : 'shadow-sm'}`}>
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={onToggle}
      >
        <div className="mt-0.5 shrink-0">{ISSUE_ICON[report.issue_type] ?? <Bug className="h-4 w-4 text-gray-400" />}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{report.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[report.status ?? 'open'] ?? STATUS_BADGE.open}`}>
              {(report.status ?? 'open').replace('_', ' ')}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEV_BADGE[report.severity] ?? SEV_BADGE.low}`}>
              {report.severity}
            </span>
            {report.ai_analyzed && (
              <span className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 font-medium">
                <Sparkles className="h-3 w-3" /> AI analysed
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><MonitorDot className="h-3 w-3" />{report.current_page ?? '/'}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(report.created_at).toLocaleString('en-NZ')}</span>
            <span className="uppercase opacity-70">{report.user_role}</span>
          </div>
        </div>
        <div className="shrink-0 mt-1">
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t dark:border-gray-700 px-4 pb-4 pt-3 space-y-4">

          {/* Description */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
            <p className="text-sm">{report.description}</p>
          </div>

          {/* Bug-specific fields */}
          {(report.steps_to_reproduce || report.expected_behavior || report.actual_behavior) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {report.steps_to_reproduce && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Steps to reproduce</p>
                  <p className="text-xs whitespace-pre-wrap">{report.steps_to_reproduce}</p>
                </div>
              )}
              {report.expected_behavior && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Expected</p>
                  <p className="text-xs">{report.expected_behavior}</p>
                </div>
              )}
              {report.actual_behavior && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Actual</p>
                  <p className="text-xs">{report.actual_behavior}</p>
                </div>
              )}
            </div>
          )}

          {/* Context: nav + errors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {navHistory.length > 0 && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
                  <Navigation className="h-3 w-3" /> Navigation path
                </p>
                <div className="space-y-0.5">
                  {navHistory.slice(-8).reverse().map((n: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`text-xs font-mono truncate ${i === 0 ? 'text-violet-600 font-semibold' : 'text-muted-foreground'}`}>{n.path}</span>
                      <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                        {new Date(n.timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {consoleErrors.length > 0 && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                <p className="text-xs font-medium text-red-600 flex items-center gap-1 mb-2">
                  <AlertTriangle className="h-3 w-3" /> Console errors ({consoleErrors.length})
                </p>
                <ScrollArea className="max-h-28">
                  {consoleErrors.slice(-5).map((e: any, i: number) => (
                    <div key={i} className="text-[10px] font-mono text-red-700 dark:text-red-300 break-all mb-1">
                      {e.message.slice(0, 200)}
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}
          </div>

          {/* AI analysis section */}
          {report.ai_suggested_fix ? (
            <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-violet-200 dark:border-violet-800">
                <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">AI Diagnosis & Fix Suggestion</span>
                {report.ai_analysis?.provider && (
                  <span className="text-[10px] bg-violet-100 dark:bg-violet-800/50 text-violet-600 dark:text-violet-300 rounded px-1.5 py-0.5 font-medium">
                    {report.ai_analysis.provider === 'github-copilot' ? '⚡ GitHub Copilot' : report.ai_analysis.provider}
                  </span>
                )}
                {report.ai_analysis?.analyzed_at && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(report.ai_analysis.analyzed_at).toLocaleString('en-NZ')}
                  </span>
                )}
              </div>
              <ScrollArea className="max-h-96">
                <div className="px-3 py-2 space-y-0.5">
                  {renderAiMarkdown(report.ai_suggested_fix)}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/10 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-violet-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium">No AI analysis yet</p>
                  <p className="text-[11px] text-muted-foreground">Click Analyse to get a diagnosis and code-level fix suggestion.</p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={onAnalyse}
                disabled={analyzing}
                className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5 shrink-0"
              >
                {analyzing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing…</> : <><Sparkles className="h-3.5 w-3.5" /> Analyse</>}
              </Button>
            </div>
          )}

          {/* Re-analyse + status controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {report.ai_suggested_fix && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAnalyse}
                disabled={analyzing}
                className="gap-1.5 text-violet-600 border-violet-300 hover:bg-violet-50"
              >
                {analyzing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Re-analysing…</> : <><Sparkles className="h-3.5 w-3.5" /> Re-analyse</>}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              {(['open', 'in_progress', 'resolved', 'closed'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => onStatusChange(s)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                    (report.status ?? 'open') === s
                      ? STATUS_BADGE[s] + ' border-current'
                      : 'border-gray-200 dark:border-gray-700 text-muted-foreground hover:border-gray-300'
                  }`}
                >
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

        </div>
      )}
    </Card>
  )
}
