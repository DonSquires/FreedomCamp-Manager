/**
 * ScanHistoryViewer Component
 * Recent scans viewer with retry capability
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { 
  Search, 
  RefreshCw, 
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
} from 'lucide-react'
import { toast } from 'sonner'

interface ScanHistoryViewerProps {
  limit?: number
  showFilters?: boolean
  onViewDetails?: (observationId: string) => void
}

export function ScanHistoryViewer({
  limit = 50,
  showFilters = true,
  onViewDetails,
}: ScanHistoryViewerProps) {
  const { user } = useAuthStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'compliant' | 'breach'>('all')

  // Fetch recent scans
  const { data: scans, isLoading, refetch } = useQuery({
    queryKey: ['recent-scans', user?.id, statusFilter],
    queryFn: async () => {
      let query = (supabase.from('observations') as any)
        .select(`
          id,
          plate_number,
          photo_url,
          recorded_at,
          is_compliant,
          breach_type,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          zones!observations_zone_id_fkey (name)
        `)
        .eq('recorded_by', user?.id ?? '')
        .order('recorded_at', { ascending: false })
        .limit(limit)

      if (statusFilter === 'compliant') {
        query = query.eq('is_compliant', true)
      } else if (statusFilter === 'breach') {
        query = query.eq('is_compliant', false)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: !!user,
  })

  // Filter by search query
  const filteredScans = scans?.filter(scan => {
    if (!searchQuery) return true
    
    const searchLower = searchQuery.toLowerCase()
    return (
      scan.plate_number.toLowerCase().includes(searchLower) ||
      (scan.zones as any)?.name?.toLowerCase().includes(searchLower) ||
      (scan.vehicle_make as any)?.toLowerCase().includes(searchLower)
    )
  })

  const getStatusBadge = (isCompliant: boolean, breachType?: string) => {
    if (isCompliant) {
      return (
        <Badge className="bg-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Compliant
        </Badge>
      )
    }
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <XCircle className="h-3 w-3" />
        {breachType || 'Breach'}
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Scans
            </CardTitle>
            <CardDescription className="mt-1">
              Your most recent vehicle observations
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {/* Filters */}
        {showFilters && (
          <div className="flex gap-2 mb-4">
            <div className="flex-1">
              <Input
                placeholder="Search plate, zone, or vehicle..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={statusFilter === 'compliant' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('compliant')}
              >
                Compliant
              </Button>
              <Button
                size="sm"
                variant={statusFilter === 'breach' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('breach')}
              >
                Breaches
              </Button>
            </div>
          </div>
        )}

        {/* Scans list */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading scans...
          </div>
        ) : filteredScans && filteredScans.length > 0 ? (
          <div className="space-y-3">
            {filteredScans.map((scan) => (
              <div
                key={scan.id}
                className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                {/* Photo thumbnail */}
                {scan.photo_url && (
                  <img
                    src={scan.photo_url}
                    alt={scan.plate_number}
                    className="w-20 h-20 object-cover rounded"
                  />
                )}

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-lg">{scan.plate_number}</span>
                    {getStatusBadge(scan.is_compliant, scan.breach_type)}
                  </div>

                  <div className="text-sm text-muted-foreground space-y-1">
                    {(scan.vehicle_make as any) && (
                      <div>
                        {(scan.vehicle_make as any)}{' '}
                        {(scan.vehicle_model as any)}{' '}
                        {(scan.vehicle_color as any) && `• ${(scan.vehicle_color as any)}`}
                      </div>
                    )}
                    <div>
                      {(scan.zones as any)?.name || 'Unknown Zone'} • {' '}
                      {new Date(scan.recorded_at).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {onViewDetails && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewDetails(scan.id)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    View
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {searchQuery ? (
              <>
                <Search className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No scans match your search</p>
              </>
            ) : (
              <>
                <Clock className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No scans recorded yet</p>
              </>
            )}
          </div>
        )}

        {/* Count */}
        {filteredScans && filteredScans.length > 0 && (
          <div className="mt-4 text-sm text-center text-muted-foreground">
            Showing {filteredScans.length} of {scans?.length || 0} scans
          </div>
        )}
      </CardContent>
    </Card>
  )
}
