import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertTriangle } from 'lucide-react'

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
}

interface IncidentCreationFormProps {
  onSubmit: (data: IncidentFormData) => Promise<void>
  onCancel?: () => void
  zoneId?: string
  vehiclePlate?: string
  loading?: boolean
}

const INCIDENT_TYPES = [
  'Breach of Rules',
  'Threatening Behaviour',
  'Property Damage',
  'Noise Complaint',
  'Vehicle Accident',
  'Medical Emergency',
  'Other',
]

const SEVERITY_OPTIONS: { value: IncidentFormData['severity']; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'text-gray-600' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-600' },
  { value: 'high', label: 'High', color: 'text-orange-600' },
  { value: 'critical', label: 'Critical', color: 'text-red-600' },
]

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

  const validate = () => {
    const e: typeof errors = {}
    if (!title.trim()) e.title = 'Title is required'
    if (!description.trim()) e.description = 'Description is required'
    if (!incidentType) e.incident_type = 'Incident type is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

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
    })
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
