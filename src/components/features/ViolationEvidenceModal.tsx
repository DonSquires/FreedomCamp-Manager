import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AlertTriangle, MapPin, Calendar, Camera, FileText } from 'lucide-react'

interface ViolationEvidenceModalProps {
  open: boolean
  onClose: () => void
  violation: ViolationData | null
}

interface ViolationData {
  plate_number: string
  jurisdiction: string
  restriction_type: string
  violation_reason: string
  photo_url: string
  gps_latitude: number
  gps_longitude: number
  recorded_at: string
  vehicle_make?: string
  has_sticker: boolean
  officer_name: string
}

export function ViolationEvidenceModal({ open, onClose, violation }: ViolationEvidenceModalProps) {
  if (!violation) return null

  const handleGenerateNotice = () => {
    // TODO: Call generate-notice-to-vacate Edge Function
    console.log('Generating notice for:', violation.plate_number)
  }

  const handleCreateEnforcement = () => {
    // TODO: Navigate to enforcement action creation
    console.log('Creating enforcement action for:', violation.plate_number)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Freedom Camping Violation Detected
          </DialogTitle>
          <DialogDescription>
            Evidence package for plate: <span className="font-mono font-bold">{violation.plate_number}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Photo Evidence */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Camera className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-semibold">Photo Evidence</span>
              </div>
              <img 
                src={violation.photo_url} 
                alt="Vehicle evidence" 
                className="w-full rounded-lg border"
              />
            </CardContent>
          </Card>

          {/* Violation Details */}
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-semibold text-red-700">Violation Summary</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-600">Restriction Type:</span>
                  <Badge variant="outline" className="ml-2 bg-white">
                    {violation.restriction_type.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>

                <div>
                  <span className="text-gray-600">Self-Contained Sticker:</span>
                  <Badge variant="outline" className={`ml-2 ${violation.has_sticker ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {violation.has_sticker ? 'YES' : 'NO'}
                  </Badge>
                </div>

                <div className="col-span-2">
                  <span className="text-gray-600 font-semibold">Reason:</span>
                  <p className="text-red-700 mt-1">{violation.violation_reason}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Location Evidence */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold">Location Evidence</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Jurisdiction:</span>
                  <p className="font-medium">{violation.jurisdiction}</p>
                </div>

                <div>
                  <span className="text-gray-600">GPS Coordinates:</span>
                  <p className="font-mono text-xs">{violation.gps_latitude.toFixed(6)}, {violation.gps_longitude.toFixed(6)}</p>
                </div>

                <div>
                  <span className="text-gray-600">Recorded By:</span>
                  <p className="font-medium">{violation.officer_name}</p>
                </div>

                <div>
                  <span className="text-gray-600">Date/Time:</span>
                  <p className="font-medium">{new Date(violation.recorded_at).toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vehicle Details */}
          {violation.vehicle_make && (
            <Card>
              <CardContent className="p-4">
                <div className="text-sm">
                  <span className="text-gray-600">Vehicle:</span>
                  <p className="font-medium">{violation.vehicle_make}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" onClick={handleGenerateNotice}>
            <FileText className="h-4 w-4 mr-2" />
            Generate Notice
          </Button>
          <Button onClick={handleCreateEnforcement}>
            Create Enforcement Action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
