/**
 * TowRequestForm Component
 * Formal tow request workflow with validation
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { 
  Truck,
  AlertTriangle,
  MapPin,
  Calendar,
  FileText,
  Send,
  X,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'

interface TowRequestFormProps {
  plateNumber: string
  zoneId: string
  zoneName: string
  observationId: string
  breachType?: string
  onSubmitted?: (actionId: string) => void
  onCancel?: () => void
}

export function TowRequestForm({
  plateNumber,
  zoneId,
  zoneName,
  observationId,
  breachType,
  onSubmitted,
  onCancel,
}: TowRequestFormProps) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [towCompany, setTowCompany] = useState('')
  const [towCompanyPhone, setTowCompanyPhone] = useState('')
  const [estimatedArrival, setEstimatedArrival] = useState('')
  const [vehicleLocation, setVehicleLocation] = useState('')
  const [urgency, setUrgency] = useState<'routine' | 'priority' | 'urgent'>('routine')
  const [justification, setJustification] = useState('')
  const [notesTowOperator, setNotesTowOperator] = useState('')

  // Submit tow request mutation
  const submitTowRequestMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase
        .from('enforcement_actions') as any)
        .insert({
          organization_id: user?.organization_id,
          created_by: user?.id,
          observation_id: observationId,
          plate_number: plateNumber,
          zone_id: zoneId,
          action_type: 'tow_request',
          notes: `
Urgency: ${urgency.toUpperCase()}
Location: ${vehicleLocation}
Justification: ${justification}
Tow Company: ${towCompany}
Contact: ${towCompanyPhone}
Estimated Arrival: ${estimatedArrival}
${notesTowOperator ? `\nNotes for Operator:\n${notesTowOperator}` : ''}
          `.trim(),
          status: 'pending',
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Tow request submitted successfully')
      
      if (onSubmitted) {
        onSubmitted(data?.id)
      }
    },
    onError: (error: any) => {
      toast.error(`Failed to submit tow request: ${error.message}`)
    },
  })

  const handleSubmit = () => {
    // Validation
    if (!towCompany.trim()) {
      toast.error('Please enter tow company name')
      return
    }

    if (!towCompanyPhone.trim()) {
      toast.error('Please enter tow company phone number')
      return
    }

    if (!vehicleLocation.trim()) {
      toast.error('Please specify vehicle location')
      return
    }

    if (!justification.trim()) {
      toast.error('Please provide justification for tow request')
      return
    }

    submitTowRequestMutation.mutate()
  }

  const getUrgencyBadge = () => {
    switch (urgency) {
      case 'urgent':
        return <Badge variant="destructive">Urgent</Badge>
      case 'priority':
        return <Badge className="bg-yellow-600">Priority</Badge>
      case 'routine':
        return <Badge variant="secondary">Routine</Badge>
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Tow Request Form
            </CardTitle>
            <CardDescription className="mt-1">
              Submit formal tow request for non-compliant vehicle
            </CardDescription>
          </div>
          {onCancel && (
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Vehicle details */}
        <div className="p-4 bg-muted rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold">{plateNumber}</span>
            {breachType && <Badge variant="destructive">{breachType}</Badge>}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>{zoneName}</span>
          </div>
        </div>

        {/* Urgency level */}
        <div className="space-y-2">
          <Label>Urgency Level</Label>
          <div className="flex gap-2">
            <Button
              variant={urgency === 'routine' ? 'default' : 'outline'}
              onClick={() => setUrgency('routine')}
              className="flex-1"
            >
              Routine
            </Button>
            <Button
              variant={urgency === 'priority' ? 'default' : 'outline'}
              onClick={() => setUrgency('priority')}
              className="flex-1"
            >
              Priority
            </Button>
            <Button
              variant={urgency === 'urgent' ? 'default' : 'outline'}
              onClick={() => setUrgency('urgent')}
              className="flex-1"
            >
              Urgent
            </Button>
          </div>
        </div>

        {/* Tow company details */}
        <div className="space-y-3">
          <div>
            <Label htmlFor="tow-company">
              Tow Company <span className="text-red-500">*</span>
            </Label>
            <Input
              id="tow-company"
              value={towCompany}
              onChange={(e) => setTowCompany(e.target.value)}
              placeholder="Company name"
              required
            />
          </div>

          <div>
            <Label htmlFor="tow-phone">
              Contact Phone <span className="text-red-500">*</span>
            </Label>
            <Input
              id="tow-phone"
              type="tel"
              value={towCompanyPhone}
              onChange={(e) => setTowCompanyPhone(e.target.value)}
              placeholder="021 XXX XXXX"
              required
            />
          </div>

          <div>
            <Label htmlFor="estimated-arrival">Estimated Arrival</Label>
            <Input
              id="estimated-arrival"
              type="datetime-local"
              value={estimatedArrival}
              onChange={(e) => setEstimatedArrival(e.target.value)}
            />
          </div>
        </div>

        {/* Location details */}
        <div>
          <Label htmlFor="vehicle-location">
            Exact Vehicle Location <span className="text-red-500">*</span>
          </Label>
          <Input
            id="vehicle-location"
            value={vehicleLocation}
            onChange={(e) => setVehicleLocation(e.target.value)}
            placeholder="e.g., North end of parking lot, near entrance"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Provide specific location details to help tow operator locate vehicle
          </p>
        </div>

        {/* Justification */}
        <div>
          <Label htmlFor="justification">
            Justification <span className="text-red-500">*</span>
          </Label>
          <textarea
            id="justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Explain why towing is necessary (e.g., repeated violations, safety hazard, extended non-compliance)..."
            className="w-full min-h-24 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            required
          />
        </div>

        {/* Notes for tow operator */}
        <div>
          <Label htmlFor="operator-notes">Notes for Tow Operator (Optional)</Label>
          <textarea
            id="operator-notes"
            value={notesTowOperator}
            onChange={(e) => setNotesTowOperator(e.target.value)}
            placeholder="Any special instructions or safety considerations..."
            className="w-full min-h-20 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Warning for urgent requests */}
        {urgency === 'urgent' && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <div className="text-sm text-red-900 dark:text-red-100">
              <div className="font-medium">Urgent tow request</div>
              <div className="mt-1">
                Urgent requests will be escalated immediately. Ensure all details are accurate.
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          {onCancel && (
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={submitTowRequestMutation.isPending}
            >
              Cancel
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={submitTowRequestMutation.isPending}
            className="flex-1"
          >
            <Send className="h-4 w-4 mr-2" />
            Submit Tow Request
          </Button>
        </div>

        {/* Success message */}
        {submitTowRequestMutation.isSuccess && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
              <div className="text-sm text-green-900 dark:text-green-100">
                <div className="font-medium">Tow request submitted</div>
                <div className="mt-1">
                  Request has been logged and {urgency === 'urgent' ? 'escalated for immediate action' : 'queued for processing'}.
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
