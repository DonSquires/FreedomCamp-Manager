import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { StatCard } from '@/components/features/StatCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { toast } from 'sonner'
import {
  Database,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Download,
  Upload,
  BarChart3,
  Shield,
  RefreshCw,
  Archive,
} from 'lucide-react'

// Type for import history records mapped from import_batches table
// NOTE: The `import_history` table never existed; `import_batches` is the canonical table.
interface ImportHistoryRecord {
  id: string
  organization_id: string
  import_type: string
  file_name: string | null
  status: string
  records_imported: number
  duplicates_skipped: number
  failed_records: number
  created_at: string
}

// Raw row from import_batches (not in generated types)
interface ImportBatchRow {
  id: string
  organization_id: string
  import_config: Record<string, string> | null
  file_name: string | null
  status: string
  successful_records: number
  failed_records: number
  created_at: string
}

// Map an import_batches row to ImportHistoryRecord
function mapBatchRow(row: ImportBatchRow): ImportHistoryRecord {
  return {
    id: row.id,
    organization_id: row.organization_id,
    import_type: row.import_config?.import_type || 'historical',
    file_name: row.file_name,
    status: row.status,
    records_imported: row.successful_records || 0,
    duplicates_skipped: 0,
    failed_records: row.failed_records || 0,
    created_at: row.created_at,
  }
}

export default function DataManagementHub() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const [isExporting, setIsExporting] = useState(false)

  // Fetch data statistics
  const { data: stats, isLoading } = useQuery({
    queryKey: ['data-stats', organizationId],
    queryFn: async () => {
      const orgFilter = organizationId || (user?.role === 'master' ? null : user?.organization_id)

      // Total observations
      let obsQuery = supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
      
      if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter)
      const { count: totalObservations } = await obsQuery

      // Total vehicles
      const { count: totalVehicles } = await supabase
        .from('canonical_vehicles')
        .select('id', { count: 'exact', head: true })

      // Total zones
      let zoneQuery = supabase
        .from('zones')
        .select('id', { count: 'exact', head: true })
      
      if (orgFilter) zoneQuery = zoneQuery.eq('organization_id', orgFilter)
      const { count: totalZones } = await zoneQuery

      // Total breaches
      let breachQuery = supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      
      if (orgFilter) breachQuery = breachQuery.eq('organization_id', orgFilter)
      const { count: activeBreaches } = await breachQuery

      // Storage usage estimate
      const { count: totalPhotos } = await supabase
        .from('photo_metadata')
        .select('id', { count: 'exact', head: true })

      return {
        totalObservations: totalObservations || 0,
        totalVehicles: totalVehicles || 0,
        totalZones: totalZones || 0,
        activeBreaches: activeBreaches || 0,
        totalPhotos: totalPhotos || 0,
        estimatedStorageGB: ((totalPhotos || 0) * 2) / 1024, // Rough estimate: 2MB per photo
      }
    },
    enabled: !!user,
  })

  // Fetch import history from import_batches (import_history table does not exist)
  const { data: importHistory } = useQuery({
    queryKey: ['import-history', organizationId],
    queryFn: async () => {
      let query = (supabase.from('import_batches') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to fetch import history:', error)
        throw error
      }

      return (data as ImportBatchRow[] || []).map(mapBatchRow)
    },
    enabled: !!user,
  })

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      const dateTo = new Date().toISOString().slice(0, 10)
      const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      // Call export edge function
      const { data, error } = await supabase.functions.invoke('generate-dashboard-report', {
        body: {
          organization_id: organizationId || user?.organization_id,
          date_from: dateFrom,
          date_to: dateTo,
        },
      })

      if (error) throw error

      toast.success('Export started - check your downloads')
    } catch (error: any) {
      console.error('Export failed:', error)
      toast.error(`Export failed: ${error.message}`)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Data Management Hub</h1>
          <p className="text-muted-foreground mt-1">
            Monitor data quality, run cleanup operations, and manage data integrity
          </p>
        </div>

        {/* Statistics Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Observations"
            value={isLoading ? '...' : (stats?.totalObservations || 0)}
            icon={Database}
          />
          <StatCard
            title="Unique Vehicles"
            value={isLoading ? '...' : (stats?.totalVehicles || 0)}
            icon={CheckCircle2}
          />
          <StatCard
            title="Active Zones"
            value={isLoading ? '...' : (stats?.totalZones || 0)}
            icon={BarChart3}
          />
          <StatCard
            title="Active Breaches"
            value={isLoading ? '...' : (stats?.activeBreaches || 0)}
            icon={AlertTriangle}
            variant={stats?.activeBreaches ? 'danger' : 'default'}
          />
        </div>

        {/* Storage Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Storage Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Total Photos</span>
                <span className="font-medium">{stats?.totalPhotos?.toLocaleString() || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Estimated Storage</span>
                <span className="font-medium">{stats?.estimatedStorageGB?.toFixed(2) || 0} GB</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Data Cleanup */}
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <Link to="/admin/data-cleanup">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5" />
                  Data Cleanup
                </CardTitle>
                <CardDescription>
                  Remove duplicates, orphaned records, and expired data
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  Open Cleanup Utility
                </Button>
              </CardContent>
            </Link>
          </Card>

          {/* Data Integrity */}
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <Link to="/admin/data-integrity">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Data Integrity
                </CardTitle>
                <CardDescription>
                  Monitor data quality, validation errors, and consistency
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">
                  View Integrity Dashboard
                </Button>
              </CardContent>
            </Link>
          </Card>

          {/* Data Export */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Data Export
              </CardTitle>
              <CardDescription>
                Export observations, vehicles, and compliance data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                className="w-full" 
                onClick={handleExportData}
                disabled={isExporting}
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  'Export All Data'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Import History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Recent Data Imports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {importHistory && importHistory.length > 0 ? (
              <div className="space-y-3">
                {importHistory.map((item) => (
                  <div key={item.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{item.import_type}</span>
                        <Badge variant={item.status === 'completed' ? 'default' : 'destructive'}>
                          {item.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {item.file_name} • {item.records_imported} records • {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-green-600">
                        {item.records_imported} imported
                      </div>
                      {item.duplicates_skipped > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {item.duplicates_skipped} duplicates skipped
                        </div>
                      )}
                      {item.failed_records > 0 && (
                        <div className="text-xs text-red-600">
                          {item.failed_records} failed
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Upload className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No import history</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Maintenance Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" />
              Automated Maintenance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Daily Photo Cleanup</div>
                  <div className="text-sm text-muted-foreground">
                    Removes photos older than retention policy
                  </div>
                </div>
                <Badge>Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Weekly Duplicate Detection</div>
                  <div className="text-sm text-muted-foreground">
                    Scans for duplicate observations
                  </div>
                </div>
                <Badge>Active</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Monthly Data Integrity Check</div>
                  <div className="text-sm text-muted-foreground">
                    Validates referential integrity
                  </div>
                </div>
                <Badge>Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
