import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, User, UserPlus, X, Camera, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { FaceRecognition } from '@/components/features/FaceRecognition'
import type { POIMatch } from '@/components/features/FaceRecognition'

export interface IncidentFormData {
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  incident_type: string
  vehicle_plate?: string
  zone_id?: string
  location_description?: string
  witness_details?: string
  action_taken?: string
  /** UUID of an existing person_record to associate with this incident */
  person_record_id?: string
  /** UUID of a face_records row captured during this incident */
  face_record_id?: string
}

interface NewPersonFields {
  full_name: string
  date_of_birth: string
  contact_phone: string
  contact_email: string
  address: string
  notes: string
}

interface IncidentCreationFormProps {
  onSubmit: (data: IncidentFormData) => Promise<void>
  onCancel?: () => void
  zoneId?: string
  vehiclePlate?: string
  organizationId?: string
  loading?: boolean
}

const INCIDENT_TYPES = [
  'Breach of Rules',
  'Threatening Behaviour',
  'Property Damage',
  'Noise Complaint',
  'Vehicle Accident',
  'Medical Emergency',
  'Maintenance Report',
  'Other',
]

const SEVERITY_OPTIONS: { value: IncidentFormData['severity']; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-gray-600' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-600' },
  { value: 'high', label: 'High', color: 'text-orange-600' },
  { value: 'critical', label: 'Critical', color: 'text-red-600' },
]

const BLANK_NEW_PERSON: NewPersonFields = {
  full_name: '',
  date_of_birth: '',
  contact_phone: '',
  contact_email: '',
  address: '',
  notes: '',
}

export function IncidentCreationForm({
  onSubmit,
  onCancel,
  zoneId,
  vehiclePlate,
  loading,
}: IncidentCreationFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<IncidentFormData['severity']>('medium')
  const [incidentType, setIncidentType] = useState('')
  const [plate, setPlate] = useState(vehiclePlate ?? '')
  const [locationDescription, setLocationDescription] = useState('')
  const [witnessDetails, setWitnessDetails] = useState('')
  const [actionTaken, setActionTaken] = useState('')
  const [errors, setErrors] = useState<{ title?: string; description?: string; incident_type?: string }>({})

  // Person linking state
  const [personSearch, setPersonSearch] = useState('')
  const [selectedPerson, setSelectedPerson] = useState<{ id: string; full_name: string } | null>(null)
  const [showNewPersonForm, setShowNewPersonForm] = useState(false)
  const [newPersonFields, setNewPersonFields] = useState<NewPersonFields>(BLANK_NEW_PERSON)
  const [creatingPerson, setCreatingPerson] = useState(false)
  const [newPersonErrors, setNewPersonErrors] = useState<{ full_name?: string }>({})

  // Face capture state
  const [cameraOpen, setCameraOpen] = useState(false)
  const [capturedFaceRecordId, setCapturedFaceRecordId] = useState<string | null>(null)
  const [capturedFacePhotoUrl, setCapturedFacePhotoUrl] = useState<string | null>(null)

  // Search existing person records
  const { data: personResults = [] } = useQuery({
    queryKey: ['person-records-search', personSearch],
    queryFn: async () => {
      if (!personSearch.trim()) return []
      const { data, error } = await (supabase.from('person_records') as any)
        .select('id, full_name')
        .ilike('full_name', `%${personSearch.trim()}%`)
        .limit(10)
      if (error) throw error
      return (data || []) as { id: string; full_name: string }[]
    },
    enabled: personSearch.trim().length >= 2 && !selectedPerson && !showNewPersonForm,
  })

  const validate = () => {
    const e: typeof errors = {}
    if (!title.trim()) e.title = 'Title is required'
    if (!description.trim()) e.description = 'Description is required'
    if (!incidentType) e.incident_type = 'Incident type is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateNewPerson = () => {
    const e: { full_name?: string } = {}
    if (!newPersonFields.full_name.trim()) e.full_name = 'Full name is required'
    setNewPersonErrors(e)
    return Object.keys(e).length === 0
  }

  const handleCreatePerson = async () => {
    if (!validateNewPerson()) return
    setCreatingPerson(true)
    try {
      const payload = {
        full_name: newPersonFields.full_name.trim(),
        date_of_birth: newPersonFields.date_of_birth || null,
        contact_phone: newPersonFields.contact_phone || null,
        contact_email: newPersonFields.contact_email || null,
        address: newPersonFields.address || null,
        notes: newPersonFields.notes || null,
      }
      const { data, error } = await (supabase.from('person_records') as any)
        .insert(payload)
        .select('id, full_name')
        .single()
      if (error) throw error
      setSelectedPerson({ id: data.id, full_name: data.full_name })
      setShowNewPersonForm(false)
      setPersonSearch('')
    } catch (err: any) {
      setNewPersonErrors({ full_name: err.message || 'Failed to create person' })
    } finally {
      setCreatingPerson(false)
    }
  }

  const clearPerson = () => {
    setSelectedPerson(null)
    setPersonSearch('')
    setCapturedFaceRecordId(null)
    setCapturedFacePhotoUrl(null)
  }

  const handleFaceCaptured = useCallback((result: { faceRecordId: string | null; photoUrl: string; poiMatches?: POIMatch[] }) => {
    if (result.faceRecordId) {
      setCapturedFaceRecordId(result.faceRecordId)
      setCapturedFacePhotoUrl(result.photoUrl)
    }
    setCameraOpen(false)
  }, [])

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      severity,
      incident_type: incidentType,
      vehicle_plate: plate.trim() || undefined,
      zone_id: zoneId,
      location_description: locationDescription.trim() || undefined,
      witness_details: witnessDetails.trim() || undefined,
      action_taken: actionTaken.trim() || undefined,
      person_record_id: selectedPerson?.id,
      face_record_id: capturedFaceRecordId ?? undefined,
    })
  }

  // Render face camera overlay
  if (cameraOpen) {
    return (
      <div className="fixed inset-0 z-50 bg-black">
        <FaceRecognition
          onClose={() => setCameraOpen(false)}
          onFaceCaptured={handleFaceCaptured}
        />
      </div>
    )
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          New Incident Report
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-1">
            <Label htmlFor="inc-title">Title <span className="text-red-500">*</span></Label>
            <Input
              id="inc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief incident title"
            />
            {errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
          </div>

          {/* Incident Type + Severity row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Incident Type <span className="text-red-500">*</span></Label>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.incident_type && <p className="text-xs text-red-500">{errors.incident_type}</p>}
            </div>

            <div className="space-y-1">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as IncidentFormData['severity'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className={s.color}>{s.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Vehicle Plate */}
          <div className="space-y-1">
            <Label htmlFor="inc-plate">Vehicle Plate</Label>
            <Input
              id="inc-plate"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="e.g. ABC123"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label htmlFor="inc-desc">Description <span className="text-red-500">*</span></Label>
            <Textarea
              id="inc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the incident in detail"
              rows={3}
            />
            {errors.description && <p className="text-xs text-red-500">{errors.description}</p>}
          </div>

          {/* Location Description */}
          <div className="space-y-1">
            <Label htmlFor="inc-location">Location Description</Label>
            <Textarea
              id="inc-location"
              value={locationDescription}
              onChange={(e) => setLocationDescription(e.target.value)}
              placeholder="Describe the location"
              rows={2}
            />
          </div>

          {/* Witness Details */}
          <div className="space-y-1">
            <Label htmlFor="inc-witness">Witness Details</Label>
            <Textarea
              id="inc-witness"
              value={witnessDetails}
              onChange={(e) => setWitnessDetails(e.target.value)}
              placeholder="Names and contact details of witnesses"
              rows={2}
            />
          </div>

          {/* Action Taken */}
          <div className="space-y-1">
            <Label htmlFor="inc-action">Action Taken</Label>
            <Textarea
              id="inc-action"
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder="Describe any immediate action taken"
              rows={2}
            />
          </div>

          {/* ── Linked Person ──────────────────────────────────────── */}
          <div className="border rounded-lg p-4 space-y-3 bg-blue-50/40 dark:bg-blue-950/10">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <User className="h-4 w-4 text-blue-600" />
                Linked Person
              </Label>
              {!selectedPerson && !showNewPersonForm && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowNewPersonForm(true); setPersonSearch('') }}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  New Person
                </Button>
              )}
            </div>

            {/* Selected person badge + face capture */}
            {selectedPerson && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="flex items-center gap-1.5 text-sm py-1 px-2">
                  <User className="h-3.5 w-3.5" />
                  {selectedPerson.full_name}
                  <button
                    type="button"
                    onClick={clearPerson}
                    className="ml-1 hover:text-red-500"
                    aria-label="Remove linked person"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>

                {capturedFacePhotoUrl ? (
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded overflow-hidden border">
                      <img src={capturedFacePhotoUrl} alt="Face" className="w-full h-full object-cover" />
                    </div>
                    <Badge className="bg-green-600 text-white text-xs flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Face captured
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setCameraOpen(true)}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1" />
                      Retake
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCameraOpen(true)}
                  >
                    <Camera className="h-3.5 w-3.5 mr-1" />
                    Capture Face Photo
                  </Button>
                )}
              </div>
            )}

            {/* Existing person search */}
            {!selectedPerson && !showNewPersonForm && (
              <div className="space-y-1">
                <Input
                  placeholder="Search existing person by name…"
                  value={personSearch}
                  onChange={(e) => setPersonSearch(e.target.value)}
                />
                {personSearch.trim().length >= 2 && personResults.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No matching records found.{' '}
                    <button
                      type="button"
                      className="underline text-blue-600"
                      onClick={() => setShowNewPersonForm(true)}
                    >
                      Create a new person record
                    </button>
                  </p>
                )}
                {personResults.length > 0 && (
                  <div className="border rounded divide-y text-sm bg-white dark:bg-gray-900 shadow-sm max-h-40 overflow-y-auto">
                    {personResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-950/30 flex items-center gap-2"
                        onClick={() => { setSelectedPerson(p); setPersonSearch('') }}
                      >
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        {p.full_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inline new person form */}
            {showNewPersonForm && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Create New Person Record</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowNewPersonForm(false); setNewPersonFields(BLANK_NEW_PERSON); setNewPersonErrors({}) }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Full Name <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="Full name"
                    value={newPersonFields.full_name}
                    onChange={(e) => setNewPersonFields(f => ({ ...f, full_name: e.target.value }))}
                  />
                  {newPersonErrors.full_name && <p className="text-xs text-red-500">{newPersonErrors.full_name}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Date of Birth</Label>
                    <Input
                      type="date"
                      value={newPersonFields.date_of_birth}
                      onChange={(e) => setNewPersonFields(f => ({ ...f, date_of_birth: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input
                      placeholder="+64 21 xxx xxxx"
                      value={newPersonFields.contact_phone}
                      onChange={(e) => setNewPersonFields(f => ({ ...f, contact_phone: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={newPersonFields.contact_email}
                    onChange={(e) => setNewPersonFields(f => ({ ...f, contact_email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Address</Label>
                  <Input
                    placeholder="Last known address"
                    value={newPersonFields.address}
                    onChange={(e) => setNewPersonFields(f => ({ ...f, address: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    placeholder="Additional notes…"
                    value={newPersonFields.notes}
                    onChange={(e) => setNewPersonFields(f => ({ ...f, notes: e.target.value }))}
                    rows={2}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={handleCreatePerson}
                  disabled={creatingPerson || !newPersonFields.full_name.trim()}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  {creatingPerson ? 'Creating…' : 'Create Person & Continue'}
                </Button>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={loading}>
                Cancel
              </Button>
            )}
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? 'Submitting…' : 'Submit Report'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
