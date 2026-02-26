import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Search, FileText, Image, MapPin, Calendar } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

interface Incident {
  id: string
  organization_id: string
  zone_id: string
  plate_number: string
  incident_type: string
  severity: string
  status: string
  description: string
  recorded_at: string
  created_at: string
  attachments: any[]
}

export function IncidentManagement() {
  const { user } = useAuthStore()
  const { dateRange, organizationId, zoneId } = useGlobalFiltersStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Fetch incidents
  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', dateRange, organizationId, zoneId, statusFilter, searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('incidents')
        .select('*')
        .order('recorded_at', { ascending: false })

      // Apply filters
      if (dateRange.from) {
        query = query.gte('recorded_at', dateRange.from.toISOString())
      }
      if (dateRange.to) {
        query = query.lte('recorded_at', dateRange.to.toISOString())
      }
      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }
      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }
      if (searchTerm) {
        query = query.or(`plate_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
      }

      const { data, error } = await query.limit(100)
      if (error) throw error
      return data as Incident[]
    },
  })

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200'
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved': return 'default'
      case 'pending': return 'secondary'
      case 'investigating': return 'outline'
      default: return 'secondary'
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Incident Management</h1>
          <p className="text-gray-600 mt-1">
            View and manage incident reports
          </p>
        </div>
        <Button disabled>
          <FileText className="h-4 w-4 mr-2" />
          New Incident
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by plate or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status Filter */}
            <div className="flex gap-2">
              {['all', 'pending', 'investigating', 'resolved'].map((status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(status)}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Incidents List */}
      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8 text-gray-600">Loading incidents...</div>
            </CardContent>
          </Card>
        ) : incidents && incidents.length > 0 ? (
          incidents.map((incident) => (
            <Card key={incident.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-gray-600" />
                      <CardTitle className="text-lg">{incident.incident_type}</CardTitle>
                      <Badge variant={getStatusColor(incident.status)}>
                        {incident.status}
                      </Badge>
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${getSeverityColor(incident.severity)}`}>
                        {incident.severity}
                      </span>
                    </div>
                    <CardDescription className="mt-2">
                      {incident.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">
                      {formatDateTime(incident.recorded_at)}
                    </span>
                  </div>
                  {incident.plate_number && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">
                        {incident.plate_number}
                      </span>
                    </div>
                  )}
                  {incident.attachments && incident.attachments.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Image className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-600">
                        {incident.attachments.length} attachment(s)
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" disabled>
                    View Details
                  </Button>
                  {incident.status === 'pending' && (
                    <Button variant="outline" size="sm" disabled>
                      Investigate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8 text-gray-600">
                No incidents found
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
