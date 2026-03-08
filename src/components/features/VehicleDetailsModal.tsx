import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  Car, 
  MapPin, 
  Calendar, 
  AlertTriangle, 
  Shield, 
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Download,
  ExternalLink
} from 'lucide-react'
import { formatDateTime, formatDate } from '@/lib/utils'
import { homelessStatusLabel, isHomelessForUi } from '@/lib/homelessStatus'

interface VehicleDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  vehicle: {
    id: string
    plate_number: string
    make?: string
    model?: string
    year?: number
    colour?: string
    self_contained: boolean
    self_contained_expiry?: string
    total_observations: number
    total_breaches: number
    total_incidents?: number
    last_seen_at?: string
    first_seen_at?: string
    is_flagged?: boolean
    flagged_reason?: string
    homeless_status?: string
    profile_photo?: string
    owner_first_name?: string
    owner_last_name?: string
    owner_company_name?: string
    owner_address?: string
  }
  observations?: Array<{
    id: string
    zone_name: string
    recorded_at: string
    is_compliant: boolean
  }>
  breaches?: Array<{
    id: string
    breach_type: string
    detected_at: string
    status: string
  }>
}

export function VehicleDetailsModal({
  isOpen,
  onClose,
  vehicle,
  observations = [],
  breaches = [],
}: VehicleDetailsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                <Car className="h-6 w-6" />
                {vehicle.plate_number}
              </DialogTitle>
              <DialogDescription className="mt-2">
                {vehicle.make && vehicle.model 
                  ? `${vehicle.make} ${vehicle.model}${vehicle.year ? ` (${vehicle.year})` : ''}`
                  : 'Complete vehicle details and history'
                }
              </DialogDescription>
            </div>
            {vehicle.total_breaches > 0 && (
              <Badge variant="destructive" className="px-3 py-1">
                {vehicle.total_breaches} Breach{vehicle.total_breaches !== 1 ? 'es' : ''}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Profile Photo */}
          {vehicle.profile_photo && (
            <div className="relative w-full h-48 bg-gray-100 rounded-lg overflow-hidden">
              <img 
                src={vehicle.profile_photo} 
                alt={`Vehicle ${vehicle.plate_number}`}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <Button size="sm" variant="secondary" className="bg-white/90 hover:bg-white">
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>
                <Button size="sm" variant="secondary" className="bg-white/90 hover:bg-white">
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              </div>
            </div>
          )}

          {/* Vehicle Information */}
          <Card>
            <CardContent className="pt-4">
              <h3 className="font-semibold text-lg mb-4">Vehicle Information</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Plate Number:</span>
                  <p className="font-mono font-bold text-lg">{vehicle.plate_number}</p>
                </div>
                {vehicle.make && (
                  <div>
                    <span className="text-gray-600">Make/Model:</span>
                    <p className="font-medium">{vehicle.make} {vehicle.model}</p>
                  </div>
                )}
                {vehicle.year && (
                  <div>
                    <span className="text-gray-600">Year:</span>
                    <p className="font-medium">{vehicle.year}</p>
                  </div>
                )}
                {vehicle.colour && (
                  <div>
                    <span className="text-gray-600">Colour:</span>
                    <p className="font-medium capitalize">{vehicle.colour}</p>
                  </div>
                )}
                <div>
                  <span className="text-gray-600">Self-Contained:</span>
                  <p className="font-medium flex items-center gap-2">
                    {vehicle.self_contained ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-green-600">Yes</span>
                        {vehicle.self_contained_expiry && (
                          <span className="text-xs text-gray-500">
                            (expires {formatDate(vehicle.self_contained_expiry)})
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-red-600" />
                        <span className="text-red-600">No</span>
                      </>
                    )}
                  </p>
                </div>
                {isHomelessForUi(vehicle.homeless_status) && (
                  <div>
                    <span className="text-gray-600">Homeless Status:</span>
                    <p className="font-medium">
                      <Badge variant="outline" className="bg-orange-50">
                        {homelessStatusLabel(vehicle.homeless_status)}
                      </Badge>
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Owner Information */}
          {(vehicle.owner_first_name || vehicle.owner_company_name) && (
            <Card>
              <CardContent className="pt-4">
                <h3 className="font-semibold text-lg mb-4">Owner Information</h3>
                <div className="space-y-2 text-sm">
                  {vehicle.owner_company_name && (
                    <div>
                      <span className="text-gray-600">Company:</span>
                      <p className="font-medium">{vehicle.owner_company_name}</p>
                    </div>
                  )}
                  {(vehicle.owner_first_name || vehicle.owner_last_name) && (
                    <div>
                      <span className="text-gray-600">Name:</span>
                      <p className="font-medium">
                        {vehicle.owner_first_name} {vehicle.owner_last_name}
                      </p>
                    </div>
                  )}
                  {vehicle.owner_address && (
                    <div>
                      <span className="text-gray-600">Address:</span>
                      <p className="font-medium">{vehicle.owner_address}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Activity Summary */}
          <Card>
            <CardContent className="pt-4">
              <h3 className="font-semibold text-lg mb-4">Activity Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {vehicle.total_observations}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">Observations</div>
                </div>
                <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">
                    {vehicle.total_breaches}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">Breaches</div>
                </div>
                <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {vehicle.total_incidents || 0}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">Incidents</div>
                </div>
                <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-sm text-gray-600">Last Seen</div>
                  <div className="text-xs font-medium text-green-600 mt-1">
                    {vehicle.last_seen_at ? formatDate(vehicle.last_seen_at) : 'Never'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Observations */}
          {observations.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h3 className="font-semibold text-lg mb-4">Recent Observations</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {observations.map((obs) => (
                    <div 
                      key={obs.id}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="font-medium">{obs.zone_name}</p>
                          <p className="text-xs text-gray-600">{formatDateTime(obs.recorded_at)}</p>
                        </div>
                      </div>
                      {obs.is_compliant ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Breaches */}
          {breaches.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h3 className="font-semibold text-lg mb-4">Breach History</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {breaches.map((breach) => (
                    <div 
                      key={breach.id}
                      className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                        <div>
                          <p className="font-medium capitalize">{breach.breach_type.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-gray-600">{formatDateTime(breach.detected_at)}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {breach.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Flagged Vehicle Warning */}
          {vehicle.is_flagged && (
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-900/20">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-orange-900 dark:text-orange-100">
                      Flagged Vehicle
                    </h3>
                    <p className="text-sm text-orange-700 dark:text-orange-200 mt-1">
                      {vehicle.flagged_reason || 'This vehicle has been flagged for attention'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled>
            <ExternalLink className="h-4 w-4 mr-2" />
            View Full Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
