/**
 * PatrolKPIDashboard — Admin dashboard showing patrol performance KPIs,
 * officer statistics, compliance metrics, and billing-relevant data.
 *
 * Uses the get_patrol_kpis() RPC for aggregated metrics.
 */

import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { usePatrolKPIs } from '@/hooks/usePatrols'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  BarChart3,
  Clock,
  Users,
  Car,
  AlertTriangle,
  MapPin,
  CheckCircle,
  TrendingUp,
  Timer,
  CalendarDays,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PatrolKPIDashboard() {
  const { user } = useAuthStore()

  // Date range (default last 30 days)
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0])

  const { data: kpis, isLoading } = usePatrolKPIs({
    from: `${fromDate}T00:00:00`,
    to: `${toDate}T23:59:59`,
  })

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Patrol KPIs & Statistics"
      description="Field officer performance, patrol duration, compliance, and billing metrics"
    >
      <div className="space-y-6">
        {/* Date range filter */}
        <div className="flex items-end gap-4 flex-wrap">
          <div className="grid gap-1.5">
            <Label>From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </div>

        {isLoading && (
          <p className="text-muted-foreground py-8 text-center">Loading KPI data…</p>
        )}

        {kpis && (
          <>
            {/* ── Overview KPI cards ─── */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <KPICard
                icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
                label="Total Patrols"
                value={kpis.total_patrols}
              />
              <KPICard
                icon={<CheckCircle className="h-5 w-5 text-green-600" />}
                label="Completion Rate"
                value={`${kpis.completion_rate}%`}
                sub={`${kpis.completed} of ${kpis.total_patrols}`}
              />
              <KPICard
                icon={<Timer className="h-5 w-5 text-purple-600" />}
                label="Avg Duration"
                value={`${kpis.avg_duration_minutes} min`}
              />
              <KPICard
                icon={<TrendingUp className="h-5 w-5 text-teal-600" />}
                label="Punctuality"
                value={`${kpis.punctuality_rate}%`}
                sub={`${kpis.on_time_starts} on time, ${kpis.late_starts} late`}
              />
              <KPICard
                icon={<Clock className="h-5 w-5 text-indigo-600" />}
                label="Total Shift Hours"
                value={`${kpis.total_shift_hours} h`}
              />
            </div>

            {/* ── Activity KPI cards ─── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KPICard
                icon={<Car className="h-5 w-5 text-orange-600" />}
                label="Vehicles Checked"
                value={kpis.total_vehicles_checked}
              />
              <KPICard
                icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
                label="Breaches Found"
                value={kpis.total_breaches_found}
              />
              <KPICard
                icon={<MapPin className="h-5 w-5 text-green-600" />}
                label="Site Visits"
                value={kpis.total_site_visits}
              />
              <KPICard
                icon={<CalendarDays className="h-5 w-5 text-blue-600" />}
                label="Avg Site Visit"
                value={`${kpis.avg_site_visit_minutes} min`}
              />
            </div>

            {/* ── Status breakdown ─── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Patrol Status Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatusBlock label="Scheduled" count={kpis.scheduled} color="text-blue-600" />
                  <StatusBlock label="In Progress" count={kpis.in_progress} color="text-orange-600" />
                  <StatusBlock label="Completed" count={kpis.completed} color="text-green-600" />
                  <StatusBlock label="Cancelled" count={kpis.cancelled} color="text-gray-500" />
                </div>
              </CardContent>
            </Card>

            {/* ── Officer Performance Table ─── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Officer Performance
                </CardTitle>
                <CardDescription>
                  Individual officer KPIs for compliance reporting and billing
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Officer</TableHead>
                      <TableHead className="text-right">Patrols</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Avg Duration</TableHead>
                      <TableHead className="text-right">Shift Hours</TableHead>
                      <TableHead className="text-right">Vehicles</TableHead>
                      <TableHead className="text-right">Breaches</TableHead>
                      <TableHead className="text-right">Site Visits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!kpis.officers || kpis.officers.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                          No officer data available for this period
                        </TableCell>
                      </TableRow>
                    )}
                    {(kpis.officers ?? []).map((officer: any) => (
                      <TableRow key={officer.officer_id}>
                        <TableCell className="font-medium">{officer.officer_name}</TableCell>
                        <TableCell className="text-right">{officer.total_patrols}</TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={officer.completed_patrols === officer.total_patrols && officer.total_patrols > 0
                              ? 'text-green-700 border-green-300'
                              : 'text-yellow-700 border-yellow-300'
                            }
                          >
                            {officer.completed_patrols}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(officer.avg_duration_minutes).toFixed(0)} min
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(officer.shift_hours).toFixed(1)} h
                        </TableCell>
                        <TableCell className="text-right">{officer.vehicles_checked}</TableCell>
                        <TableCell className="text-right">{officer.breaches_found}</TableCell>
                        <TableCell className="text-right">{officer.site_visits}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function KPICard({ icon, label, value, sub }: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg shrink-0">
            {icon}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBlock({ label, count, color }: {
  label: string
  count: number
  color: string
}) {
  return (
    <div className="text-center">
      <p className={`text-3xl font-bold ${color}`}>{count}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
