import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  AlertTriangle, 
  Bell, 
  CheckCircle, 
  Clock, 
  MapPin, 
  Shield, 
  TrendingUp,
  Users,
  Car,
  Activity,
  FileText,
  Eye,
  MoreHorizontal
} from 'lucide-react'
import { ListCardRow } from '@/components/features/ListCardRow'
import { formatDateTime, formatDate } from '@/lib/utils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { toast } from 'sonner'

interface EnforcementStats {
  active_breaches: number
  pending_actions: number
  active_patrols: number
  officers_on_duty: number
  notices_issued_today: number
  resolutions_today: number
}

interface ActiveBreach {
  id: string
  plate_number: string
  breach_type: string
  status: string
  severity: string
  created_at: string
  zone: { name: string }
}

interface EnforcementAction {
  id: string
  action_type: string
  status: string
  assigned_to: string | null
  created_at: string
  plate_number: string | null
  zone: { name: string } | null
  user_profile?: { first_name: string; last_name: string } | null
}

interface ActivePatrol {
  id: string
  status: string
  created_at: string
  zone: { name: string }
  officer: { 
    first_name: string
    last_name: string
  }
}

function deriveSeverityFromBreachType(breachType: string): 'critical' | 'high' | 'medium' {
  const bt = String(breachType || '').toLowerCase()
  if (bt.includes('tow') || bt.includes('danger')) return 'critical'
  // Match canonical breach type values from the compliance engine
  if (
    bt === 'consecutive_nights' ||
    bt === 'monthly_limit' ||
    bt.includes('consecutive')
  ) return 'high'
  return 'medium'
}

export default function EnforcementCommandCenter() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [selectedView, setSelectedView] = useState<'all' | 'urgent' | 'pending'>('all')
  const effectiveOrganizationId =
    user?.role !== 'master' ? user?.organization_id || null : organizationId || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const todayNz = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const todayStart = nzDateToUTCStart(todayNz)

  // Fetch enforcement stats
  const { data: stats } = useQuery({
    queryKey: ['enforcement-stats', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      // Active breaches
      let breachQuery = supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])

      if (effectiveOrganizationId) {
        breachQuery = breachQuery.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        breachQuery = breachQuery.eq('zone_id', zoneId)
      }
      if (startDate) {
        breachQuery = breachQuery.gte('created_at', startDate)
      }
      if (endDate) {
        breachQuery = breachQuery.lte('created_at', endDate)
      }

      // Active patrols
      let patrolQuery = supabase
        .from('patrols')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'in_progress')

      if (effectiveOrganizationId) {
        patrolQuery = patrolQuery.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        patrolQuery = patrolQuery.eq('zone_id', zoneId)
      }
      if (startDate) {
        patrolQuery = patrolQuery.gte('created_at', startDate)
      }
      if (endDate) {
        patrolQuery = patrolQuery.lte('created_at', endDate)
      }

      // Notices issued today
      let noticeQuery = supabase
        .from('enforcement_actions')
        .select('*', { count: 'exact', head: true })
        .eq('action_type', 'notice_to_vacate')
        .gte('created_at', todayStart)

      // Pending actions
      let pendingActionQuery = supabase
        .from('enforcement_actions')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'assigned'])

      if (effectiveOrganizationId) {
        noticeQuery = noticeQuery.eq('organization_id', effectiveOrganizationId)
        pendingActionQuery = pendingActionQuery.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        noticeQuery = noticeQuery.eq('zone_id', zoneId)
        pendingActionQuery = pendingActionQuery.eq('zone_id', zoneId)
      }
      if (startDate) {
        noticeQuery = noticeQuery.gte('created_at', startDate)
        pendingActionQuery = pendingActionQuery.gte('created_at', startDate)
      }
      if (endDate) {
        noticeQuery = noticeQuery.lte('created_at', endDate)
        pendingActionQuery = pendingActionQuery.lte('created_at', endDate)
      }

      // Resolutions today: breach_alerts resolved since start of today
      let resolutionsQuery = supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'resolved')
        .gte('resolved_at', todayStart)

      if (effectiveOrganizationId) {
        resolutionsQuery = resolutionsQuery.eq('organization_id', effectiveOrganizationId)
      }

      const [breachResult, patrolResult, noticeResult, pendingResult, resolutionResult] = await Promise.all([
        breachQuery,
        patrolQuery,
        noticeQuery,
        pendingActionQuery,
        resolutionsQuery,
      ])

      return {
        active_breaches: breachResult.count || 0,
        pending_actions: pendingResult.count || 0,
        active_patrols: patrolResult.count || 0,
        officers_on_duty: patrolResult.count || 0, // Simplified
        notices_issued_today: noticeResult.count || 0,
        resolutions_today: resolutionResult.count || 0,
      } as EnforcementStats
    },
    refetchInterval: 30000, // Refresh every 30s
  })

  // Fetch active breaches
  const { data: breaches, isLoading: breachesLoading } = useQuery({
    queryKey: ['active-breaches', effectiveOrganizationId, zoneId, dateFrom, dateTo, selectedView],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          id,
          plate_number,
          breach_type,
          status,
          created_at,
          zone:zones(name)
        `)
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])
        .order('created_at', { ascending: false })
        .limit(20)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }
      if (startDate) {
        query = query.gte('created_at', startDate)
      }
      if (endDate) {
        query = query.lte('created_at', endDate)
      }

      if (selectedView === 'pending') {
        query = query.eq('status', 'pending')
      }

      const { data, error } = await query

      if (error) throw error
      const rows = (data || []).map((breach: any) => ({
        ...breach,
        severity: deriveSeverityFromBreachType(breach.breach_type),
      })) as ActiveBreach[]

      if (selectedView === 'urgent') {
        return rows.filter((b) => ['critical', 'high'].includes(b.severity))
      }

      return rows
    },
    refetchInterval: 30000,
  })

  // Fetch enforcement actions
  const { data: actions } = useQuery({
    queryKey: ['enforcement-actions', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('enforcement_actions')
        .select(`
          id,
          action_type,
          status,
          assigned_to,
          created_at,
          plate_number,
          zone:zones(name),
          user_profile:user_profiles!enforcement_actions_created_by_fkey(first_name, last_name)
        `)
        .gte('created_at', startDate || todayStart)
        .order('created_at', { ascending: false })
        .limit(10)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }
      if (endDate) {
        query = query.lte('created_at', endDate)
      }

      const { data, error } = await query
      if (error) throw error
      
      return data.map((action: any) => ({
        ...action,
        user_profile: action.user_profile ? {
          full_name: `${action.user_profile.first_name} ${action.user_profile.last_name}`
        } : undefined
      })) as EnforcementAction[]
    },
    refetchInterval: 30000,
  })

  // Fetch active patrols
  const { data: patrols } = useQuery({
    queryKey: ['active-patrols', organizationId, zoneId],
    queryFn: async () => {
      let query = supabase
        .from('patrols')
        .select(`
          id,
          status,
          created_at,
          zone:zones(name),
          officer:user_profiles!patrols_assigned_to_fkey(first_name, last_name)
        `)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false })

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      const { data, error } = await query
      if (error) throw error
      return data as ActivePatrol[]
    },
    refetchInterval: 15000, // More frequent for live tracking
  })

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white'
      case 'high': return 'bg-orange-600 text-white'
      case 'medium': return 'bg-yellow-600 text-white'
      default: return 'bg-blue-600 text-white'
    }
  }

  const getBreachTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      overstay: 'Overstay',
      no_self_contained: 'No Self-Contained',
      consecutive_days: 'Consecutive Days',
      unauthorized_zone: 'Unauthorized',
      nights_exceeded: 'Nights Exceeded',
    }
    return labels[type] || type
  }

  const getActionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      warning: 'Warning',
      notice_to_vacate: 'Notice to Vacate',
      tow: 'Tow Request',
      referral: 'Referral',
    }
    return labels[type] || type
  }

  return (
    <AppLayout 
      title="Enforcement Command Centre" 
      description="Real-time enforcement monitoring and action management"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Active Breaches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">
              {stats?.active_breaches || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-orange-600 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">
              {stats?.pending_actions || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Active Patrols
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {stats?.active_patrols || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Officers On Duty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">
              {stats?.officers_on_duty || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-indigo-600 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notices Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-600">
              {stats?.notices_issued_today || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Resolved Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {stats?.resolutions_today || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Active Breaches - Takes 2 columns */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    Active Breaches
                  </CardTitle>
                  <CardDescription>Real-time breach monitoring</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={selectedView === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedView('all')}
                  >
                    All
                  </Button>
                  <Button
                    variant={selectedView === 'urgent' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedView('urgent')}
                  >
                    Urgent
                  </Button>
                  <Button
                    variant={selectedView === 'pending' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedView('pending')}
                  >
                    Pending
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {breachesLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                </div>
              ) : breaches && breaches.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {breaches.map((breach) => (
                    <div
                      key={breach.id}
                      className="p-4 bg-gray-50 dark:bg-[#1E1E1E] rounded-lg hover:shadow-md transition-shadow"
                    >
                      <ListCardRow
                        left={
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-lg">{breach.plate_number}</span>
                            <Badge className={getSeverityColor(breach.severity)}>{breach.severity}</Badge>
                            <Badge variant="outline">{breach.status}</Badge>
                          </div>
                        }
                        right={<Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>}
                        className="mb-1"
                      />
                      <ListCardRow
                        left={
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {breach.zone.name} • {getBreachTypeLabel(breach.breach_type)}
                          </span>
                        }
                        right={
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />{formatDateTime(breach.created_at)}
                          </span>
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-2" />
                  <p>No active breaches</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Active Patrols */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5" />
                Active Patrols
              </CardTitle>
            </CardHeader>
            <CardContent>
              {patrols && patrols.length > 0 ? (
                <div className="space-y-2">
                  {patrols.map((patrol) => (
                    <div
                      key={patrol.id}
                      className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-sm">
                          {patrol.officer?.first_name || 'Unassigned'} {patrol.officer?.last_name || ''}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {patrol.zone.name}
                      </p>
                      <ListCardRow
                        left={<span className="text-xs text-gray-500">In progress</span>}
                        right={<span className="text-xs text-gray-500">{formatDateTime(patrol.created_at)}</span>}
                        className="mt-2"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-sm text-gray-500 py-4">
                  No active patrols
                </p>
              )}
            </CardContent>
          </Card>

          {/* Recent Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="h-5 w-5" />
                Recent Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actions && actions.length > 0 ? (
                <div className="space-y-2">
                  {actions.slice(0, 5).map((action) => (
                    <div
                      key={action.id}
                      className="p-3 bg-gray-50 dark:bg-[#1E1E1E] rounded-lg"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {getActionTypeLabel(action.action_type)}
                        </Badge>
                      </div>
                      <p className="text-sm font-mono">
                        {action.plate_number || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDateTime(action.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-sm text-gray-500 py-4">
                  No recent actions
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
