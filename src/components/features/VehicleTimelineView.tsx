/**
 * VehicleTimelineView Component
 * Chronological observation history
 */

import { formatDate } from '@/lib/utils'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { 
  Calendar,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Filter,
  Eye,
  Car,
} from 'lucide-react'
import { getObservationPhotoUrl } from '@/lib/photoUtils'

interface VehicleTimelineViewProps {
  plateNumber: string
  limit?: number
  onViewDetails?: (observationId: string) => void
}

export function VehicleTimelineView({
  plateNumber,
  limit = 50,
  onViewDetails,
}: VehicleTimelineViewProps) {
  const [filter, setFilter] = useState<'all' | 'compliant' | 'breach'>('all')
  const [searchZone, setSearchZone] = useState('')

  // Fetch observations
  const { data: observations, isLoading } = useQuery({
    queryKey: ['vehicle-timeline', plateNumber, filter],
    queryFn: async () => {
      let query = (supabase.from('observations') as any)
        .select(`
          *,
          zones!vehicle_observations_v2_zone_id_fkey (
            name
          ),
          user_profiles!vehicle_observations_v2_recorded_by_fkey (
            first_name,
            last_name
          )
        `)
        .eq('plate_number', plateNumber)
        .order('recorded_at', { ascending: false })
        .limit(limit)

      if (filter === 'compliant') {
        query = query.eq('is_compliant', true)
      } else if (filter === 'breach') {
        query = query.eq('is_compliant', false)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
  })

  // Filter by zone search
  const filteredObservations = observations?.filter(obs => {
    if (!searchZone) return true
    return (obs.zones as any)?.name?.toLowerCase().includes(searchZone.toLowerCase())
  })

  const getStatusIcon = (isCompliant: boolean) => {
    return isCompliant ? (
      <CheckCircle2 className="h-5 w-5 text-green-600" />
    ) : (
      <XCircle className="h-5 w-5 text-red-600" />
    )
  }

  const getStatusBadge = (isCompliant: boolean, breachType?: string) => {
    if (isCompliant) {
      return (
        <Badge className="bg-green-600">
          Compliant
        </Badge>
      )
    }
    return (
      <Badge variant="destructive">
        {breachType || 'Breach'}
      </Badge>
    )
  }

  const formatDateTime = (date: string) => {
    const d = new Date(date)
    return {
      date: formatDate(date),
      time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Observation Timeline
            </CardTitle>
            <CardDescription className="mt-1">
              Complete history of all observations for {plateNumber}
            </CardDescription>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-4">
          <div className="flex-1">
            <Input
              placeholder="Filter by zone..."
              value={searchZone}
              onChange={(e) => setSearchZone(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={filter === 'compliant' ? 'default' : 'outline'}
              onClick={() => setFilter('compliant')}
            >
              Compliant
            </Button>
            <Button
              size="sm"
              variant={filter === 'breach' ? 'default' : 'outline'}
              onClick={() => setFilter('breach')}
            >
              Breaches
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading timeline...
          </div>
        ) : filteredObservations && filteredObservations.length > 0 ? (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

            {/* Timeline items */}
            <div className="space-y-6">
              {filteredObservations.map((obs) => {
                const { date, time } = formatDateTime(obs.recorded_at)
                
                return (
                  <div key={obs.id} className="relative flex gap-4">
                    {/* Timeline dot */}
                    <div className="relative flex-shrink-0 w-12 flex justify-center">
                      <div className="absolute top-2">
                        {getStatusIcon(obs.is_compliant)}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-6">
                      <Card>
                        <CardContent className="pt-4">
                          {/* Header */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium">{date}</span>
                                <span className="text-muted-foreground">•</span>
                                <span className="text-muted-foreground">{time}</span>
                                {getStatusBadge(obs.is_compliant, obs.breach_type)}
                              </div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span>{(obs.zones as any)?.name || 'Unknown Zone'}</span>
                              </div>
                            </div>
                            {onViewDetails && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onViewDetails(obs.id)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          {/* Photo */}
                          {getObservationPhotoUrl(obs as any) ? (
                            <img
                              src={getObservationPhotoUrl(obs as any)!}
                              alt="Observation"
                              className="w-full h-32 object-cover rounded mb-3"
                            />
                          ) : (
                            <div className="w-full h-32 rounded mb-3 bg-muted flex items-center justify-center">
                              <Car className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                          )}

                          {/* Details */}
                          <div className="space-y-2 text-sm">
                            {/* Officer */}
                            {(obs.user_profiles as any)?.first_name && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">Officer:</span>
                                <span>
                                  {(obs.user_profiles as any).first_name}{' '}
                                  {(obs.user_profiles as any).last_name}
                                </span>
                              </div>
                            )}

                            {/* Location */}
                            {obs.gps_latitude && obs.gps_longitude && (
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">GPS:</span>
                                <span>
                                  {obs.gps_latitude.toFixed(6)}, {obs.gps_longitude.toFixed(6)}
                                </span>
                              </div>
                            )}

                            {/* Breach details */}
                            {!obs.is_compliant && obs.breach_reason && (
                              <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                                  <div>
                                    <div className="font-medium text-red-900 dark:text-red-100">
                                      {obs.breach_type}
                                    </div>
                                    <div className="text-sm text-red-800 dark:text-red-200 mt-1">
                                      {obs.breach_reason}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Notes */}
                            {obs.officer_notes && (
                              <div className="p-2 bg-muted rounded">
                                <div className="text-xs text-muted-foreground mb-1">Officer Notes</div>
                                <div>{obs.officer_notes}</div>
                              </div>
                            )}

                            {/* Monthly stays info */}
                            {obs.nights_stayed_this_month > 0 && (
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span>Nights this month: {obs.nights_stayed_this_month}</span>
                                <span>Consecutive: {obs.consecutive_nights}</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>
              {searchZone
                ? `No observations in zones matching "${searchZone}"`
                : 'No observations recorded'}
            </p>
          </div>
        )}

        {/* Count */}
        {filteredObservations && filteredObservations.length > 0 && (
          <div className="mt-4 text-sm text-center text-muted-foreground border-t pt-4">
            Showing {filteredObservations.length} of {observations?.length || 0} observations
            {filteredObservations.length >= limit && ' (limited to most recent)'}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
