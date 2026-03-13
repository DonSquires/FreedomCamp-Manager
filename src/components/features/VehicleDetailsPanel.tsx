/**
 * VehicleDetailsPanel Component
 * Comprehensive vehicle profile with all details
 */

import { formatDate as formatDateUtil } from '@/lib/utils'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { 
  Car, 
  Calendar,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Flag,
  User,
  Home,
  FileText,
  ExternalLink,
  Edit,
  BarChart3,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Database } from '@/types/database'
import { homelessStatusLabel, isHomelessForUi, normalizeHomelessStatus } from '@/lib/homelessStatus'
import { getVehiclePhotoUrl, getObservationPhotoUrl } from '@/lib/photoUtils'
import { PhotoWithFallback } from '@/components/features/PhotoWithFallback'

type CanonicalVehicle = Database['public']['Tables']['canonical_vehicles']['Row']

type CanonicalVehicleWithFlaggedBy = CanonicalVehicle & {
  user_profiles: { first_name: string; last_name: string } | null
}

interface VehicleDetailsPanelProps {
  plateNumber: string
  onEdit?: () => void
  showActions?: boolean
}

export function VehicleDetailsPanel({
  plateNumber,
  onEdit,
  showActions = true,
}: VehicleDetailsPanelProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  // Fetch vehicle details
  const { data: vehicle, isLoading } = useQuery({
    queryKey: ['vehicle-details', plateNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select(`
          *,
          user_profiles!canonical_vehicles_flagged_by_fkey1 (
            first_name,
            last_name
          )
        `)
        .eq('plate_number', plateNumber)
        .single()

      if (error) throw error
      return data as CanonicalVehicleWithFlaggedBy
    },
  })

  const { data: latestObservationPhoto } = useQuery({
    queryKey: ['vehicle-latest-photo', plateNumber],
    queryFn: async () => {
      const { data, error } = await (supabase.from('observations') as any)
        .select('photo_url, recorded_at')
        .eq('plate_number', plateNumber)
        .not('photo_url', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return getObservationPhotoUrl(data)
    },
    enabled: !!plateNumber,
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading vehicle details...</div>
        </CardContent>
      </Card>
    )
  }

  if (!vehicle) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Vehicle not found</div>
        </CardContent>
      </Card>
    )
  }

  const displayPhoto = getVehiclePhotoUrl(vehicle, latestObservationPhoto)

  const formatDate = (date: string | null) => {
    if (!date) return 'N/A'
    return formatDateUtil(date)
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <CardTitle className="text-3xl font-bold">{vehicle.plate_number}</CardTitle>
                {vehicle.is_flagged && (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <Flag className="h-3 w-3" />
                    Flagged
                  </Badge>
                )}
                {vehicle.is_exempt && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Exempt
                  </Badge>
                )}
              </div>
              <CardDescription>
                {vehicle.vehicle_make && vehicle.vehicle_model ? (
                  <span className="text-base">
                    {vehicle.vehicle_year ? `${vehicle.vehicle_year} ` : ''}
                    {vehicle.vehicle_make} {vehicle.vehicle_model}
                    {vehicle.vehicle_color ? ` • ${vehicle.vehicle_color}` : ''}
                  </span>
                ) : (
                  'Vehicle details pending'
                )}
              </CardDescription>
            </div>
            {showActions && onEdit && (
              <Button variant="outline" onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>

        {/* Profile Photo */}
        {displayPhoto && (
          <CardContent>
            <PhotoWithFallback
              src={displayPhoto}
              alt={vehicle.plate_number}
              className="w-full h-48 object-cover rounded-lg"
              placeholderClassName="w-full h-48 rounded-lg"
            />
            {vehicle.profile_photo_selected_at && (
              <div className="text-xs text-muted-foreground mt-2">
                Profile photo selected {formatDate(vehicle.profile_photo_selected_at)}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Vehicle Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Vehicle Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Make</div>
              <div>{vehicle.vehicle_make || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Model</div>
              <div>{vehicle.vehicle_model || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Year</div>
              <div>{vehicle.vehicle_year || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Colour</div>
              <div>{vehicle.vehicle_color || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Self-Contained</div>
              <div className="flex items-center gap-2">
                {vehicle.self_contained ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span>Yes</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <span>No</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Self-Contained Certificate */}
          {vehicle.self_contained && (
            <div className="pt-3 border-t">
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Self-Contained Certificate
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Warrant Type</div>
                  <div className="text-sm">{vehicle.nzscv_warrant_type || 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Expires</div>
                  <div className="text-sm">
                    {vehicle.self_contained_expiry ? (
                      <span className={
                        new Date(vehicle.self_contained_expiry) < new Date()
                          ? 'text-red-600 font-medium'
                          : ''
                      }>
                        {formatDate(vehicle.self_contained_expiry)}
                      </span>
                    ) : (
                      'Unknown'
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Last Checked</div>
                  <div className="text-sm">{formatDate(vehicle.nzscv_last_checked)}</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Owner Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Owner Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Owner Name</div>
              <div>
                {vehicle.owner_first_name && vehicle.owner_last_name
                  ? `${vehicle.owner_first_name} ${vehicle.owner_last_name}`
                  : vehicle.owner_company_name || 'Unknown'}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Company</div>
              <div>{vehicle.owner_company_name || 'N/A'}</div>
            </div>
          </div>

          {vehicle.owner_address && (
            <div className="pt-3 border-t">
              <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                <Home className="h-4 w-4" />
                Address
              </div>
              <div className="flex items-start gap-2">
                <div className="flex-1">{vehicle.owner_address}</div>
                {vehicle.owner_address_verified && (
                  <Badge variant="secondary" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Verified
                  </Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Homeless Status */}
      {isHomelessForUi(vehicle.homeless_status) && (
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Homeless Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Status</div>
                <Badge variant={normalizeHomelessStatus(vehicle.homeless_status) === 'confirmed' ? 'destructive' : 'secondary'}>
                  {homelessStatusLabel(vehicle.homeless_status)}
                </Badge>
              </div>
              {vehicle.homeless_confirmed_at && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Confirmed Date</div>
                  <div>{formatDate(vehicle.homeless_confirmed_at)}</div>
                </div>
              )}
            </div>
            {vehicle.homeless_notes && (
              <div className="pt-3 border-t">
                <div className="text-sm font-medium text-muted-foreground mb-1">Notes</div>
                <div className="text-sm">{vehicle.homeless_notes}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Flagged Status */}
      {vehicle.is_flagged && (
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <Flag className="h-5 w-5" />
              Flagged Vehicle
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Priority</div>
                <Badge variant={vehicle.flagged_priority === 'high' ? 'destructive' : 'default'}>
                  {vehicle.flagged_priority}
                </Badge>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Flagged Date</div>
                <div>{formatDate(vehicle.flagged_at)}</div>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Reason</div>
              <div className="text-sm">{vehicle.flagged_reason || 'No reason provided'}</div>
            </div>
            {vehicle.flagged_notes && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Notes</div>
                <div className="text-sm">{vehicle.flagged_notes}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Activity Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Activity Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{vehicle.total_observations || 0}</div>
              <div className="text-sm text-muted-foreground">Observations</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{vehicle.total_breaches || 0}</div>
              <div className="text-sm text-muted-foreground">Breaches</div>
            </div>
            <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <div className="text-2xl font-bold text-red-600">{vehicle.total_incidents || 0}</div>
              <div className="text-sm text-muted-foreground">Incidents</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{vehicle.enforcement_count || 0}</div>
              <div className="text-sm text-muted-foreground">Enforcements</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">First Seen</div>
              <div>{formatDate(vehicle.first_seen_at)}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Last Seen</div>
              <div>{formatDate(vehicle.last_seen_at)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes Summary */}
      {vehicle.total_notes > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Notes ({vehicle.total_notes})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vehicle.last_note_preview && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm">{vehicle.last_note_preview}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  Last note: {formatDate(vehicle.last_note_at)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
