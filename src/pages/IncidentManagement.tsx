import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertCircle, Search, FileText, Image, MapPin, Calendar, Wrench, ShieldAlert, Volume2, Plus } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { AppLayout } from '@/components/features/AppLayout'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import { IncidentCreationForm, IncidentFormData } from '@/components/features/IncidentCreationForm'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'

interface Incident {
  id: string
  organization_id: string
  zone_id: string | null
  plate_number: string | null
  incident_type: string | null
  severity: string | null
  status: string
  description: string | null
  created_at: string
  evidence_count: number
  primary_evidence_url: string | null
  location_address: string | null
  notes: string | null
}

// Incident types that map to a category for colour-coding / filtering
const TYPE_CATEGORIES: Record<string, string> = {
  'Maintenance Report': 'maintenance',
  'maintenance':        'maintenance', // legacy value from FieldOfficerPortal
  'Noise Complaint':    'noise',
  'noise_complaint':    'noise',       // legacy snake_case value
  'Medical Emergency':  'hs',
  'Breach of Rules':    'incident',
  'Threatening Behaviour': 'incident',
  'Property Damage':    'incident',
  'Vehicle Accident':   'incident',
  'Other':              'incident',
}

const TYPE_FILTER_OPTIONS = [
  { key: 'all',         label: 'All' },
  { key: 'incident',    label: 'Incidents' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'noise',       label: 'Noise' },
  { key: 'hs',          label: 'H&S' },
]

function typeIcon(incident_type: string | null) {
  const cat = incident_type ? (TYPE_CATEGORIES[incident_type] ?? 'incident') : 'incident'
  if (cat === 'maintenance') return <Wrench className="h-4 w-4 text-blue-500" />
  if (cat === 'noise')       return <Volume2 className="h-4 w-4 text-purple-500" />
  if (cat === 'hs')          return <ShieldAlert className="h-4 w-4 text-red-500" />
  return <AlertCircle className="h-4 w-4 text-orange-500" />
}

export default function IncidentManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const { dateFrom, dateTo, organizationId, zoneId } = useGlobalFiltersStore()
  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [creatingIncident, setCreatingIncident] = useState(false)

  // Fetch incidents
  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', dateFrom, dateTo, organizationId, zoneId, statusFilter, typeFilter, searchTerm],
    queryFn: async ({ signal }) => {
      let query = (supabase as any)
        .from('incidents')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .abortSignal(signal)

      if (startDate) query = query.gte('created_at', startDate)
      if (endDate)   query = query.lte('created_at', endDate)
      if (effectiveOrganizationId) query = query.eq('organization_id', effectiveOrganizationId)
      if (zoneId)    query = query.eq('zone_id', zoneId)
      if (statusFilter !== 'all') query = query.eq('status', statusFilter)

      // Type-category filter: match the set of incident_type values for the chosen category
      if (typeFilter !== 'all') {
        const matchingTypes = Object.entries(TYPE_CATEGORIES)
          .filter(([, cat]) => cat === typeFilter)
          .map(([label]) => label)
        if (matchingTypes.length > 0) {
          query = query.in('incident_type', matchingTypes)
        }
      }

      if (searchTerm) {
        query = query.or(`plate_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,incident_type.ilike.%${searchTerm}%`)
      }

      const { data, error } = await query.limit(100)
      if (error) throw error
      return data as Incident[]
    },
  })

  // Create incident mutation
  const createMutation = useMutation({
    mutationFn: async (formData: IncidentFormData) => {
      const { data: incident, error } = await ((supabase as any).from('incidents') as any).insert({
        organization_id:  user?.organization_id,
        user_id:          user?.id,
        zone_id:          formData.zone_id || null,
        plate_number:     formData.vehicle_plate?.toUpperCase() || null,
        incident_type:    formData.incident_type,
        severity:         formData.severity,
        description:     [
          formData.description,
          formData.location_description ? `Location: ${formData.location_description}` : '',
          formData.witness_details      ? `Witnesses: ${formData.witness_details}`      : '',
          formData.action_taken         ? `Action taken: ${formData.action_taken}`      : '',
        ].filter(Boolean).join('\n\n'),
        status:           'open',
        person_record_id: formData.person_record_id || null,
      }).select('id').single()
      if (error) throw error

      // If a face was captured, link it to the person and incident
      if (formData.face_record_id && incident?.id) {
        const updates: Record<string, string> = { incident_id: incident.id }
        if (formData.person_record_id) {
          updates.person_record_id = formData.person_record_id
        }
        await (supabase as any)
          .from('face_records')
          .update(updates)
          .eq('id', formData.face_record_id)
        // Also call edge function to build the POI embedding link
        if (formData.person_record_id) {
            const { error: linkError } = await edgeFunctions.processFaceScan({
              action: 'link_poi',
              face_record_id: formData.face_record_id,
              person_record_id: formData.person_record_id,
          })
            if (linkError) throw new Error(linkError)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      setShowCreate(false)
      toast.success('Incident report created')
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create incident')
    },
  })

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await ((supabase as any).from('incidents') as any)
        .update({ status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update status')
    },
  })

  const handleCreate = useCallback(async (formData: IncidentFormData) => {
    setCreatingIncident(true)
    try {
      await createMutation.mutateAsync(formData)
    } finally {
      setCreatingIncident(false)
    }
  }, [createMutation])

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200'
      case 'high':     return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'medium':   return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low':      return 'bg-blue-100 text-blue-800 border-blue-200'
      default:         return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getStatusVariant = (status: string): 'default' | 'secondary' | 'outline' | 'destructive' => {
    switch (status) {
      case 'resolved':     return 'default'
      case 'investigating': return 'secondary'
      case 'open':
      case 'pending':      return 'outline'
      default:             return 'secondary'
    }
  }

  return (
    <AppLayout title="Incident Management" description="View and manage incident, maintenance, and noise reports" showBackButton>
      <div className="flex justify-end mb-6">
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Incident
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by plate, type, or description…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Type filter */}
            <div className="flex gap-1">
              {TYPE_FILTER_OPTIONS.map(({ key, label }) => (
                <Button
                  key={key}
                  variant={typeFilter === key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTypeFilter(key)}
                >
                  {key === 'maintenance' && <Wrench className="h-3 w-3 mr-1" />}
                  {key === 'noise'       && <Volume2 className="h-3 w-3 mr-1" />}
                  {key === 'hs'         && <ShieldAlert className="h-3 w-3 mr-1" />}
                  {label}
                </Button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex gap-1 ml-auto">
              {['all', 'open', 'investigating', 'resolved'].map((status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(status)}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Incidents List */}
      <div className="space-y-4">
        {isLoading ? (
          <PaperworkSearchAnimation size="sm" text="Loading incidents…" />
        ) : incidents && incidents.length > 0 ? (
          incidents.map((incident) => (
            <Card key={incident.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {typeIcon(incident.incident_type)}
                      <CardTitle className="text-lg">{incident.incident_type ?? 'Unknown'}</CardTitle>
                      <Badge variant={getStatusVariant(incident.status)}>
                        {incident.status}
                      </Badge>
                      {incident.severity && (
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${getSeverityColor(incident.severity)}`}>
                          {incident.severity}
                        </span>
                      )}
                    </div>
                    {incident.description && (
                      <CardDescription className="mt-2 line-clamp-2">
                        {incident.description}
                      </CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">{formatDateTime(incident.created_at)}</span>
                  </div>
                  {incident.plate_number && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">{incident.plate_number}</span>
                    </div>
                  )}
                  {incident.location_address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-600 truncate">{incident.location_address}</span>
                    </div>
                  )}
                  {incident.evidence_count > 0 && (
                    <div className="flex items-center gap-2">
                      <Image className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-600">{incident.evidence_count} attachment(s)</span>
                    </div>
                  )}
                </div>

                {/* Status actions */}
                <div className="mt-4 flex gap-2">
                  {incident.status === 'open' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatusMutation.mutate({ id: incident.id, status: 'investigating' })}
                      disabled={updateStatusMutation.isPending}
                    >
                      Investigate
                    </Button>
                  )}
                  {incident.status === 'investigating' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatusMutation.mutate({ id: incident.id, status: 'resolved' })}
                      disabled={updateStatusMutation.isPending}
                    >
                      Mark Resolved
                    </Button>
                  )}
                  {incident.status === 'resolved' && (
                    <Badge variant="default" className="text-xs">Resolved</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8 text-gray-600">
                No incidents found
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* New Incident Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              New Incident / Maintenance Report
            </DialogTitle>
          </DialogHeader>
          <IncidentCreationForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            zoneId={zoneId ?? undefined}
            loading={creatingIncident}
          />
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
