import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { 
  FileText, 
  Search, 
  AlertCircle,
  CheckCircle,
  Clock,
  Shield,
  Lock,
  Unlock,
  Eye,
  Download,
  MapPin,
  Calendar,
  User,
  Camera
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

interface Incident {
  id: string
  plate_number: string | null
  incident_type: string
  severity: string
  status: string
  description: string
  court_ready: boolean
  retention_hold: boolean
  retention_until: string | null
  approved_by: string | null
  approved_at: string | null
  happened_at: string
  created_at: string
  zone: {
    name: string
  }
  user_profile: {
    first_name: string
    last_name: string
  }
  photos: string[]
  photo_metadata_ids: string[]
}

export default function IncidentReports() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)

  // Fetch incidents
  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', organizationId, zoneId, severityFilter, statusFilter, searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('incidents')
        .select(`
          id,
          plate_number,
          incident_type,
          severity,
          status,
          description,
          court_ready,
          retention_hold,
          retention_until,
          approved_by,
          approved_at,
          happened_at,
          created_at,
          zone:zones(name),
          user_profile:user_profiles(first_name, last_name),
          photos,
          photo_metadata_ids
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      // Date filters
      if (dateFrom) {
        query = query.gte('happened_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('happened_at', dateTo)
      }

      // Zone filter
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      // Severity filter
      if (severityFilter !== 'all') {
        query = query.eq('severity', severityFilter)
      }

      // Status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error

      // Filter by plate number search
      if (searchQuery) {
        return (data as Incident[]).filter(incident =>
          incident.plate_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          incident.description?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }

      return data as Incident[]
    },
  })

  // Set legal hold mutation
  const setLegalHoldMutation = useMutation({
    mutationFn: async ({ incidentId, enable }: { incidentId: string; enable: boolean }) => {
      const retentionDate = enable ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null

      const { error } = await (supabase.from('incidents') as any)
        .update({
          retention_hold: enable,
          retention_until: retentionDate,
        })
        .eq('id', incidentId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success(variables.enable ? 'Legal hold enabled' : 'Legal hold removed')
    },
    onError: () => {
      toast.error('Failed to update legal hold')
    },
  })

  // Mark court ready mutation
  const markCourtReadyMutation = useMutation({
    mutationFn: async (incidentId: string) => {
      const { error } = await (supabase.from('incidents') as any)
        .update({
          court_ready: true,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', incidentId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Marked as court-ready')
    },
    onError: () => {
      toast.error('Failed to mark as court-ready')
    },
  })

  // Calculate stats
  const stats = incidents ? {
    total: incidents.length,
    critical: incidents.filter(i => i.severity === 'critical').length,
    high: incidents.filter(i => i.severity === 'high').length,
    court_ready: incidents.filter(i => i.court_ready).length,
    legal_holds: incidents.filter(i => i.retention_hold).length,
    pending: incidents.filter(i => i.status === 'pending').length,
  } : null

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      case 'high':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      default:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      case 'resolved':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      default:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
    }
  }

  const openDetailsModal = (incident: Incident) => {
    setSelectedIncident(incident)
    setShowDetailsModal(true)
  }

  return (
    <AppLayout
      title="Incident Reports"
      description="Court-ready incident management with evidence integrity"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-6 mb-6">
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
              <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Critical
              </CardTitle>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Court Ready
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.court_ready}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Legal Holds
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{stats.legal_holds}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-600">{stats.pending}</div>
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
                  placeholder="Search by plate number or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant={severityFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setSeverityFilter('all')}
                size="sm"
              >
                All Severity
              </Button>
              <Button
                variant={severityFilter === 'critical' ? 'default' : 'outline'}
                onClick={() => setSeverityFilter('critical')}
                size="sm"
              >
                Critical
              </Button>
              <Button
                variant={severityFilter === 'high' ? 'default' : 'outline'}
                onClick={() => setSeverityFilter('high')}
                size="sm"
              >
                High
              </Button>
              <Button
                variant={severityFilter === 'medium' ? 'default' : 'outline'}
                onClick={() => setSeverityFilter('medium')}
                size="sm"
              >
                Medium
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                size="sm"
              >
                All Status
              </Button>
              <Button
                variant={statusFilter === 'pending' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('pending')}
                size="sm"
              >
                Pending
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

      {/* Incidents List */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading incidents...</p>
        </div>
      ) : incidents && incidents.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No incidents found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {incidents?.map((incident) => (
            <Card key={incident.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {incident.plate_number && (
                        <CardTitle className="text-xl font-mono">
                          {incident.plate_number}
                        </CardTitle>
                      )}
                      <Badge className={getSeverityColor(incident.severity)}>
                        {incident.severity}
                      </Badge>
                      <Badge className={getStatusColor(incident.status)}>
                        {incident.status}
                      </Badge>
                      {incident.court_ready && (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          <Shield className="h-3 w-3 mr-1" />
                          Court Ready
                        </Badge>
                      )}
                      {incident.retention_hold && (
                        <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                          <Lock className="h-3 w-3 mr-1" />
                          Legal Hold
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {incident.incident_type.replace(/_/g, ' ')}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {incident.zone?.name || 'Unknown Zone'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDateTime(incident.happened_at)}
                        </span>
                        {incident.photos && incident.photos.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Camera className="h-3 w-3" />
                            {incident.photos.length} photo{incident.photos.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Description */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {incident.description}
                    </p>
                  </div>

                  {/* Officer */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-blue-600" />
                      <span className="text-gray-600 dark:text-gray-400">Reported by:</span>
                      <span className="font-medium">
                        {incident.user_profile.first_name} {incident.user_profile.last_name}
                      </span>
                      <span className="text-xs text-gray-500">
                        ({formatDateTime(incident.created_at)})
                      </span>
                    </div>
                  </div>

                  {/* Legal Hold Info */}
                  {incident.retention_hold && incident.retention_until && (
                    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Lock className="h-4 w-4 text-purple-600" />
                        <span className="font-medium text-purple-600">Legal Hold Active</span>
                        <span className="text-xs text-gray-500">
                          Until {formatDateTime(incident.retention_until)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openDetailsModal(incident)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Details
                    </Button>

                    {!incident.court_ready && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => markCourtReadyMutation.mutate(incident.id)}
                        disabled={markCourtReadyMutation.isPending}
                      >
                        <Shield className="h-4 w-4 mr-1" />
                        Mark Court-Ready
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLegalHoldMutation.mutate({
                        incidentId: incident.id,
                        enable: !incident.retention_hold,
                      })}
                      disabled={setLegalHoldMutation.isPending}
                    >
                      {incident.retention_hold ? (
                        <>
                          <Unlock className="h-4 w-4 mr-1" />
                          Remove Hold
                        </>
                      ) : (
                        <>
                          <Lock className="h-4 w-4 mr-1" />
                          Set Legal Hold
                        </>
                      )}
                    </Button>

                    <Button variant="outline" size="sm">
                      <Download className="h-4 w-4 mr-1" />
                      Export PDF
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Details Modal */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Incident Details</DialogTitle>
            <DialogDescription>
              Full incident report with evidence and metadata
            </DialogDescription>
          </DialogHeader>

          {selectedIncident && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm font-medium text-gray-600">Plate Number</span>
                  <p className="text-lg font-mono">{selectedIncident.plate_number || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Severity</span>
                  <p><Badge className={getSeverityColor(selectedIncident.severity)}>{selectedIncident.severity}</Badge></p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Type</span>
                  <p>{selectedIncident.incident_type.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Status</span>
                  <p><Badge className={getStatusColor(selectedIncident.status)}>{selectedIncident.status}</Badge></p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Zone</span>
                  <p>{selectedIncident.zone?.name}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Occurred</span>
                  <p>{formatDateTime(selectedIncident.happened_at)}</p>
                </div>
              </div>

              <div>
                <span className="text-sm font-medium text-gray-600">Description</span>
                <p className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded">{selectedIncident.description}</p>
              </div>

              {selectedIncident.photos && selectedIncident.photos.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Evidence Photos ({selectedIncident.photos.length})</span>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {selectedIncident.photos.map((photo, idx) => (
                      <img
                        key={idx}
                        src={photo}
                        alt={`Evidence ${idx + 1}`}
                        className="w-full h-32 object-cover rounded border"
                      />
                    ))}
                  </div>
                </div>
              )}

              {selectedIncident.court_ready && (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                  <CheckCircle className="h-5 w-5 text-blue-600 inline mr-2" />
                  <span className="font-medium text-blue-600">Court-Ready Evidence</span>
                  {selectedIncident.approved_at && (
                    <p className="text-xs text-gray-500 mt-1">
                      Approved {formatDateTime(selectedIncident.approved_at)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailsModal(false)}>
              Close
            </Button>
            <Button>
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
