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
import { formatDateTime, formatDate } from '@/lib/utils'
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
  detected_at: string
  zone: { name: string }
}

interface EnforcementAction {
  id: string
  breach_alert_id: string
  action_type: string
  status: string
  assigned_to: string | null
  created_at: string
  breach_alert: {
    plate_number: string
    zone: { name: string }
  }
  user_profile?: { full_name: string }
}

interface ActivePatrol {
  id: string
  status: string
  started_at: string
  zone: { name: string }
  officer: { 
    first_name: string
    last_name: string
  }
  vehicles_checked: number
}

export default function EnforcementCommandCenter() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [selectedView, setSelectedView] = useState<'all' | 'urgent' | 'pending'>('all')
  const effectiveOrganizationId =
    user?.role !== 'master' ? user?.organization_id || null : organizationId || null
  const startDate = dateFrom ? `${dateFrom}T00:00:00Z` : null
  const endDate = dateTo ? `${dateTo}T23:59:59Z` : null

  // Fetch enforcement stats
  const { data: stats } = useQuery({
    queryKey: ['enforcement-stats', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      
      // Active breaches
      let breachQuery = supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'notified'])

      if (effectiveOrganizationId) {
        breachQuery = breachQuery.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        breachQuery = breachQuery.eq('zone_id', zoneId)
      }
      if (startDate) {
        breachQuery = breachQuery.gte('detected_at', startDate)
      }
      if (endDate) {
        breachQuery = breachQuery.lte('detected_at', endDate)
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
        patrolQuery = patrolQuery.gte('started_at', startDate)
      }
      if (endDate) {
        patrolQuery = patrolQuery.lte('started_at', endDate)
      }

      // Notices issued today
      let noticeQuery = supabase
        .from('enforcement_actions')
        .select('*', { count: 'exact', head: true })
        .eq('action_type', 'notice_to_vacate')
        .gte('created_at', today)

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

      const [breachResult, patrolResult, noticeResult, pendingResult] = await Promise.all([
        breachQuery,
        patrolQuery,
        noticeQuery,
        pendingActionQuery,
      ])

      return {
        active_breaches: breachResult.count || 0,
        pending_actions: pendingResult.count || 0,
        active_patrols: patrolResult.count || 0,
        officers_on_duty: patrolResult.count || 0, // Simplified
        notices_issued_today: noticeResult.count || 0,
        resolutions_today: 0, // TODO: Calculate from breach_alerts.resolved_at
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
          severity,
          detected_at,
          zone:zones(name)
        `)
        .in('status', ['pending', 'notified'])
        .order('detected_at', { ascending: false })
        .limit(20)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }
      if (startDate) {
        query = query.gte('detected_at', startDate)
      }
      if (endDate) {
        query = query.lte('detected_at', endDate)
      }

      if (selectedView === 'urgent') {
        query = query.in('severity', ['critical', 'high'])
      } else if (selectedView === 'pending') {
        query = query.eq('status', 'pending')
      }

      const { data, error } = await query

      if (error) throw error
      return data as ActiveBreach[]
    },
    refetchInterval: 30000,
  })

  // Fetch enforcement actions
  const { data: actions } = useQuery({
    queryKey: ['enforcement-actions', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      
      let query = supabase
        .from('enforcement_actions')
        .select(`
          id,
          breach_alert_id,
          action_type,
          status,
          assigned_to,
          created_at,
          breach_alert:breach_alerts(
            plate_number,
            zone:zones(name)
          ),
          user_profile:user_profiles(first_name, last_name)
        `)
        .gte('created_at', startDate || `${today}T00:00:00Z`)
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
          started_at,
          vehicles_checked,
          zone:zones(name),
          officer:user_profiles(first_name, last_name)
        `)
        .eq('status', 'in_progress')
        .order('started_at', { ascending: false })

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
      title="Enforcement Command Center" 
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
                      className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono font-bold text-lg">
                              {breach.plate_number}
                            </span>
                            <Badge className={getSeverityColor(breach.severity)}>
                              {breach.severity}
                            </Badge>
                            <Badge variant="outline">{breach.status}</Badge>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {breach.zone.name} • {getBreachTypeLabel(breach.breach_type)}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(breach.detected_at)}
                        </span>
                      </div>
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
                          {patrol.officer.first_name} {patrol.officer.last_name}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {patrol.zone.name}
                      </p>
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <span className="text-gray-500">
                          {patrol.vehicles_checked || 0} vehicles
                        </span>
                        <span className="text-gray-500">
                          {formatDateTime(patrol.started_at)}
                        </span>
                      </div>
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
                      className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {getActionTypeLabel(action.action_type)}
                        </Badge>
                      </div>
                      <p className="text-sm font-mono">
                        {action.breach_alert?.plate_number || 'Unknown'}
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
