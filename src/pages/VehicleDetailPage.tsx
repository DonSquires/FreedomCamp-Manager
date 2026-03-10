import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Car,
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  MapPin,
  Calendar,
  Shield,
  Globe,
  Image as ImageIcon,
  FileText,
  TrendingUp,
  Star,
  Flag,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { checkNZSCVCertification, enrichVehicleFromMotorWeb } from '@/lib/railwayServices'
import { getObservationPhotoUrl, getVehiclePhotoUrl } from '@/lib/photoUtils'
import { PhotoWithFallback } from '@/components/features/PhotoWithFallback'
import { VehiclePhotoGallery } from '@/components/features/VehiclePhotoGallery'

interface CanonicalVehicle {
  id: string
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
  colour: string | null
  self_contained: boolean
  self_contained_expiry: string | null
  homeless_status: string | null
  is_exempt: boolean
  is_flagged: boolean
  enforcement_count: number
  last_enforcement_at: string | null
  profile_photo: string | null
  total_observations: number
  total_breaches: number
  created_at: string
  updated_at: string
}

interface Observation {
  id: string
  recorded_at: string
  gps_latitude: number | null
  gps_longitude: number | null
  photo_url: string | null
  is_compliant: boolean | null
  sticker_presence: boolean | null
  plate_confidence: number | null
  processing_status: string | null
  nights_in_zone: number | null
  zone: { name: string } | null
  recorded_by_user: { first_name: string; last_name: string } | null
}

interface BreachAlert {
  id: string
  breach_type: string
  status: string
  created_at: string
  resolved_at: string | null
  zone: { name: string } | null
}

interface EnforcementAction {
  id: string
  action_type: string
  status: string
  notes: string | null
  created_at: string
  user_profile: { first_name: string; last_name: string } | null
}

const toTitleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const effectiveOrganizationId =
    organizationId || (user?.role !== 'master' ? user?.organization_id || null : null)
  const startDate = dateFrom ? `${dateFrom}T00:00:00Z` : null
  const endDate = dateTo ? `${dateTo}T23:59:59Z` : null

  // Fetch vehicle
  const { data: vehicle, isLoading: loadingVehicle, error: vehicleError, refetch: refetchVehicle } = useQuery({
    queryKey: ['vehicle-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as CanonicalVehicle
    },
    enabled: !!id,
    retry: 1,
    staleTime: 30000,
  })

  // Fetch observations
  const { data: observations = [], isLoading: loadingObs } = useQuery({
    queryKey: ['vehicle-observations', vehicle?.plate_number, organizationId, user?.role, user?.organization_id],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select(`
          id:observation_id, recorded_at, gps_latitude, gps_longitude, photo_url, is_compliant,
          sticker_presence, plate_confidence, processing_status, nights_in_zone,
          zone:zones!zone_id(name),
          recorded_by_user:user_profiles!recorded_by(first_name, last_name)
        `)
        .eq('plate_number', vehicle!.plate_number)
        
        .order('recorded_at', { ascending: false })

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as unknown as Observation[]
    },
    enabled: !!vehicle?.plate_number,
  })

  // Fetch breach alerts
  const { data: breaches = [], isLoading: loadingBreaches } = useQuery({
    queryKey: ['vehicle-breaches', vehicle?.plate_number, effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          id, breach_type, status, created_at, resolved_at,
          zone:zones!zone_id(name)
        `)
        .eq('plate_number', vehicle!.plate_number)
        .order('created_at', { ascending: false })
        .limit(50)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }
      if (startDate) {
        query = query.gte('created_at', startDate)
      }
      if (endDate) {
        query = query.lte('created_at', endDate)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as unknown as BreachAlert[]
    },
    enabled: !!vehicle?.plate_number,
  })

  // Fetch enforcement actions
  const { data: actions = [], isLoading: loadingActions } = useQuery({
    queryKey: ['vehicle-actions', vehicle?.plate_number, effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('enforcement_actions')
        .select(`
          id, action_type, status, notes, created_at,
          user_profile:user_profiles!user_id(first_name, last_name)
        `)
        .eq('plate_number', vehicle!.plate_number)
        .order('created_at', { ascending: false })
        .limit(50)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }
      if (startDate) {
        query = query.gte('created_at', startDate)
      }
      if (endDate) {
        query = query.lte('created_at', endDate)
      }

      const { data, error } = await query
      if (error) throw error
      return (data || []) as unknown as EnforcementAction[]
    },
    enabled: !!vehicle?.plate_number,
  })

  // Toggle flagged
  const toggleFlagged = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — supabase Update type mismatch (pre-existing codebase issue)
      const { error } = await (supabase.from('canonical_vehicles') as any)
        .update({ is_flagged: !vehicle!.is_flagged })
        .eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(vehicle?.is_flagged ? 'Vehicle unflagged' : 'Vehicle flagged')
      queryClient.invalidateQueries({ queryKey: ['vehicle-detail', id] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const [checkingNZSCV, setCheckingNZSCV] = useState(false)
  const [nzscvResult, setNzscvResult] = useState<any>(null)
  const [enriching, setEnriching] = useState(false)

  const handleNZSCVCheck = async () => {
    if (!vehicle?.plate_number) return
    setCheckingNZSCV(true)
    try {
      const result = await checkNZSCVCertification(vehicle.plate_number)
      setNzscvResult(result)
      toast.success('NZSCV check complete')
    } catch (err: any) {
      toast.error(err.message || 'NZSCV check failed')
    } finally {
      setCheckingNZSCV(false)
    }
  }

  const handleEnrichMotorWeb = async () => {
    if (!vehicle?.plate_number) return
    setEnriching(true)
    try {
      await enrichVehicleFromMotorWeb(vehicle.plate_number)
      toast.success('Vehicle enriched from MotorWeb')
      queryClient.invalidateQueries({ queryKey: ['vehicle-detail', id] })
    } catch (err: any) {
      toast.error(err.message || 'MotorWeb enrichment failed')
    } finally {
      setEnriching(false)
    }
  }

  if (loadingVehicle) {
    return (
      <AppLayout title="Vehicle Detail">
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          <p className="text-sm text-muted-foreground">Loading vehicle details…</p>
        </div>
      </AppLayout>
    )
  }

  if (vehicleError) {
    return (
      <AppLayout title="Vehicle Detail">
        <div className="text-center py-24">
          <AlertTriangle className="h-16 w-16 mx-auto text-destructive/60 mb-4" />
          <p className="text-xl font-semibold">Failed to load vehicle</p>
          <p className="text-sm text-muted-foreground mt-2 mb-6 max-w-md mx-auto">
            {vehicleError instanceof Error ? vehicleError.message : 'An unexpected error occurred. Please try again.'}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => refetchVehicle()}>
              Retry
            </Button>
            <Button variant="outline" onClick={() => navigate('/vehicles')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Vehicles
            </Button>
          </div>
        </div>
      </AppLayout>
    )
  }

  if (!vehicle) {
    return (
      <AppLayout title="Vehicle Not Found">
        <div className="text-center py-24">
          <Car className="h-16 w-16 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-xl font-semibold">Vehicle not found</p>
          <Button className="mt-4" onClick={() => navigate('/vehicles')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Vehicles
          </Button>
        </div>
      </AppLayout>
    )
  }

  const complianceRate = observations.length > 0
    ? Math.round((observations.filter(o => o.is_compliant === true).length / observations.length) * 100)
    : null

  const activeBreaches = breaches.filter(b =>
    ['pending', 'acknowledged', 'enforcement_started'].includes(b.status)
  )
  const latestObservationPhoto = getObservationPhotoUrl(observations[0] as any)
  const vehicleDisplayPhoto = getVehiclePhotoUrl(vehicle, latestObservationPhoto)

  return (
    <AppLayout
      title={vehicle.plate_number}
      description={`${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.year || ''} · ${vehicle.colour || ''}`}
    >
      {/* Back + actions */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <Button variant="ghost" onClick={() => navigate('/vehicles')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Vehicles
        </Button>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleFlagged.mutate()}
            disabled={toggleFlagged.isPending}
          >
            <Flag className={`h-3.5 w-3.5 mr-1 ${vehicle.is_flagged ? 'fill-red-500 text-red-500' : ''}`} />
            {vehicle.is_flagged ? 'Unflag' : 'Flag Vehicle'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNZSCVCheck}
            disabled={checkingNZSCV}
          >
            <Globe className="h-3.5 w-3.5 mr-1" />
            {checkingNZSCV ? 'Checking…' : 'NZSCV Check'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEnrichMotorWeb}
            disabled={enriching}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            {enriching ? 'Enriching…' : 'MotorWeb Enrich'}
          </Button>
        </div>
      </div>

      {/* Hero card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card className="md:col-span-2">
          <CardContent className="p-6">
            <div className="flex gap-4 items-start">
              <div className="w-28 h-20 rounded-lg border overflow-hidden shrink-0">
                <PhotoWithFallback
                  src={vehicleDisplayPhoto}
                  alt={vehicle.plate_number}
                  className="w-full h-full object-cover"
                  placeholderClassName="w-full h-full"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-3xl font-mono font-bold">{vehicle.plate_number}</h1>
                  {vehicle.is_flagged && <Badge variant="destructive">Flagged</Badge>}
                  {vehicle.is_exempt && <Badge variant="secondary">Exempt</Badge>}
                  {vehicle.self_contained ? (
                    <Badge className="bg-green-600">Self Contained</Badge>
                  ) : (
                    <Badge variant="outline">Not Self Contained</Badge>
                  )}
                  {vehicle.homeless_status === 'confirmed' && (
                    <Badge variant="secondary">Homeless</Badge>
                  )}
                </div>
                <div className="mt-2 text-muted-foreground">
                  {[vehicle.make, vehicle.model, vehicle.year, vehicle.colour].filter(Boolean).join(' · ')}
                </div>
                {vehicle.self_contained_expiry && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    SC Expires: {vehicle.self_contained_expiry}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-1 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{vehicle.total_observations}</div>
                  <div className="text-xs text-muted-foreground">Observations</div>
                </div>
                <TrendingUp className="h-5 w-5 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-red-600">{vehicle.total_breaches}</div>
                  <div className="text-xs text-muted-foreground">Breaches</div>
                </div>
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
            </CardContent>
          </Card>
          {complianceRate !== null && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`text-2xl font-bold ${complianceRate >= 80 ? 'text-green-600' : 'text-orange-600'}`}>
                      {complianceRate}%
                    </div>
                    <div className="text-xs text-muted-foreground">Compliance Rate</div>
                  </div>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* NZSCV result */}
      {nzscvResult && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4" />
              NZSCV Certification Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">
              {JSON.stringify(nzscvResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="observations">
        <TabsList>
          <TabsTrigger value="observations">
            Observations ({observations.length})
          </TabsTrigger>
          <TabsTrigger value="breaches">
            Breaches {activeBreaches.length > 0 && `(${activeBreaches.length} active)`}
          </TabsTrigger>
          <TabsTrigger value="enforcement">
            Enforcement ({actions.length})
          </TabsTrigger>
          <TabsTrigger value="photos">
            Photos
          </TabsTrigger>
        </TabsList>

        {/* Observations */}
        <TabsContent value="observations" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Showing all recorded observations for this vehicle.
          </p>
          {loadingObs ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : observations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No observations recorded</div>
          ) : (
            observations.map(obs => (
              <Card key={obs.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="w-16 h-12 rounded border overflow-hidden shrink-0">
                      <PhotoWithFallback
                        src={getObservationPhotoUrl(obs as any)}
                        alt="Observation"
                        className="w-full h-full object-cover"
                        placeholderClassName="w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {obs.is_compliant === true && <Badge className="bg-green-600 text-xs">Compliant</Badge>}
                        {obs.is_compliant === false && <Badge variant="destructive" className="text-xs">Breach</Badge>}
                        {obs.is_compliant === null && <Badge variant="secondary" className="text-xs">Pending</Badge>}
                        {obs.sticker_presence === true && <Badge variant="secondary" className="text-xs">Sticker ✓</Badge>}
                        {obs.sticker_presence === false && <Badge variant="outline" className="text-xs">No Sticker</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground flex flex-wrap gap-3">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDateTime(obs.recorded_at)}
                        </span>
                        {obs.zone && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {obs.zone.name}
                          </span>
                        )}
                        {obs.nights_in_zone != null && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Night {obs.nights_in_zone}
                          </span>
                        )}
                        {obs.recorded_by_user && (
                          <span>
                            By {obs.recorded_by_user.first_name} {obs.recorded_by_user.last_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Breaches */}
        <TabsContent value="breaches" className="mt-4 space-y-2">
          {loadingBreaches ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : breaches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No breach alerts</div>
          ) : (
            breaches.map(breach => {
              const isActive = ['pending', 'acknowledged', 'enforcement_started'].includes(breach.status)
              return (
                <Card key={breach.id} className={isActive ? 'border-orange-300' : ''}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={`h-4 w-4 ${isActive ? 'text-orange-500' : 'text-muted-foreground'}`} />
                          <span className="font-semibold text-sm">{toTitleCase(breach.breach_type)}</span>
                          <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs capitalize">
                            {breach.status.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground flex gap-3">
                          {breach.zone && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{breach.zone.name}</span>}
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDateTime(breach.created_at)}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/breaches?id=${breach.id}`)}
                      >
                        View
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>

        {/* Enforcement */}
        <TabsContent value="enforcement" className="mt-4 space-y-2">
          {loadingActions ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : actions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No enforcement actions recorded</div>
          ) : (
            actions.map(action => (
              <Card key={action.id}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold text-sm">{toTitleCase(action.action_type)}</span>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {action.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      {action.notes && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{action.notes}</p>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(action.created_at)}
                        {action.user_profile && ` · By ${action.user_profile.first_name} ${action.user_profile.last_name}`}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Photos */}
        <TabsContent value="photos" className="mt-4">
          <VehiclePhotoGallery plateNumber={vehicle.plate_number} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}

