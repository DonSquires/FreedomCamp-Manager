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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { 
  FileText, 
  Search, 
  AlertCircle,
  AlertTriangle,
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
  UserPlus,
  Camera,
  X,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

interface Incident {
  id: string
  plate_number: string | null
  incident_type: string | null
  severity: string | null
  status: string
  description: string | null
  // retention_hold and retention_until are planned columns not yet in the live DB
  retention_hold?: boolean
  retention_until?: string | null
  evidence_count: number
  primary_evidence_url: string | null
  location_lat: number | null
  location_lng: number | null
  location_address: string | null
  notes: string | null
  metadata: any
  created_at: string
  person_record_id: string | null
  zone: {
    name: string
  } | null
  user_profile: {
    first_name: string
    last_name: string
  } | null
  person_record: {
    id: string
    first_name: string | null
    last_name: string | null
  } | null
}

export default function IncidentReports() {
  const { user } = useAuthStore()
  const isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role ?? '')
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)

  // Link person dialog state
  const [linkPersonSearch, setLinkPersonSearch] = useState('')
  const [showNewPersonInline, setShowNewPersonInline] = useState(false)
  const [newPersonForm, setNewPersonForm] = useState({ first_name: '', last_name: '', date_of_birth: '', notes: '' })
  const [creatingPersonForLink, setCreatingPersonForLink] = useState(false)

  // Fetch incidents
  const { data: incidents, isLoading, isFetching, isError } = useQuery({
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
          evidence_count,
          primary_evidence_url,
          location_lat,
          location_lng,
          location_address,
          notes,
          metadata,
          created_at,
          person_record_id,
          zone:zones(name),
          user_profile:user_profiles!incidents_user_id_fkey(first_name, last_name),
          person_record:person_records(id, first_name, last_name)
        `)
        
        .order('created_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      // Date filters
      if (dateFrom) {
        query = query.gte('created_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('created_at', dateTo)
      }

      // Zone filter
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      // Exclude soft-deleted incidents
      query = query.eq('deleted_at', null)

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
        return (data as unknown as Incident[]).filter(incident =>
          incident.plate_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          incident.description?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }

      return data as unknown as Incident[]
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

  // Link person to incident mutation
  const linkPersonMutation = useMutation({
    mutationFn: async ({ incidentId, personRecordId, personName }: { incidentId: string; personRecordId: string | null; personName?: string }) => {
      const { error } = await (supabase.from('incidents') as any)
        .update({ person_record_id: personRecordId })
        .eq('id', incidentId)
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      const newPersonRecord = variables.personRecordId && variables.personName
        ? { id: variables.personRecordId, first_name: variables.personName, last_name: null }
        : null
      setSelectedIncident(prev => prev ? { ...prev, person_record_id: variables.personRecordId, person_record: newPersonRecord } : prev)
      toast.success(variables.personRecordId ? 'Person linked to incident' : 'Person link removed')
      setLinkPersonSearch('')
      setShowNewPersonInline(false)
      setNewPersonForm({ first_name: '', last_name: '', date_of_birth: '', notes: '' })
    },
    onError: () => {
      toast.error('Failed to update person link')
    },
  })

  // Search person records for link dialog
  const { data: linkPersonResults = [] } = useQuery({
    queryKey: ['link-person-search', linkPersonSearch],
    queryFn: async () => {
      if (!linkPersonSearch.trim()) return []
      const { data, error } = await (supabase.from('person_records') as any)
        .select('id, first_name, last_name')
        .or(`first_name.ilike.%${linkPersonSearch.trim()}%,last_name.ilike.%${linkPersonSearch.trim()}%`)
        .limit(10)
      if (error) throw error
      return (data || []) as { id: string; first_name: string | null; last_name: string | null }[]
    },
    enabled: linkPersonSearch.trim().length >= 2 && showDetailsModal && !showNewPersonInline,
  })

  const handleCreateAndLinkPerson = async () => {
    if (!newPersonForm.first_name.trim() || !selectedIncident) return
    setCreatingPersonForLink(true)
    try {
      const { data, error } = await (supabase.from('person_records') as any)
        .insert({
          first_name: newPersonForm.first_name.trim(),
          last_name: newPersonForm.last_name.trim() || null,
          date_of_birth: newPersonForm.date_of_birth || null,
          notes: newPersonForm.notes || null,
        })
        .select('id, first_name, last_name')
        .single()
      if (error) throw error
      const displayName = [data.first_name, data.last_name].filter(Boolean).join(' ')
      await linkPersonMutation.mutateAsync({ incidentId: selectedIncident.id, personRecordId: data.id, personName: displayName })
      // The mutation onSuccess already updates selectedIncident, no need to set it again
    } catch (err: any) {
      toast.error(err.message || 'Failed to create person')
    } finally {
      setCreatingPersonForLink(false)
    }
  }

  // Calculate stats
  const stats = incidents ? {
    total: incidents.length,
    critical: incidents.filter(i => i.severity === 'critical').length,
    high: incidents.filter(i => i.severity === 'high').length,
    with_evidence: incidents.filter(i => i.evidence_count > 0).length,
    legal_holds: incidents.filter(i => i.retention_hold).length,
    pending: incidents.filter(i => i.status === 'new' || i.status === 'processing').length,
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
    setLinkPersonSearch('')
    setShowNewPersonInline(false)
    setNewPersonForm({ first_name: '', last_name: '', date_of_birth: '', notes: '' })
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
                <Camera className="h-3 w-3" />
                With Evidence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.with_evidence}</div>
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
      {isFetching && !isLoading && (
        <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          Refreshing incidents
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading incidents...</p>
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="text-center py-12 space-y-3">
            <AlertTriangle className="h-12 w-12 text-red-400 mx-auto" />
            <p className="text-gray-700 dark:text-gray-200 font-medium">Unable to load incidents</p>
            <p className="text-sm text-gray-500">Please refresh and try again.</p>
          </CardContent>
        </Card>
      ) : incidents && incidents.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-700 dark:text-gray-200 font-medium">No incidents in this date range</p>
            <p className="text-sm text-gray-500 mt-1">Try expanding the date filter or clearing search criteria.</p>
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
                      {incident.evidence_count > 0 && (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          <Camera className="h-3 w-3 mr-1" />
                          {incident.evidence_count} Evidence
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
                          {formatDateTime(incident.created_at)}
                        </span>
                        {incident.evidence_count > 0 && (
                          <span className="flex items-center gap-1">
                            <Camera className="h-3 w-3" />
                            {incident.evidence_count} evidence item{incident.evidence_count !== 1 ? 's' : ''}
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
                    <div className="flex items-center gap-2 text-sm flex-wrap">
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

                  {/* Linked Person */}
                  {incident.person_record && (
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-green-600" />
                        <span className="text-gray-600 dark:text-gray-400">Linked Person:</span>
                        <span className="font-medium">{[incident.person_record.first_name, incident.person_record.last_name].filter(Boolean).join(' ') || '(No name)'}</span>
                      </div>
                    </div>
                  )}

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

                    {isAdmin && (
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
                    )}

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
                  <span className="text-sm font-medium text-gray-600">Recorded</span>
                  <p>{formatDateTime(selectedIncident.created_at)}</p>
                </div>
              </div>

              <div>
                <span className="text-sm font-medium text-gray-600">Description</span>
                <p className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded">{selectedIncident.description}</p>
              </div>

              {/* ── Linked Person section ── */}
              <div className="border rounded-lg p-4 space-y-3 bg-blue-50/40 dark:bg-blue-950/10">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <User className="h-4 w-4 text-blue-600" />
                    Linked Person
                  </span>
                  {selectedIncident.person_record ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => linkPersonMutation.mutate({ incidentId: selectedIncident.id, personRecordId: null })}
                      disabled={linkPersonMutation.isPending}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Remove
                    </Button>
                  ) : !showNewPersonInline ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowNewPersonInline(true)}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1" />
                      New Person
                    </Button>
                  ) : null}
                </div>

                {selectedIncident.person_record ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="flex items-center gap-1.5 text-sm py-1 px-2">
                      <User className="h-3.5 w-3.5" />
                      {[selectedIncident.person_record.first_name, selectedIncident.person_record.last_name].filter(Boolean).join(' ') || '(No name)'}
                    </Badge>
                  </div>
                ) : !showNewPersonInline ? (
                  <div className="space-y-1">
                    <Input
                      placeholder="Search existing person by name…"
                      value={linkPersonSearch}
                      onChange={(e) => setLinkPersonSearch(e.target.value)}
                    />
                    {linkPersonSearch.trim().length >= 2 && linkPersonResults.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No matching records found.{' '}
                        <button
                          type="button"
                          className="underline text-blue-600"
                          onClick={() => setShowNewPersonInline(true)}
                        >
                          Create a new person record
                        </button>
                      </p>
                    )}
                    {linkPersonResults.length > 0 && (
                      <div className="border rounded divide-y text-sm bg-white dark:bg-gray-900 shadow-sm max-h-36 overflow-y-auto">
                        {linkPersonResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-950/30 flex items-center gap-2"
                            onClick={() => linkPersonMutation.mutate({ incidentId: selectedIncident.id, personRecordId: p.id, personName: [p.first_name, p.last_name].filter(Boolean).join(' ') })}
                            disabled={linkPersonMutation.isPending}
                          >
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {[p.first_name, p.last_name].filter(Boolean).join(' ') || '(No name)'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">Create New Person Record</p>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setShowNewPersonInline(false); setNewPersonForm({ first_name: '', last_name: '', date_of_birth: '', notes: '' }) }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">First Name <span className="text-red-500">*</span></Label>
                      <Input
                        placeholder="First name"
                        value={newPersonForm.first_name}
                        onChange={(e) => setNewPersonForm(f => ({ ...f, first_name: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Last Name</Label>
                        <Input placeholder="Last name" value={newPersonForm.last_name} onChange={(e) => setNewPersonForm(f => ({ ...f, last_name: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Date of Birth</Label>
                        <Input type="date" value={newPersonForm.date_of_birth} onChange={(e) => setNewPersonForm(f => ({ ...f, date_of_birth: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Textarea placeholder="Additional notes…" value={newPersonForm.notes} onChange={(e) => setNewPersonForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      onClick={handleCreateAndLinkPerson}
                      disabled={creatingPersonForLink || !newPersonForm.first_name.trim()}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1" />
                      {creatingPersonForLink ? 'Creating…' : 'Create Person & Link'}
                    </Button>
                  </div>
                )}
              </div>

              {selectedIncident.primary_evidence_url && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Evidence ({selectedIncident.evidence_count})</span>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <img
                      src={selectedIncident.primary_evidence_url}
                      alt="Primary evidence"
                      className="w-full h-32 object-cover rounded border"
                    />
                  </div>
                </div>
              )}

              {selectedIncident.retention_hold && (
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                  <Lock className="h-5 w-5 text-purple-600 inline mr-2" />
                  <span className="font-medium text-purple-600">Legal Hold Active</span>
                  {selectedIncident.retention_until && (
                    <p className="text-xs text-gray-500 mt-1">
                      Until {formatDateTime(selectedIncident.retention_until)}
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
