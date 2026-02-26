import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Upload, Download, Trash2, Search, RefreshCw, AlertTriangle } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

export function DataManagement() {
  const { user } = useAuthStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTable, setSelectedTable] = useState<string>('observations')

  // Check user role
  const isAdmin = user?.role === 'admin' || user?.role === 'master'

  // Fetch import history
  const { data: importHistory, isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['import-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      return data
    },
  })

  // Data integrity check mutation
  const checkIntegrityMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-data-integrity', {
        body: { comprehensive: true }
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      toast.success('Data integrity check complete')
      console.log('Integrity report:', data)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Integrity check failed')
    },
  })

  // Duplicate detection mutation
  const duplicateDetectionMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('duplicate-detection', {
        body: { table: selectedTable }
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      toast.success(`Found ${data?.duplicates?.length || 0} potential duplicates`)
      console.log('Duplicates:', data)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Duplicate detection failed')
    },
  })

  // Export data mutation
  const exportDataMutation = useMutation({
    mutationFn: async (table: string) => {
      const { data, error } = await supabase.functions.invoke('observations-export', {
        body: { format: 'csv', table }
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      // Create download link
      const blob = new Blob([data.csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedTable}-export-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      toast.success('Export complete')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Export failed')
    },
  })

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Admin access required.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Data Management</h1>
        <p className="text-gray-600 mt-1">
          Import, export, and maintain data integrity
        </p>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Import Data */}
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardHeader className="pb-3">
            <Upload className="h-8 w-8 text-blue-600 mb-2" />
            <CardTitle className="text-lg">Import Data</CardTitle>
            <CardDescription>
              Upload CSV/Excel files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" disabled>
              <Upload className="h-4 w-4 mr-2" />
              Coming Soon
            </Button>
          </CardContent>
        </Card>

        {/* Export Data */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <Download className="h-8 w-8 text-green-600 mb-2" />
            <CardTitle className="text-lg">Export Data</CardTitle>
            <CardDescription>
              Download as CSV/Excel
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => exportDataMutation.mutate(selectedTable)}
              disabled={exportDataMutation.isPending}
            >
              <Download className="h-4 w-4 mr-2" />
              {exportDataMutation.isPending ? 'Exporting...' : 'Export'}
            </Button>
          </CardContent>
        </Card>

        {/* Check Integrity */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <Search className="h-8 w-8 text-orange-600 mb-2" />
            <CardTitle className="text-lg">Check Integrity</CardTitle>
            <CardDescription>
              Verify data consistency
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => checkIntegrityMutation.mutate()}
              disabled={checkIntegrityMutation.isPending}
            >
              <Search className="h-4 w-4 mr-2" />
              {checkIntegrityMutation.isPending ? 'Checking...' : 'Run Check'}
            </Button>
          </CardContent>
        </Card>

        {/* Detect Duplicates */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <AlertTriangle className="h-8 w-8 text-red-600 mb-2" />
            <CardTitle className="text-lg">Find Duplicates</CardTitle>
            <CardDescription>
              Detect duplicate records
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => duplicateDetectionMutation.mutate()}
              disabled={duplicateDetectionMutation.isPending}
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              {duplicateDetectionMutation.isPending ? 'Scanning...' : 'Scan'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Table Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Data Table</CardTitle>
          <CardDescription>Choose which table to export or analyze</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {['observations', 'canonical_vehicles', 'breach_alerts', 'zones', 'user_profiles'].map((table) => (
              <Button
                key={table}
                variant={selectedTable === table ? 'default' : 'outline'}
                onClick={() => setSelectedTable(table)}
              >
                {table.replace('_', ' ')}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Import History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Import History</CardTitle>
              <CardDescription>Recent data import operations</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="text-center py-8 text-gray-600">Loading history...</div>
          ) : importHistory && importHistory.length > 0 ? (
            <div className="space-y-3">
              {importHistory.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="font-medium">{record.import_type}</div>
                    <div className="text-sm text-gray-600">
                      {record.file_name || 'No file name'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatDateTime(record.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm text-green-600 font-medium">
                        ✓ {record.records_imported} imported
                      </div>
                      {record.duplicates_skipped > 0 && (
                        <div className="text-sm text-orange-600">
                          ⚠ {record.duplicates_skipped} skipped
                        </div>
                      )}
                      {record.failed_records > 0 && (
                        <div className="text-sm text-red-600">
                          ✗ {record.failed_records} failed
                        </div>
                      )}
                    </div>
                    <Badge variant={record.status === 'completed' ? 'default' : 'destructive'}>
                      {record.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600">
              No import history found
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
