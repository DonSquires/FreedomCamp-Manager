import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { 
  AlertTriangle, 
  MapPin, 
  Clock, 
  User, 
  FileText, 
  Bell,
  CheckCircle,
  Mail,
  Printer,
  XCircle
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { useState } from 'react'
import { toast } from 'sonner'

interface BreachAdvisoryModalProps {
  isOpen: boolean
  onClose: () => void
  breach: {
    id: string
    plate_number: string
    breach_type: string
    status: string
    severity: string
    /** `created_at` is the canonical DB column; callers may also pass `detected_at` for legacy compat. */
    created_at?: string
    detected_at?: string
    zone?: { name: string }
    organization?: { name: string }
    breach_details?: any
    due_date?: string
    notified_at?: string
    resolved_at?: string
  }
  onResolve?: (breachId: string) => Promise<void>
  onNotify?: (breachId: string) => Promise<void>
  onEscalate?: (breachId: string) => Promise<void>
}

export function BreachAdvisoryModal({
  isOpen,
  onClose,
  breach,
  onResolve,
  onNotify,
  onEscalate,
}: BreachAdvisoryModalProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200'
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getBreachTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      // Current canonical breach type values (compliance engine)
      consecutive_nights: 'Consecutive Nights Exceeded',
      monthly_limit: 'Monthly Stay Limit Exceeded',
      self_contained: 'Self-Contained Vehicle Required',
      after_hours: 'After Hours Violation',
      day_visit_violation: 'Day-Visit Only Zone',
      allowed_days_violation: 'Not an Allowed Day',
      // Legacy display labels (kept for historical data)
      overstay: 'Maximum Stay Exceeded',
      no_self_contained: 'Not Self-Contained',
      consecutive_days: 'Consecutive Nights Exceeded',
      unauthorized_zone: 'Unauthorized Zone Access',
      nights_exceeded: 'Monthly Night Limit Exceeded',
    }
    return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  const handleAction = async (action: 'resolve' | 'notify' | 'escalate') => {
    setIsProcessing(true)
    try {
      if (action === 'resolve' && onResolve) {
        await onResolve(breach.id)
        toast.success('Breach marked as resolved')
        onClose()
      } else if (action === 'notify' && onNotify) {
        await onNotify(breach.id)
        toast.success('Notification sent successfully')
      } else if (action === 'escalate' && onEscalate) {
        await onEscalate(breach.id)
        toast.success('Breach escalated for enforcement')
      }
    } catch (error: any) {
      toast.error(error.message || `Failed to ${action} breach`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold">
                Breach Advisory
              </DialogTitle>
              <DialogDescription className="mt-2">
                Compliance breach detected for vehicle {breach.plate_number}
              </DialogDescription>
            </div>
            <Badge variant="outline" className={`${getSeverityColor(breach.severity)} px-3 py-1`}>
              {breach.severity?.toUpperCase()}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Breach Type */}
          <Card className="bg-red-50 border-red-200">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-red-600 flex-shrink-0 mt-1" />
                <div className="flex-1">
                  <h3 className="font-semibold text-red-900 text-lg mb-1">
                    {getBreachTypeLabel(breach.breach_type)}
                  </h3>
                  <p className="text-sm text-red-700">
                    This violation requires immediate attention
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vehicle Details */}
          <Card>
            <CardContent className="pt-4">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Vehicle Information
              </h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-600">Plate Number:</span>
                  <p className="font-mono font-bold text-lg">{breach.plate_number}</p>
                </div>
                <div>
                  <span className="text-gray-600">Status:</span>
                  <p className="font-medium">
                    <Badge variant={
                      breach.status === 'resolved' ? 'default' :
                      breach.status === 'acknowledged' ? 'secondary' :
                      'destructive'
                    }>
                      {breach.status}
                    </Badge>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Location & Time */}
          <Card>
            <CardContent className="pt-4">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Location & Time
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600">Zone:</span>
                  <span className="font-medium">{breach.zone?.name || 'Unknown'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600">Detected:</span>
                  <span className="font-medium">{formatDateTime(breach.detected_at ?? breach.created_at)}</span>
                </div>
                {breach.due_date && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-400" />
                    <span className="text-gray-600">Due Date:</span>
                    <span className="font-medium text-orange-600">
                      {new Date(breach.due_date).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Breach Details */}
          {breach.breach_details && (
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3">Violation Details</h4>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm space-y-1">
                  {Object.entries(breach.breach_details).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-gray-600 capitalize">{key.replace(/_/g, ' ')}:</span>
                      <span className="font-medium">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          {(breach.notified_at || breach.resolved_at) && (
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Action Timeline
                </h4>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 text-sm">
                    <div className="p-1.5 bg-red-100 rounded-full">
                      <AlertTriangle className="h-3 w-3 text-red-600" />
                    </div>
                    <div>
                      <p className="font-medium">Breach Detected</p>
                      <p className="text-gray-600">{formatDateTime(breach.detected_at ?? breach.created_at)}</p>
                    </div>
                  </div>

                  {breach.notified_at && (
                    <div className="flex items-start gap-3 text-sm">
                      <div className="p-1.5 bg-blue-100 rounded-full">
                        <Bell className="h-3 w-3 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium">Notice Sent</p>
                        <p className="text-gray-600">{formatDateTime(breach.notified_at)}</p>
                      </div>
                    </div>
                  )}

                  {breach.resolved_at && (
                    <div className="flex items-start gap-3 text-sm">
                      <div className="p-1.5 bg-green-100 rounded-full">
                        <CheckCircle className="h-3 w-3 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium">Resolved</p>
                        <p className="text-gray-600">{formatDateTime(breach.resolved_at)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 flex-1">
            {breach.status === 'pending' && (
              <>
                {onNotify && (
                  <Button
                    variant="outline"
                    onClick={() => handleAction('notify')}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    <Bell className="h-4 w-4 mr-2" />
                    Send Notice
                  </Button>
                )}
                {onEscalate && (
                  <Button
                    variant="outline"
                    onClick={() => handleAction('escalate')}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Escalate
                  </Button>
                )}
              </>
            )}

            {breach.status === 'acknowledged' && onResolve && (
              <Button
                onClick={() => handleAction('resolve')}
                disabled={isProcessing}
                className="flex-1"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Mark Resolved
              </Button>
            )}

            {breach.status === 'resolved' && (
              <div className="flex-1 text-center text-sm text-green-600 font-medium py-2">
                <CheckCircle className="h-4 w-4 inline mr-2" />
                This breach has been resolved
              </div>
            )}
          </div>

          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
