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
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import type { BreachAlert, BreachStatus, BreachType, Severity } from '@/types'

interface BreachAlertExtended extends BreachAlert {
  zone: {
    name: string
  }
  organization: {
    name: string
  }
}

export default function BreachAlerts() {
  const { user } = useAuthStore()
  const { organizationId, zoneId } = useGlobalFiltersStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<BreachStatus | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all')
  const queryClient = useQueryClient()

  // Fetch breach alerts
  const { data: breaches, isLoading } = useQuery({
    queryKey: ['breach-alerts', organizationId, zoneId, statusFilter, severityFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name)
        `)
        .order('detected_at', { ascending: false })

      if (organizationId && user?.role !== 'master') {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (severityFilter !== 'all') {
        query = query.eq('severity', severityFilter)
      }

      if (searchQuery) {
        query = query.ilike('plate_number', `%${searchQuery}%`)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error
      return data as unknown as BreachAlertExtended[]
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
    critical: breaches.filter(b => b.severity === 'critical').length,
    high: breaches.filter(b => b.severity === 'high').length,
  } : null

  const getStatusIcon = (status: BreachStatus) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4" />
      case 'notified':
        return <Bell className="h-4 w-4" />
      case 'resolved':
        return <CheckCircle className="h-4 w-4" />
      case 'escalated':
        return <AlertTriangle className="h-4 w-4" />
      default:
        return <XCircle className="h-4 w-4" />
    }
  }

  const getSeverityColor = (severity: Severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300'
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  const getBreachTypeLabel = (type: BreachType) => {
    const labels: Record<BreachType, string> = {
      overstay: 'Overstay',
      no_self_contained: 'No Self-Contained',
      consecutive_days: 'Consecutive Days',
      unauthorized_zone: 'Unauthorized Zone',
      nights_exceeded: 'Nights Exceeded',
    }
    return labels[type] || type
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Breach Alerts
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Manage compliance breaches and enforcement actions
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        {stats && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6 mb-8">
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

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-red-600">Critical</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{stats.critical}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-orange-600">High</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">{stats.high}</div>
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
                        <Badge className={getSeverityColor(breach.severity)}>
                          {breach.severity.toUpperCase()}
                        </Badge>
                        <Badge variant="outline">
                          {getStatusIcon(breach.status)}
                          <span className="ml-1">{breach.status}</span>
                        </Badge>
                      </div>
                      <CardDescription>
                        {breach.zone.name} • {breach.organization.name}
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
      </main>
    </div>
  )
}
