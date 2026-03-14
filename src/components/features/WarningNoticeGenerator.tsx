/**
 * WarningNoticeGenerator Component
 * Generate and customize warning notices
 */

import { formatDate } from '@/lib/utils'
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
  FileText,
  Send,
  Download,
  Eye,
  Calendar,
  User,
  MapPin,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

interface WarningNoticeGeneratorProps {
  plateNumber: string
  zoneId: string
  zoneName: string
  breachType: string
  breachReason: string
  observationId: string
  onGenerated?: (actionId: string) => void
}

export function WarningNoticeGenerator({
  plateNumber,
  zoneId,
  zoneName,
  breachType,
  breachReason,
  observationId,
  onGenerated,
}: WarningNoticeGeneratorProps) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<'email' | 'physical'>('email')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  // Generate warning notice mutation
  const generateWarningMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase
        .from('enforcement_actions') as any)
        .insert({
          organization_id: user?.organization_id,
          created_by: user?.id,
          observation_id: observationId,
          plate_number: plateNumber,
          zone_id: zoneId,
          action_type: 'warning',
          notes: additionalNotes,
          status: 'pending',
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Warning notice created successfully')
      
      if (onGenerated) {
        onGenerated(data?.id)
      }
    },
    onError: (error: any) => {
      toast.error(`Failed to create warning: ${error.message}`)
    },
  })

  const handleGenerate = () => {
    if (deliveryMethod === 'email' && !recipientEmail) {
      toast.error('Please enter recipient email address')
      return
    }

    generateWarningMutation.mutate()
  }

  const handlePreview = () => {
    // TODO: Generate PDF preview
    toast.info('Preview feature coming soon')
  }

  const handleDownload = () => {
    // TODO: Generate and download PDF
    toast.info('Download feature coming soon')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Generate Warning Notice
        </CardTitle>
        <CardDescription>
          Create formal warning for compliance violation
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Notice details */}
        <div className="p-4 bg-muted rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Notice Type</span>
            <Badge variant="secondary">Warning Notice</Badge>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Vehicle:</span>
              <span className="font-medium">{plateNumber}</span>
            </div>

            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Zone:</span>
              <span className="font-medium">{zoneName}</span>
            </div>

            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <span className="text-muted-foreground">Violation:</span>
                <div className="font-medium mt-1">{breachType}</div>
                <div className="text-muted-foreground mt-1">{breachReason}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Issue Date:</span>
              <span className="font-medium">{formatDate(new Date().toISOString())}</span>
            </div>
          </div>
        </div>

        {/* Delivery method */}
        <div className="space-y-2">
          <Label>Delivery Method</Label>
          <div className="flex gap-2">
            <Button
              variant={deliveryMethod === 'email' ? 'default' : 'outline'}
              onClick={() => setDeliveryMethod('email')}
              className="flex-1"
            >
              Email
            </Button>
            <Button
              variant={deliveryMethod === 'physical' ? 'default' : 'outline'}
              onClick={() => setDeliveryMethod('physical')}
              className="flex-1"
            >
              Physical Copy
            </Button>
          </div>
        </div>

        {/* Recipient details */}
        <div className="space-y-3">
          <div>
            <Label htmlFor="recipient-name">Recipient Name (Optional)</Label>
            <Input
              id="recipient-name"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Vehicle owner name"
            />
          </div>

          {deliveryMethod === 'email' && (
            <div>
              <Label htmlFor="recipient-email">
                Recipient Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="recipient-email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="owner@example.com"
                required
              />
            </div>
          )}
        </div>

        {/* Additional notes */}
        <div>
          <Label htmlFor="notes">Additional Notes (Optional)</Label>
          <textarea
            id="notes"
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            placeholder="Any additional context or instructions..."
            className="w-full min-h-24 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Preview notice content */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="font-medium">Notice Preview</div>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>Dear {recipientName || 'Vehicle Owner'},</p>
            <p>
              This is a formal warning regarding vehicle {plateNumber} observed in 
              violation of parking regulations at {zoneName}.
            </p>
            <p>
              <strong>Violation Type:</strong> {breachType}
            </p>
            <p>
              <strong>Details:</strong> {breachReason}
            </p>
            <p>
              Please ensure compliance with zone regulations to avoid further enforcement 
              action. Repeated violations may result in a Notice to Vacate or towing.
            </p>
            {additionalNotes && (
              <p>
                <strong>Additional Information:</strong> {additionalNotes}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={isGenerating}
          >
            <Eye className="h-4 w-4 mr-2" />
            Preview PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={isGenerating}
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generateWarningMutation.isPending}
            className="flex-1"
          >
            <Send className="h-4 w-4 mr-2" />
            {deliveryMethod === 'email' ? 'Send Warning' : 'Generate Warning'}
          </Button>
        </div>

        {/* Success message */}
        {generateWarningMutation.isSuccess && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="text-sm text-green-900 dark:text-green-100">
              Warning notice created successfully! 
              {deliveryMethod === 'email' && ' Email will be sent to ' + recipientEmail}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
