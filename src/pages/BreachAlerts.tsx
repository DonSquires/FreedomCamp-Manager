import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  Eye,
  MapPin,
  Car,
  Calendar,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { enrichVehicleFromMotorWeb } from '@/lib/railwayServices'

// Schema-aligned BreachAlert type
// breach_alerts table columns (from 20260218_rebuild_breach_alerts_system.sql):
// - created_at (NOT detected_at)
// - status: pending | acknowledged | enforcement_started | resolved | dismissed
// - breach_type: consecutive_nights | monthly_limit | self_contained | after_hours | day_visit_violation | allowed_days_violation
// - NO resolved_by column (only resolved_at)
interface BreachAlert {
  id: string
  organization_id: string
  zone_id: string
  plate_number: string | null
  breach_type: string
  breach_details: any
  status: string
  created_at: string
  resolved_at: string | null
  notified_at: string | null
  notified_by: string | null
  due_date: string | null
  resolution_notes: string | null
  assigned_to: string | null
  assigned_at: string | null
  assigned_by: string | null
  admin_review_notes: string | null
}

export default function BreachAlerts() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [enrichingVehicle, setEnrichingVehicle] = useState<string | null>(null)
  const [selectedBreach, setSelectedBreach] = useState<any | null>(null)
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [resolveNotes, setResolveNotes] = useState('')
  const queryClient = useQueryClient()

  // ── Intelligence Alerts: flagged vehicles after hours / day-visit violations
  const { data: intelligenceAlerts } = useQuery({
    queryKey: ['intelligence-alerts', organizationId, zoneId],
    queryFn: async () => {
      let q = supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, created_at, status, zones!zone_id(name)')
        .in('breach_type', ['after_hours', 'day_visit_violation', 'allowed_days_violation'])
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
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

  // Fetch breach alerts (use created_at, not detected_at)
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
        .order('created_at', { ascending: false })

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) query = query.eq('zone_id', zoneId)
      if (dateFrom) query = query.gte('created_at', dateFrom)
      if (dateTo) query = query.lte('created_at', dateTo)
      if (statusFilter !== 'all') query = query.eq('status', statusFilter)
      if (searchQuery) query = query.ilike('plate_number', `%${searchQuery}%`)

      const { data, error } = await query.limit(100)
      if (error) throw error
      return data
    },
  })

  // Fetch enriched vehicle data when viewing details
  const { data: detailVehicle } = useQuery({
    queryKey: ['breach-vehicle', selectedBreach?.plate_number],
    queryFn: async () => {
      if (!selectedBreach?.plate_number) return null
      const { data } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', selectedBreach.plate_number)
        .single()
      return data
    },
    enabled: showDetailsDialog && !!selectedBreach?.plate_number,
  })

  // Acknowledge (was "notify") – correct status value per schema
  const acknowledgeMutation = useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await supabase
        .from('breach_alerts')
        .update({ 
          status: 'acknowledged',
          notified_at: new Date().toISOString(),
          notified_by: user?.id,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] })
      toast.success('Breach acknowledged')
    },
    onError: () => toast.error('Failed to acknowledge breach'),
  })

  // Mark as enforcement started
  const enforcementMutation = useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await supabase
        .from('breach_alerts')
        .update({ status: 'enforcement_started', assigned_by: user?.id, assigned_at: new Date().toISOString() })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Enforcement started')
    },
    onError: () => toast.error('Failed to start enforcement'),
  })

  // Resolve breach – schema has no resolved_by column
  const resolveMutation = useMutation({
    mutationFn: async ({ breachId, notes }: { breachId: string; notes: string }) => {
      const { error } = await supabase
        .from('breach_alerts')
        .update({ 
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution_notes: notes || null,
        })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['intelligence-alerts'] })
      setShowDetailsDialog(false)
      setResolveNotes('')
      toast.success('Breach marked as resolved')
    },
    onError: () => toast.error('Failed to resolve breach'),
  })

  // Dismiss breach
  const dismissMutation = useMutation({
    mutationFn: async (breachId: string) => {
      const { error } = await supabase
        .from('breach_alerts')
        .update({ status: 'dismissed' })
        .eq('id', breachId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach-alerts'] })
      toast.success('Breach dismissed')
    },
    onError: () => toast.error('Failed to dismiss breach'),
  })

  // Welfare alert acknowledgement
  const acknowledgeWelfareMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from('officer_welfare_alerts')
        .update({ status: 'acknowledged', acknowledged_by: user?.id, acknowledged_at: new Date().toISOString() })
        .eq('id', alertId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safety-alerts'] })
      toast.success('Welfare alert acknowledged')
    },
    onError: () => toast.error('Failed to acknowledge welfare alert'),
  })

  // MotorWeb enrichment
  const handleEnrichVehicle = async (plateNumber: string) => {
    if (!plateNumber) return
    setEnrichingVehicle(plateNumber)
    try {
      const { data, error } = await enrichVehicleFromMotorWeb(plateNumber)
      if (error) {
        toast.error(error)
        return
      }
      if (data) {
        const { error: updateError } = await supabase
          .from('canonical_vehicles')
          .update({
            make: data.make,
            model: data.model,
            year: data.year,
            colour: data.colour,
            body_style: data.body_style,
            owner_first_name: data.owner_name?.split(' ')[0] || null,
            owner_last_name: data.owner_name?.split(' ').slice(1).join(' ') || null,
            owner_address: data.owner_address,
          })
          .eq('plate_number', plateNumber)

        if (updateError) {
          toast.error('Failed to save enriched vehicle data')
          return
        }
        queryClient.invalidateQueries({ queryKey: ['breach-vehicle', plateNumber] })
        toast.success('Vehicle data enriched from MotorWeb')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to enrich from MotorWeb')
    } finally {
      setEnrichingVehicle(null)
    }
  }

  // Calculate stats
  const stats = breaches ? {
    total: breaches.length,
    pending: breaches.filter((b: any) => b.status === 'pending').length,
    acknowledged: breaches.filter((b: any) => b.status === 'acknowledged').length,
    enforcement: breaches.filter((b: any) => b.status === 'enforcement_started').length,
    resolved: breaches.filter((b: any) => b.status === 'resolved').length,
  } : null

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4" />
      case 'acknowledged': return <Bell className="h-4 w-4" />
      case 'enforcement_started': return <ShieldAlert className="h-4 w-4" />
      case 'resolved': return <CheckCircle className="h-4 w-4" />
      case 'dismissed': return <XCircle className="h-4 w-4" />
      default: return <XCircle className="h-4 w-4" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-orange-100 text-orange-800'
      case 'acknowledged': return 'bg-blue-100 text-blue-800'
      case 'enforcement_started': return 'bg-purple-100 text-purple-800'
      case 'resolved': return 'bg-green-100 text-green-800'
      case 'dismissed': return 'bg-gray-100 text-gray-600'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  // Corrected breach type labels per 20260218_rebuild_breach_alerts_system.sql
  const getBreachTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      consecutive_nights: 'Consecutive Nights Exceeded',
      monthly_limit: 'Monthly Night Limit Exceeded',
      self_contained: 'Self-Contained Certification',
      after_hours: 'After Hours / Outside Permitted Period',
      day_visit_violation: 'Day Visit Violation',
      allowed_days_violation: 'Allowed Days Violation',
      // Legacy labels kept for backwards compatibility
      overstay: 'Overstay',
      no_self_contained: 'No Self-Contained',
      unauthorized_zone: 'Unauthorized Zone',
      nights_exceeded: 'Nights Exceeded',
    }
    return labels[type] || type.replace(/_/g, ' ')
  }

  const openDetails = (breach: any) => {
    setSelectedBreach(breach)
    setResolveNotes('')
    setShowDetailsDialog(true)
  }

  return (
    <AppLayout title="Breach & Safety Alerts" description="Manage compliance breaches and enforcement actions" showBackButton>
      <GlobalFilterRibbon />

      {/* ── Intelligence & Safety Alert Banners ──────────────────────────── */}
      {intelligenceAlerts && intelligenceAlerts.length > 0 && (
        <Card className="border-red-400 bg-red-50 dark:bg-red-950/30 mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400 text-base">
              <Zap className="h-5 w-5" />
              Intelligence Alert – Restricted Zone / After-Hours Violations ({intelligenceAlerts.length})
            </CardTitle>
            <CardDescription className="text-red-600 dark:text-red-400">
              Pending violations require immediate attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {intelligenceAlerts.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    <span className="font-bold">{a.plate_number || 'Unknown'}</span>
                    <Badge variant="outline" className="text-xs">
                      {getBreachTypeLabel(a.breach_type)}
                    </Badge>
                    <span className="text-gray-500 flex items-center gap-1 text-xs">
                      <MapPin className="h-3 w-3" />
                      {(a.zones as any)?.name || 'Unknown Zone'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">{formatDateTime(a.created_at)}</span>
                    <Button size="sm" variant="outline" className="text-xs h-6 px-2"
                      onClick={() => acknowledgeMutation.mutate(a.id)}
                      disabled={acknowledgeMutation.isPending}>
                      Acknowledge
                    </Button>
                  </div>
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
              Safety Alert – Officer Inactivity / GPS Loss ({safetyAlerts.length})
            </CardTitle>
            <CardDescription className="text-orange-600 dark:text-orange-400">
              HSWA 2015 – Primary Duty of Care. Officers need welfare check.
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
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">{formatDateTime(a.created_at)}</span>
                    <Button size="sm" variant="outline" className="text-xs h-6 px-2"
                      onClick={() => acknowledgeWelfareMutation.mutate(a.id)}
                      disabled={acknowledgeWelfareMutation.isPending}>
                      Acknowledge
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-5 mb-8">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-600">Total</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-orange-600">Pending</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-orange-600">{stats.pending}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-blue-600">Acknowledged</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-blue-600">{stats.acknowledged}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-purple-600">Enforcement</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-purple-600">{stats.enforcement}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-green-600">Resolved</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-green-600">{stats.resolved}</div></CardContent>
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
              {['all', 'pending', 'acknowledged', 'enforcement_started', 'resolved', 'dismissed'].map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  onClick={() => setStatusFilter(s)}
                  size="sm"
                >
                  {s === 'all' ? 'All' : s === 'enforcement_started' ? 'Enforcement' : s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breach Alerts List */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
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
          {breaches?.map((breach: any) => (
            <Card key={breach.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <CardTitle className="text-xl font-bold flex items-center gap-1">
                        <Car className="h-5 w-5 text-gray-500" />
                        {breach.plate_number || 'Unknown Plate'}
                      </CardTitle>
                      <Badge className={getStatusColor(breach.status)}>
                        {getStatusIcon(breach.status)}
                        <span className="ml-1 capitalize">{breach.status?.replace(/_/g, ' ')}</span>
                      </Badge>
                    </div>
                    <CardDescription className="flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {(breach.zones as any)?.name || 'Unknown Zone'}
                      </span>
                      <span>{(breach.organizations as any)?.name || ''}</span>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {getBreachTypeLabel(breach.breach_type)}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Detected: {formatDateTime(breach.created_at)}
                        </p>
                        {breach.due_date && (
                          <p className="text-sm text-red-600 mt-1">Due: {formatDateTime(breach.due_date)}</p>
                        )}
                        {/* Show key breach_details fields */}
                        {breach.breach_details && Object.keys(breach.breach_details).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {breach.breach_details.nights_count && (
                              <Badge variant="outline" className="text-xs">
                                {breach.breach_details.nights_count} nights
                              </Badge>
                            )}
                            {breach.breach_details.consecutive_nights && (
                              <Badge variant="outline" className="text-xs">
                                {breach.breach_details.consecutive_nights} consecutive
                              </Badge>
                            )}
                            {breach.breach_details.max_allowed && (
                              <Badge variant="outline" className="text-xs text-orange-600">
                                Max allowed: {breach.breach_details.max_allowed}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* MotorWeb Enrichment */}
                  {breach.plate_number && (
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEnrichVehicle(breach.plate_number)}
                        disabled={enrichingVehicle === breach.plate_number}
                        className="w-full"
                      >
                        {enrichingVehicle === breach.plate_number ? (
                          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enriching from MotorWeb...</>
                        ) : (
                          <><Database className="h-4 w-4 mr-2" />Enrich Vehicle Data (MotorWeb)</>
                        )}
                      </Button>
                      <div className="text-xs text-gray-600 mt-1 text-center">
                        Pull owner details and vehicle specs
                      </div>
                    </div>
                  )}

                  {/* Action Buttons – all wired */}
                  <div className="flex gap-2 flex-wrap">
                    {breach.status === 'pending' && (
                      <>
                        <Button variant="outline" size="sm"
                          onClick={() => acknowledgeMutation.mutate(breach.id)}
                          disabled={acknowledgeMutation.isPending}>
                          <Bell className="h-4 w-4 mr-1" />Acknowledge
                        </Button>
                        <Button variant="outline" size="sm"
                          onClick={() => dismissMutation.mutate(breach.id)}
                          disabled={dismissMutation.isPending}>
                          <XCircle className="h-4 w-4 mr-1" />Dismiss
                        </Button>
                      </>
                    )}
                    {breach.status === 'acknowledged' && (
                      <>
                        <Button variant="default" size="sm"
                          onClick={() => enforcementMutation.mutate(breach.id)}
                          disabled={enforcementMutation.isPending}>
                          <ShieldAlert className="h-4 w-4 mr-1" />Start Enforcement
                        </Button>
                        <Button variant="outline" size="sm"
                          onClick={() => resolveMutation.mutate({ breachId: breach.id, notes: '' })}
                          disabled={resolveMutation.isPending}>
                          <CheckCircle className="h-4 w-4 mr-1" />Resolve
                        </Button>
                      </>
                    )}
                    {breach.status === 'enforcement_started' && (
                      <Button variant="default" size="sm"
                        onClick={() => openDetails(breach)}
                        disabled={resolveMutation.isPending}>
                        <CheckCircle className="h-4 w-4 mr-1" />Resolve with Notes
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openDetails(breach)}>
                      <Eye className="h-4 w-4 mr-1" />View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Breach Details Dialog ─────────────────────────────────────────── */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="h-5 w-5" />
              Breach Detail – {selectedBreach?.plate_number || 'Unknown'}
            </DialogTitle>
            <DialogDescription>
              Full breach information, vehicle data, and resolution
            </DialogDescription>
          </DialogHeader>
          {selectedBreach && (
            <div className="space-y-4">
              {/* Status & Type */}
              <div className="flex gap-2 flex-wrap">
                <Badge className={getStatusColor(selectedBreach.status)}>
                  {selectedBreach.status?.replace(/_/g, ' ')}
                </Badge>
                <Badge variant="outline">
                  {getBreachTypeLabel(selectedBreach.breach_type)}
                </Badge>
                {selectedBreach.due_date && (
                  <Badge variant="outline" className="text-red-600">
                    Due: {formatDateTime(selectedBreach.due_date)}
                  </Badge>
                )}
              </div>

              {/* Zone & Org */}
              <div className="text-sm text-gray-600 space-y-1">
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  <strong>Zone:</strong> {(selectedBreach.zones as any)?.name || 'Unknown'}
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  <strong>Detected:</strong> {formatDateTime(selectedBreach.created_at)}
                </div>
                {selectedBreach.resolved_at && (
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    <strong>Resolved:</strong> {formatDateTime(selectedBreach.resolved_at)}
                  </div>
                )}
              </div>

              {/* Breach Details JSONB */}
              {selectedBreach.breach_details && Object.keys(selectedBreach.breach_details).length > 0 && (
                <div>
                  <Label className="text-sm font-semibold mb-1 block">Breach Details</Label>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 text-xs font-mono space-y-1">
                    {Object.entries(selectedBreach.breach_details).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}:</span>
                        <span className="font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Enriched Vehicle Data */}
              {detailVehicle && (
                <div>
                  <Label className="text-sm font-semibold mb-1 block">Vehicle Record</Label>
                  <div className="bg-blue-50 dark:bg-blue-950 rounded p-3 text-sm space-y-1">
                    <div className="font-bold text-lg">{detailVehicle.plate_number}</div>
                    <div>
                      {[detailVehicle.year, detailVehicle.make, detailVehicle.model, detailVehicle.colour].filter(Boolean).join(' ')}
                      {detailVehicle.body_style && ` (${detailVehicle.body_style})`}
                    </div>
                    {(detailVehicle.owner_first_name || detailVehicle.owner_last_name) && (
                      <div className="text-gray-600">
                        Owner: {[detailVehicle.owner_first_name, detailVehicle.owner_last_name].filter(Boolean).join(' ')}
                      </div>
                    )}
                    {detailVehicle.owner_address && (
                      <div className="text-gray-600">Address: {detailVehicle.owner_address}</div>
                    )}
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {detailVehicle.self_contained && <Badge variant="outline" className="text-xs bg-green-50">Self-Contained</Badge>}
                      {detailVehicle.is_flagged && <Badge variant="outline" className="text-xs bg-red-50 text-red-700">Flagged</Badge>}
                      {detailVehicle.is_exempt && <Badge variant="outline" className="text-xs bg-blue-50">Exempt</Badge>}
                    </div>
                    {/* Enrich button inside details */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => handleEnrichVehicle(selectedBreach.plate_number)}
                      disabled={!selectedBreach?.plate_number || enrichingVehicle === selectedBreach.plate_number}
                    >
                      {enrichingVehicle === selectedBreach.plate_number
                        ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Enriching...</>
                        : <><Database className="h-3 w-3 mr-1" />Re-fetch from MotorWeb</>
                      }
                    </Button>
                  </div>
                </div>
              )}

              {/* Admin Review Notes */}
              {selectedBreach.admin_review_notes && (
                <div>
                  <Label className="text-sm font-semibold mb-1 block">Admin Notes</Label>
                  <p className="text-sm text-gray-600 bg-yellow-50 rounded p-2">{selectedBreach.admin_review_notes}</p>
                </div>
              )}

              {/* Resolution notes field */}
              {['pending', 'acknowledged', 'enforcement_started'].includes(selectedBreach.status) && (
                <div>
                  <Label htmlFor="resolveNotes">Resolution Notes</Label>
                  <Textarea
                    id="resolveNotes"
                    value={resolveNotes}
                    onChange={(e) => setResolveNotes(e.target.value)}
                    placeholder="Describe how the breach was resolved..."
                    rows={3}
                  />
                </div>
              )}
              {selectedBreach.resolution_notes && (
                <div>
                  <Label className="text-sm font-semibold mb-1 block">Resolution Notes</Label>
                  <p className="text-sm text-gray-600 bg-green-50 rounded p-2">{selectedBreach.resolution_notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>Close</Button>
            {selectedBreach && selectedBreach.status === 'pending' && (
              <Button onClick={() => acknowledgeMutation.mutate(selectedBreach.id)} disabled={acknowledgeMutation.isPending}>
                <Bell className="h-4 w-4 mr-1" />Acknowledge
              </Button>
            )}
            {selectedBreach && ['pending', 'acknowledged', 'enforcement_started'].includes(selectedBreach.status) && (
              <Button
                variant="default"
                onClick={() => resolveMutation.mutate({ breachId: selectedBreach.id, notes: resolveNotes })}
                disabled={resolveMutation.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                {resolveMutation.isPending ? 'Resolving...' : 'Mark Resolved'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
