import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppLayout } from '@/components/features/AppLayout'
import {
  Building2, Users, Scan, AlertTriangle, FileText, TrendingUp, Shield,
  Activity, Globe, DollarSign,
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Platform() {
  const { user } = useAuthStore()
  const [periodDays, setPeriodDays] = useState(30)

  // Redirect non-grand-master users away
  if (user?.role !== 'grand_master') {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Access restricted to platform administrators.
        </div>
      </AppLayout>
    )
  }

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
  })

  const complianceRate = stats && stats.scans_in_period > 0
    ? Math.round(((stats.scans_in_period - stats.breaches_in_period) / stats.scans_in_period) * 100)
    : null

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
