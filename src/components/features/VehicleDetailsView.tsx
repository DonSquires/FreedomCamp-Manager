import { formatDate, formatDateTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Car, Shield, Calendar, Hash } from 'lucide-react'

interface VehicleDetailsViewProps {
  vehicle: {
    vehicle_id?: string
    plate_number: string
    vehicle_make?: string
    vehicle_model?: string
    vehicle_year?: string
    vehicle_color?: string
    is_self_contained?: boolean
    total_observations?: number
    total_breaches?: number
    last_seen?: string
    nzscv_certified?: boolean
    nzscv_expiry?: string
  }
  onEdit?: () => void
  className?: string
}

export function VehicleDetailsView({ vehicle, onEdit, className }: VehicleDetailsViewProps) {
  const isCompliant = !vehicle.total_breaches || vehicle.total_breaches === 0

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="flex items-center gap-2 text-xl font-bold">
            <Car className="h-5 w-5" />
            {vehicle.plate_number}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={vehicle.is_self_contained
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-gray-50 text-gray-600 border-gray-200'
              }
            >
              <Shield className="h-3 w-3 mr-1" />
              {vehicle.is_self_contained ? 'Self-Contained' : 'Not Self-Contained'}
            </Badge>
            <Badge
              variant="outline"
              className={isCompliant
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'
              }
            >
              {isCompliant ? 'Compliant' : `${vehicle.total_breaches} Breaches`}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Vehicle details grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Make</span>
            <p className="font-medium mt-0.5">{vehicle.vehicle_make || '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Model</span>
            <p className="font-medium mt-0.5">{vehicle.vehicle_model || '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Year</span>
            <p className="font-medium mt-0.5">{vehicle.vehicle_year ?? '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Colour</span>
            <p className="font-medium mt-0.5">{vehicle.vehicle_color || '—'}</p>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground flex items-center gap-1">
              <Hash className="h-3 w-3" />
              VIN
            </span>
            <p className="font-medium mt-0.5 font-mono text-xs">—</p>
          </div>
        </div>

        {/* NZSCV certification */}
        <div className="border-t pt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Shield className="h-3 w-3" />
              NZSCV Certified
            </span>
            <span className="font-medium">{vehicle.nzscv_certified ? 'Yes' : 'No'}</span>
          </div>
          {vehicle.nzscv_expiry && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                NZSCV Expiry
              </span>
              <span className="font-medium">
                {formatDate(vehicle.nzscv_expiry)}
              </span>
            </div>
          )}
        </div>

        {/* Activity stats */}
        <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
          <div>
            <span className="text-muted-foreground">Total Observations</span>
            <p className="font-medium text-lg mt-0.5">{vehicle.total_observations ?? 0}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Total Breaches</span>
            <p className={`font-medium text-lg mt-0.5 ${isCompliant ? 'text-green-600' : 'text-red-600'}`}>
              {vehicle.total_breaches ?? 0}
            </p>
          </div>
        </div>

        {vehicle.last_seen && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3">
            <Calendar className="h-3 w-3" />
            Last seen: {formatDateTime(vehicle.last_seen)}
          </div>
        )}

        {onEdit && (
          <Button variant="outline" className="w-full mt-2" onClick={onEdit}>
            Edit Vehicle
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
