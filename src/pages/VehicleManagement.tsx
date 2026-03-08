import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { LoadingSpinner } from '@/components/features/LoadingSpinner'
import { Search, Car, AlertTriangle, CheckCircle, Calendar, RefreshCw, Database, Globe } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { HOMELESS_UI_STATUSES, isHomelessForUi, normalizeHomelessStatus } from '@/lib/homelessStatus'
import { checkNZSCVCertification, enrichVehicleFromMotorWeb } from '@/lib/railwayServices'
import { toast } from 'sonner'

interface Vehicle {
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
  enforcement_count: number
  last_enforcement_at: string | null
  profile_photo: string | null
  total_observations: number
  total_breaches: number
}

type StatusFilter = 'all' | 'compliant' | 'breaches' | 'homeless' | 'exempt'

export default function VehicleManagement() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [checkingNZSCV, setCheckingNZSCV] = useState(false)
  const [enrichingMotorWeb, setEnrichingMotorWeb] = useState(false)
  const [scrapingSales, setScrapingSales] = useState(false)
  const [nzscvResult, setNzscvResult] = useState<any>(null)

  // Fetch vehicles
  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles', organizationId, zoneId, dateFrom, dateTo, statusFilter, searchQuery, user?.role, user?.organization_id],
    queryFn: async () => {
      const effectiveOrganizationId =
        organizationId || (user?.role !== 'master' ? user?.organization_id || null : null)

      let query = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('plate_number', { ascending: true })

      // Apply global org/zone/date filters via matching observations.
      if (effectiveOrganizationId || zoneId || dateFrom || dateTo) {
        let matchingObservationsQuery = supabase
          .from('observations')
          .select('plate_number')
          

        if (effectiveOrganizationId) {
          matchingObservationsQuery = matchingObservationsQuery.eq('organization_id', effectiveOrganizationId)
        }
        if (zoneId) {
          matchingObservationsQuery = matchingObservationsQuery.eq('zone_id', zoneId)
        }
        if (dateFrom) {
          matchingObservationsQuery = matchingObservationsQuery.gte('recorded_at', `${dateFrom}T00:00:00Z`)
        }
        if (dateTo) {
          matchingObservationsQuery = matchingObservationsQuery.lte('recorded_at', `${dateTo}T23:59:59Z`)
        }

        const { data: matchingObservations, error: matchingObsError } = await matchingObservationsQuery
        if (matchingObsError) throw matchingObsError

        const plateRows = (matchingObservations ?? []) as Array<{ plate_number: string | null }>
        const matchingPlates = [...new Set(plateRows.map((o) => o.plate_number).filter(Boolean) as string[])]

        if (matchingPlates.length === 0) {
          return [] as Vehicle[]
        }

        query = query.in('plate_number', matchingPlates)
      }

      if (searchQuery) {
        query = query.or(`plate_number.ilike.%${searchQuery}%,make.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%`)
      }

      if (statusFilter === 'compliant') {
        query = query.eq('total_breaches', 0)
      } else if (statusFilter === 'breaches') {
        query = query.gt('total_breaches', 0)
      } else if (statusFilter === 'homeless') {
        query = query.in('homeless_status', HOMELESS_UI_STATUSES)
      } else if (statusFilter === 'exempt') {
        query = query.eq('is_exempt', true)
      }

      const { data, error } = await query

      if (error) throw error
      return data as Vehicle[]
    },
  })

  const openDetails = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle)
    setShowDetailsDialog(true)
    setNzscvResult(null) // Reset NZSCV result when opening new vehicle
  }

  // Check NZSCV certification
  const handleCheckNZSCV = async (plateNumber: string) => {
    setCheckingNZSCV(true)
    try {
      const { data, error } = await checkNZSCVCertification(plateNumber)
      
      if (error) {
        toast.error(error)
        return
      }

      if (data) {
        setNzscvResult(data)
        toast.success(
          data.is_certified 
            ? `✓ Self-Contained Certification Found (${data.warrant_type})` 
            : 'No certification found'
        )
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to check NZSCV status')
    } finally {
      setCheckingNZSCV(false)
    }
  }

  // Enrich from MotorWeb
  const handleEnrichMotorWeb = async (plateNumber: string) => {
    setEnrichingMotorWeb(true)
    try {
      const { data, error } = await enrichVehicleFromMotorWeb(plateNumber)
      
      if (error) {
        toast.error(error)
        return
      }

      if (data) {
        // Update vehicle in database with enriched data using correct column names
        const { error: updateError } = await (supabase.from('canonical_vehicles') as any)
          .update({
            make: data.make,
            model: data.model,
            year: data.year,
            colour: data.colour,
            owner_first_name: data.owner_name?.split(' ')[0],
            owner_last_name: data.owner_name?.split(' ').slice(1).join(' '),
            owner_address: data.owner_address,
          })
          .eq('plate_number', plateNumber)

        if (updateError) {
          toast.error('Failed to update vehicle data')
          return
        }

        toast.success('Vehicle data enriched from MotorWeb')
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to enrich from MotorWeb')
    } finally {
      setEnrichingMotorWeb(false)
    }
  }

  // Scrape vehicle photos from NZ sales sites (Trade Me, cars.co.nz)
  const handleScrapeVehicle = async (plateNumber: string, forceUpdate = false) => {
    setScrapingSales(true)
    try {
      const { data, error } = await supabase.functions.invoke('scrape-vehicle-photos', {
        body: { plate_number: plateNumber, force_update: forceUpdate },
      })

      if (error) {
        toast.error(`Scrape failed: ${error.message}`)
        return
      }

      if (data?.skipped) {
        toast.info('Vehicle already has a profile photo. Use "Force Update" to replace it.')
        return
      }

      if (!data?.found) {
        toast.warning(`No listing found for ${plateNumber} on Trade Me or cars.co.nz`)
        return
      }

      toast.success(
        `Photo found on ${data.source === 'trademe' ? 'Trade Me' : 'cars.co.nz'} and saved to vehicle record`
      )

      // Refresh the query to show the updated profile photo
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      // Update the selected vehicle in state so the dialog reflects the new photo
      if (selectedVehicle?.plate_number === plateNumber && data.canonical_record) {
        setSelectedVehicle((prev) => ({ ...prev!, profile_photo: data.canonical_record.profile_photo }))
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to scrape vehicle sales sites')
    } finally {
      setScrapingSales(false)
    }
  }

  // Calculate stats
  const stats = vehicles ? {
    total: vehicles.length,
    compliant: vehicles.filter(v => v.total_breaches === 0).length,
    breaches: vehicles.filter(v => v.total_breaches > 0).length,
    selfContained: vehicles.filter(v => v.self_contained).length,
    homeless: vehicles.filter(v => isHomelessForUi(v.homeless_status)).length,
    exempt: vehicles.filter(v => v.is_exempt).length,
  } : null

  return (
    <AppLayout title="Vehicle Management" description="Search and manage vehicles" showBackButton>
      <GlobalFilterRibbon />

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600">Compliant</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.compliant}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600">Breaches</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.breaches}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600">Self-Contained</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.selfContained}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600">Homeless</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.homeless}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-600">Exempt</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{stats.exempt}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by plate number, make, or model..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                size="sm"
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'compliant' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('compliant')}
                size="sm"
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Compliant
              </Button>
              <Button
                variant={statusFilter === 'breaches' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('breaches')}
                size="sm"
              >
                <AlertTriangle className="h-4 w-4 mr-1" />
                Breaches
              </Button>
              <Button
                variant={statusFilter === 'homeless' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('homeless')}
                size="sm"
              >
                Homeless
              </Button>
              <Button
                variant={statusFilter === 'exempt' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('exempt')}
                size="sm"
              >
                Exempt
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vehicle Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading vehicles...</p>
        </div>
      ) : vehicles && vehicles.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Car className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No vehicles found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {vehicles?.map((vehicle) => (
            <Card
              key={vehicle.id}
              className="hover:shadow-lg transition-shadow overflow-hidden cursor-pointer"
              onClick={() => navigate(`/vehicles/${vehicle.id}`)}
            >
              {/* Vehicle Photo */}
              {vehicle.profile_photo ? (
                <div className="w-full h-40 bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <img
                    src={vehicle.profile_photo}
                    alt={vehicle.plate_number}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-full h-40 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Car className="h-16 w-16 text-gray-300 dark:text-gray-600" />
                </div>
              )}
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold">
                      {vehicle.plate_number}
                    </CardTitle>
                    <CardDescription>
                      {[vehicle.make, vehicle.model, vehicle.year && `(${vehicle.year})`].filter(Boolean).join(' ') || 'Details unknown'}
                    </CardDescription>
                  </div>
                  {vehicle.colour && (
                    <Badge variant="outline" className="text-xs shrink-0">{vehicle.colour}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Observations:</span>
                    <span className="font-medium">{vehicle.total_observations}</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Breaches:</span>
                    <span className={`font-medium ${vehicle.total_breaches > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {vehicle.total_breaches}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-3">
                    {vehicle.self_contained && (
                      <Badge variant="outline" className="text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Self-Contained
                      </Badge>
                    )}
                    {isHomelessForUi(vehicle.homeless_status) && (
                      <Badge variant="outline" className="text-xs bg-orange-50">
                        Homeless ({normalizeHomelessStatus(vehicle.homeless_status)})
                      </Badge>
                    )}
                    {vehicle.is_exempt && (
                      <Badge variant="outline" className="text-xs bg-purple-50">
                        Exempt
                      </Badge>
                    )}
                    {vehicle.total_breaches > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Active Breach
                      </Badge>
                    )}
                  </div>

                  <div className="pt-3 mt-3 border-t flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={(event) => {
                        event.stopPropagation()
                        openDetails(vehicle)
                      }}
                    >
                      Quick Tools
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      onClick={(event) => {
                        event.stopPropagation()
                        navigate(`/vehicles/${vehicle.id}`)
                      }}
                    >
                      Drill Down
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Vehicle Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {selectedVehicle?.plate_number}
            </DialogTitle>
            <DialogDescription>
              {[selectedVehicle?.make, selectedVehicle?.model, selectedVehicle?.year && `(${selectedVehicle.year})`].filter(Boolean).join(' ') || 'Vehicle details unknown'}
            </DialogDescription>
          </DialogHeader>

          {selectedVehicle && (
            <div className="space-y-6">
              {/* Profile Photo */}
              {selectedVehicle.profile_photo ? (
                <div className="rounded-lg overflow-hidden">
                  <img 
                    src={selectedVehicle.profile_photo} 
                    alt={selectedVehicle.plate_number}
                    className="w-full h-56 object-cover"
                  />
                </div>
              ) : (
                <div className="rounded-lg bg-gray-100 dark:bg-gray-800 h-32 flex items-center justify-center">
                  <Car className="h-16 w-16 text-gray-300 dark:text-gray-600" />
                  <span className="ml-3 text-sm text-gray-400">No photo available</span>
                </div>
              )}

              {/* Vehicle Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Colour</div>
                  <div className="font-medium">{selectedVehicle.colour || 'Unknown'}</div>
                </div>
                
                <div>
                  <div className="text-sm text-gray-600">Total Observations</div>
                  <div className="font-medium">{selectedVehicle.total_observations}</div>
                </div>
                
                <div>
                  <div className="text-sm text-gray-600">Total Breaches</div>
                  <div className={`font-medium ${selectedVehicle.total_breaches > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {selectedVehicle.total_breaches}
                  </div>
                </div>
                
                <div>
                  <div className="text-sm text-gray-600">Enforcement Actions</div>
                  <div className="font-medium">{selectedVehicle.enforcement_count}</div>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-2">
                {selectedVehicle.self_contained && (
                  <Badge variant="outline" className="bg-blue-50">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Self-Contained
                  </Badge>
                )}
                {selectedVehicle.self_contained_expiry && (
                  <Badge variant="outline">
                    <Calendar className="h-3 w-3 mr-1" />
                    Expires: {new Date(selectedVehicle.self_contained_expiry).toLocaleDateString()}
                  </Badge>
                )}
                {isHomelessForUi(selectedVehicle.homeless_status) && (
                  <Badge variant="outline" className="bg-orange-50">
                    Homeless ({normalizeHomelessStatus(selectedVehicle.homeless_status)})
                  </Badge>
                )}
                {selectedVehicle.is_exempt && (
                  <Badge variant="outline" className="bg-purple-50">
                    Exempt
                  </Badge>
                )}
                {selectedVehicle.total_breaches > 0 && (
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Active Breach
                  </Badge>
                )}
              </div>

              {/* Last Enforcement */}
              {selectedVehicle.last_enforcement_at && (
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="text-sm font-semibold mb-2">Last Enforcement</div>
                  <div className="text-sm text-gray-600">
                    {formatDateTime(selectedVehicle.last_enforcement_at)}
                  </div>
                </div>
              )}

              {/* Railway Integration: NZSCV Check */}
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">NZSCV Certification Check</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCheckNZSCV(selectedVehicle.plate_number)}
                    disabled={checkingNZSCV}
                  >
                    {checkingNZSCV ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Check Warrant
                      </>
                    )}
                  </Button>
                </div>

                {nzscvResult && (
                  <div className="text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">Status:</span>
                      <Badge variant={nzscvResult.is_certified ? "default" : "secondary"}>
                        {nzscvResult.is_certified ? 'Certified' : 'Not Certified'}
                      </Badge>
                    </div>
                    {nzscvResult.warrant_type && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Warrant Type:</span>
                        <Badge variant="outline">
                          {nzscvResult.warrant_type === 'green' ? '🟢 Green' : '🔵 Blue'}
                        </Badge>
                      </div>
                    )}
                    {nzscvResult.warrant_number && (
                      <div className="text-gray-600">
                        Warrant #: {nzscvResult.warrant_number}
                      </div>
                    )}
                    {nzscvResult.expires_on && (
                      <div className="text-gray-600">
                        Expires: {new Date(nzscvResult.expires_on).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Railway Integration: MotorWeb Enrichment */}
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">MotorWeb Data Enrichment</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEnrichMotorWeb(selectedVehicle.plate_number)}
                    disabled={enrichingMotorWeb}
                  >
                    {enrichingMotorWeb ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Enriching...
                      </>
                    ) : (
                      <>
                        <Database className="h-4 w-4 mr-2" />
                        Enrich Data
                      </>
                    )}
                  </Button>
                </div>
                <div className="text-xs text-gray-600 mt-2">
                  Pull vehicle details, owner info, and more from MotorWeb database
                </div>
              </div>

              {/* Scrape Vehicle Sales Sites */}
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Scrape Sales Sites</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleScrapeVehicle(selectedVehicle.plate_number, false)}
                      disabled={scrapingSales}
                    >
                      {scrapingSales ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Globe className="h-4 w-4 mr-2" />
                          Find Photo
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleScrapeVehicle(selectedVehicle.plate_number, true)}
                      disabled={scrapingSales}
                      title="Force update even if a photo already exists"
                    >
                      Force Update
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  Search Trade Me Motors and cars.co.nz for listings matching this plate.
                  Downloads the best available photo, stores it as the profile photo, and
                  enriches vehicle details from the listing. Also runs the photo through
                  the AI inference service if available.
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4 border-t">
                <Button variant="outline" className="flex-1" disabled>
                  View History
                </Button>
                <Button variant="outline" className="flex-1" disabled>
                  Create Notice
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setShowDetailsDialog(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
