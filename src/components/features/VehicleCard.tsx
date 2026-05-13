import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Car, MapPin, Calendar, AlertTriangle, Shield, Eye } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'
import { homelessStatusLabel, isHomelessForUi } from '@/lib/homelessStatus'
import type { Vehicle } from '@/types'

interface VehicleCardProps {
  vehicle: Vehicle
  onViewDetails?: (vehicleId: string) => void
  showActions?: boolean
}

export function VehicleCard({ vehicle, onViewDetails, showActions = true }: VehicleCardProps) {
  const isVehicleHomeless = isHomelessForUi(vehicle.homeless_status)
  const complianceStatus = vehicle.total_breaches === 0 || isVehicleHomeless ? 'compliant' : 'breach'
  
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Car className="h-5 w-5" />
              {vehicle.plate_number}
            </CardTitle>
            <CardDescription className="mt-1">
              {vehicle.vehicle_make && vehicle.vehicle_model 
                ? `${vehicle.vehicle_make} ${vehicle.vehicle_model}${vehicle.vehicle_year ? ` (${vehicle.vehicle_year})` : ''}`
                : 'Vehicle details unknown'
              }
            </CardDescription>
          </div>
          
          <Badge 
            variant="outline" 
            className={
              isVehicleHomeless
                ? 'bg-purple-50 text-purple-700 border-purple-200'
                : complianceStatus === 'compliant' 
                ? 'bg-green-50 text-green-700 border-green-200' 
                : 'bg-red-50 text-red-700 border-red-200'
            }
          >
            {isVehicleHomeless
              ? 'FC Act Exempt'
              : complianceStatus === 'compliant' ? 'Compliant' : `${vehicle.total_breaches} Breaches`
            }
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {/* Profile Photo */}
          {vehicle.profile_photo && (
            <div className="relative w-full h-32 bg-gray-100 rounded-lg overflow-hidden">
              <img 
                src={vehicle.profile_photo} 
                alt={`Vehicle ${vehicle.plate_number}`}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Vehicle Details */}
          <div className="bg-gray-50 dark:bg-[#1E1E1E] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Self-Contained:
              </span>
              <span className="font-medium">
                {vehicle.self_contained 
                  ? (vehicle.self_contained_expiry 
                      ? `Yes (expires ${formatDate(vehicle.self_contained_expiry)})` 
                      : 'Yes'
                    )
                  : 'No'
                }
              </span>
            </div>

            {isHomelessForUi(vehicle.homeless_status) && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Homeless Status:</span>
                <Badge variant="outline" className="text-xs bg-orange-50">
                  {homelessStatusLabel(vehicle.homeless_status)}
                </Badge>
              </div>
            )}

            {vehicle.is_exempt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Exempt:</span>
                <Badge variant="outline" className="text-xs bg-blue-50">
                  Exempt
                </Badge>
              </div>
            )}
          </div>

          {/* Activity Stats */}
          <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t">
            <div className="flex flex-col">
              <span className="text-gray-600">Total Observations</span>
              <span className="font-medium text-lg">{vehicle.total_observations}</span>
            </div>
            
            <div className="flex flex-col">
              <span className="text-gray-600">{isVehicleHomeless ? 'Homeless' : 'Total Breaches'}</span>
              {isVehicleHomeless ? (
                <span className="font-medium text-lg text-purple-600">Exempt</span>
              ) : (
                <span className={`font-medium text-lg ${vehicle.total_breaches > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {vehicle.total_breaches}
                </span>
              )}
            </div>
          </div>

          {vehicle.last_enforcement_at && (
            <div className="flex items-center gap-2 text-xs text-gray-500 pt-2 border-t">
              <Calendar className="h-3 w-3" />
              Last enforcement: {formatDateTime(vehicle.last_enforcement_at)}
            </div>
          )}

          {/* Actions */}
          {showActions && onViewDetails && (
            <Button 
              variant="outline" 
              className="w-full mt-3"
              onClick={() => onViewDetails(vehicle.vehicle_id)}
            >
              <Eye className="h-4 w-4 mr-2" />
              View Full Details
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
