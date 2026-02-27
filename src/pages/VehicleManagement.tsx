import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AppLayout } from '@/components/features/AppLayout'
import { Search, Filter, Car, AlertTriangle, CheckCircle, Download } from 'lucide-react'

interface Vehicle {
  id: string
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
  colour: string | null
  is_self_contained: boolean
  self_contained_expiry: string | null
  is_homeless: boolean
  fc_act_exempt: boolean
  enforcement_count: number
  last_enforcement_at: string | null
  profile_photo_url: string | null
  total_observations: number
  total_breaches: number
}

export default function VehicleManagement() {
  const { user } = useAuthStore()
  const { organizationId, zoneName } = useGlobalFiltersStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'compliant' | 'breaches'>('all')

  // Fetch vehicles
  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles', organizationId, statusFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('plate_number', { ascending: true })

      if (organizationId && user?.role !== 'master') {
        query = query.eq('organization_id', organizationId)
      }

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

  // Calculate stats
  const stats = vehicles ? {
    total: vehicles.length,
    compliant: vehicles.filter(v => v.total_breaches === 0).length,
    breaches: vehicles.filter(v => v.total_breaches > 0).length,
    selfContained: vehicles.filter(v => v.is_self_contained).length,
    homeless: vehicles.filter(v => v.is_homeless).length,
    exempt: vehicles.filter(v => v.fc_act_exempt).length,
  } : null

  return (
    <AppLayout title="Vehicle Management" description="Search and manage vehicles" showBackButton>
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
            <Card key={vehicle.id} className="hover:shadow-lg transition-shadow cursor-pointer">
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
                  {vehicle.profile_photo_url && (
                    <img 
                      src={vehicle.profile_photo_url} 
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
                    {vehicle.is_self_contained && (
                      <Badge variant="outline" className="text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Self-Contained
                      </Badge>
                    )}
                    {vehicle.is_homeless && (
                      <Badge variant="outline" className="text-xs bg-orange-50">
                        Homeless
                      </Badge>
                    )}
                    {vehicle.fc_act_exempt && (
                      <Badge variant="outline" className="text-xs bg-purple-50">
                        FCA Exempt
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
                    <Button variant="outline" size="sm" className="w-full">
                      View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
