import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { Search, Car, AlertTriangle, CheckCircle, Calendar, RefreshCw, Database } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
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

export default function VehicleManagement() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'compliant' | 'breaches'>('all')
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [checkingNZSCV, setCheckingNZSCV] = useState(false)
  const [enrichingMotorWeb, setEnrichingMotorWeb] = useState(false)
  const [nzscvResult, setNzscvResult] = useState<any>(null)

  // Fetch vehicles
  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles', organizationId, statusFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('plate_number', { ascending: true })

      if (searchQuery) {
        query = query.or(`plate_number.ilike.%${searchQuery}%,make.ilike.%${searchQuery}%,model.ilike.%${searchQuery}%`)
      }

      if (statusFilter === 'compliant') {
        query = query.eq('total_breaches', 0)
      } else if (statusFilter === 'breaches') {
        query = query.gt('total_breaches', 0)
      }

      const { data, error } = await query.limit(100)
      
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
        // Update vehicle in database with enriched data
        const { error: updateError } = await supabase
          .from('canonical_vehicles')
          .update({
            make: data.make,
            model: data.model,
            year: data.year,
            colour: data.colour,
            body_style: data.body_style,
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
        // Refresh the vehicles list
        // You may want to invalidate the query here
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to enrich from MotorWeb')
    } finally {
      setEnrichingMotorWeb(false)
    }
  }

  // Calculate stats
  const stats = vehicles ? {
    total: vehicles.length,
    compliant: vehicles.filter(v => v.total_breaches === 0).length,
    breaches: vehicles.filter(v => v.total_breaches > 0).length,
    selfContained: vehicles.filter(v => v.self_contained).length,
    homeless: vehicles.filter(v => v.homeless_status === 'confirmed' || v.homeless_status === 'likely').length,
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
            <Card key={vehicle.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold">
                      {vehicle.plate_number}
                    </CardTitle>
                    <CardDescription>
                      {vehicle.make} {vehicle.model} {vehicle.year && `(${vehicle.year})`}
                    </CardDescription>
                  </div>
                  {vehicle.profile_photo && (
                    <img 
                      src={vehicle.profile_photo} 
                      alt={vehicle.plate_number}
                      className="w-16 h-16 object-cover rounded"
                    />
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
                    {vehicle.homeless_status && vehicle.homeless_status !== 'none' && (
                      <Badge variant="outline" className="text-xs bg-orange-50">
                        Homeless
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

                  <div className="pt-3 mt-3 border-t">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={() => openDetails(vehicle)}
                    >
                      View Details
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
              {selectedVehicle?.make} {selectedVehicle?.model} {selectedVehicle?.year && `(${selectedVehicle.year})`}
            </DialogDescription>
          </DialogHeader>

          {selectedVehicle && (
            <div className="space-y-6">
              {/* Profile Photo */}
              {selectedVehicle.profile_photo && (
                <div className="rounded-lg overflow-hidden">
                  <img 
                    src={selectedVehicle.profile_photo} 
                    alt={selectedVehicle.plate_number}
                    className="w-full h-auto object-cover"
                  />
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
                {selectedVehicle.homeless_status && selectedVehicle.homeless_status !== 'none' && (
                  <Badge variant="outline" className="bg-orange-50">
                    Homeless ({selectedVehicle.homeless_status})
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
