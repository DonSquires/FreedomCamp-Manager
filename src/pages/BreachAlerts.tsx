import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  XCircle, 
  Search,
  Bell,
  FileText,
  Database,
  RefreshCw,
  ShieldAlert,
  UserX,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { enrichVehicleFromMotorWeb } from '@/lib/railwayServices'

interface BreachAlert {
  id: string
  organization_id: string
  zone_id: string
  plate_number: string
  breach_type: string
  status: string
  detected_at: string
  zone: { name: string }
  organization: { name: string }
}

export default function BreachAlerts() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [enrichingVehicle, setEnrichingVehicle] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // ── Intelligence Alerts: flagged vehicles in restricted zones ──────────────
  const { data: intelligenceAlerts } = useQuery({
    queryKey: ['intelligence-alerts', organizationId, zoneId],
    queryFn: async () => {
      let q = supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, detected_at, status, zones!zone_id(name)')
        .eq('breach_type', 'unauthorized_zone')
        .eq('status', 'pending')
        .order('detected_at', { ascending: false })
        .limit(10)

      if (user?.role !== 'master' && user?.organization_id) {
        q = q.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        q = q.eq('organization_id', organizationId)
      }
      if (zoneId) q = q.eq('zone_id', zoneId)

      const { data } = await q
      return data || []
    },
  })

  // ── Safety Alerts: officer unexpected departures (welfare inactivity) ──────
  const { data: safetyAlerts } = useQuery({
    queryKey: ['safety-alerts', organizationId],
    queryFn: async () => {
      let q = supabase
        .from('officer_welfare_alerts')
        .select('id, officer_name, alert_type, status, created_at, gps_latitude, gps_longitude')
        .in('alert_type', ['inactivity', 'gps_lost'])
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10)

      if (user?.role !== 'master' && user?.organization_id) {
        q = q.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        q = q.eq('organization_id', organizationId)
      }

      const { data } = await q
      return data || []
    },
  })

  // Fetch breach alerts
  const { data: breaches, isLoading } = useQuery({
    queryKey: ['breach-alerts', organizationId, zoneId, statusFilter, searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          *,
          zones!zone_id(name),
          organizations!organization_id(name)
        `)
        .order('detected_at', { ascending: false })

      // CRITICAL: Add organization filter
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (dateFrom) {
        query = query.gte('detected_at', dateFrom)
      }

      if (dateTo) {
        query = query.lte('detected_at', dateTo)
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (searchQuery) {
        query = query.ilike('plate_number', `%${searchQuery}%`)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error
      return data as BreachAlert[]
    },
  })

  // Resolve breach mutation
  const resolveMutation = useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await supabase
        .from('breach_alerts')
        .update({ 
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id 
        })
        .eq('id', breachId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Breach marked as resolved')
    },
    onError: () => {
      toast.error('Failed to resolve breach')
    },
  })

  // Notify mutation
  const notifyMutation = useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await supabase
        .from('breach_alerts')
        .update({ 
          status: 'notified',
          notified_at: new Date().toISOString(),
          notified_by: user?.id
        })
        .eq('id', breachId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Notification sent')
    },
    onError: () => {
      toast.error('Failed to send notification')
    },
  })

  // Calculate stats
  const stats = breaches ? {
    total: breaches.length,
    pending: breaches.filter(b => b.status === 'pending').length,
    notified: breaches.filter(b => b.status === 'notified').length,
    resolved: breaches.filter(b => b.status === 'resolved').length,
  } : null

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4" />
      case 'notified':
        return <Bell className="h-4 w-4" />
      case 'resolved':
        return <CheckCircle className="h-4 w-4" />
      default:
        return <XCircle className="h-4 w-4" />
    }
  }

  const getBreachTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      overstay: 'Overstay',
      no_self_contained: 'No Self-Contained',
      consecutive_days: 'Consecutive Days',
      unauthorized_zone: 'Unauthorized Zone',
      nights_exceeded: 'Nights Exceeded',
    }
    return labels[type] || type
  }

  // Railway Integration: Enrich vehicle from MotorWeb
  const handleEnrichVehicle = async (plateNumber: string) => {
    setEnrichingVehicle(plateNumber)
    try {
      const { data, error } = await enrichVehicleFromMotorWeb(plateNumber)
      
      if (error) {
        toast.error(error)
        return
      }

      if (data) {
        // Update vehicle in database
        const { error: updateError } = await supabase
          .from('canonical_vehicles')
          .update({
            make: data.make,
            model: data.model,
            year: data.year,
            colour: data.colour,
            body_style: data.body_style,
            owner_first_name: data.owner_name?.split(' ')[0],
            owner_last_name: data.owner_name?.split(' ').slice(1).join(' '),
            owner_address: data.owner_address,
          })
          .eq('plate_number', plateNumber)

        if (updateError) {
          toast.error('Failed to update vehicle data')
          return
        }

        toast.success('Vehicle data enriched from MotorWeb')
        queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to enrich from MotorWeb')
    } finally {
      setEnrichingVehicle(null)
    }
  }

  return (
    <AppLayout title="Breach Alerts" description="Manage compliance breaches and enforcement actions" showBackButton>
      <GlobalFilterRibbon />

      {/* ── Intelligence & Safety Alert Banners ──────────────────────────── */}
      {intelligenceAlerts && intelligenceAlerts.length > 0 && (
        <Card className="border-red-400 bg-red-50 dark:bg-red-950/30 mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400 text-base">
              <Zap className="h-5 w-5" />
              Intelligence Alert – Flagged Vehicle in Restricted Zone ({intelligenceAlerts.length})
            </CardTitle>
            <CardDescription className="text-red-600 dark:text-red-400">
              The following vehicles were detected entering a restricted zone and require immediate attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {intelligenceAlerts.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    <span className="font-bold">{a.plate_number}</span>
                    <span className="text-gray-600">in</span>
                    <span className="font-medium">{a.zones?.name || 'Unknown Zone'}</span>
                  </div>
                  <span className="text-gray-400 text-xs">{formatDateTime(a.detected_at)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {safetyAlerts && safetyAlerts.length > 0 && (
        <Card className="border-orange-400 bg-orange-50 dark:bg-orange-950/30 mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400 text-base">
              <UserX className="h-5 w-5" />
              Safety Alert – Officer Unexpected Departure / Inactivity ({safetyAlerts.length})
            </CardTitle>
            <CardDescription className="text-orange-600 dark:text-orange-400">
              The following officers have triggered a welfare alert due to inactivity or GPS loss (HSWA 2015 – Primary Duty of Care).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {safetyAlerts.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-600" />
                    <span className="font-bold">{a.officer_name}</span>
                    <Badge variant="outline" className="capitalize text-xs">
                      {a.alert_type?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <span className="text-gray-400 text-xs">{formatDateTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600">Notified</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.notified}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600">Resolved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by plate number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                size="sm"
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'pending' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('pending')}
                size="sm"
              >
                Pending
              </Button>
              <Button
                variant={statusFilter === 'notified' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('notified')}
                size="sm"
              >
                Notified
              </Button>
              <Button
                variant={statusFilter === 'resolved' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('resolved')}
                size="sm"
              >
                Resolved
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breach Alerts List */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading breaches...</p>
        </div>
      ) : breaches && breaches.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
            <p className="text-gray-600">No breach alerts found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {breaches?.map((breach) => (
            <Card key={breach.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <CardTitle className="text-xl font-bold">
                        {breach.plate_number}
                      </CardTitle>
                      <Badge variant="outline">
                        {getStatusIcon(breach.status)}
                        <span className="ml-1">{breach.status}</span>
                      </Badge>
                    </div>
                    <CardDescription>
                      {(breach.zones as any)?.name || 'Unknown Zone'} • {(breach.organizations as any)?.name || 'Unknown Org'}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {getBreachTypeLabel(breach.breach_type)}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          Detected: {formatDateTime(breach.detected_at)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Railway Integration: MotorWeb Enrichment Button */}
                  <div className="mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEnrichVehicle(breach.plate_number)}
                      disabled={enrichingVehicle === breach.plate_number}
                      className="w-full"
                    >
                      {enrichingVehicle === breach.plate_number ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Enriching from MotorWeb...
                        </>
                      ) : (
                        <>
                          <Database className="h-4 w-4 mr-2" />
                          Enrich Vehicle Data (MotorWeb)
                        </>
                      )}
                    </Button>
                    <div className="text-xs text-gray-600 mt-1 text-center">
                      Pull owner details and vehicle specs
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {breach.status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => notifyMutation.mutate(breach.id)}
                          disabled={notifyMutation.isPending}
                        >
                          <Bell className="h-4 w-4 mr-1" />
                          Send Notice
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resolveMutation.mutate(breach.id)}
                          disabled={resolveMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Resolve
                        </Button>
                      </>
                    )}
                    {breach.status === 'notified' && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => resolveMutation.mutate(breach.id)}
                        disabled={resolveMutation.isPending}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Mark Resolved
                      </Button>
                    )}
                    <Button variant="outline" size="sm">
                      <FileText className="h-4 w-4 mr-1" />
                      View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
