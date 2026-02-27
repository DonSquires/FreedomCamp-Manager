import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { 
  Database, 
  Download, 
  Upload, 
  Trash2, 
  RefreshCw, 
  CheckCircle,
  AlertTriangle,
  FileText,
  FileSpreadsheet,
  Activity
} from 'lucide-react'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'

export default function DataManagement() {
  const { user } = useAuthStore()
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv')
  const [integrityResults, setIntegrityResults] = useState<any>(null)
  const [duplicateResults, setDuplicateResults] = useState<any>(null)
  const [exportProgress, setExportProgress] = useState<number>(0)
  const [isExporting, setIsExporting] = useState(false)

  // Check user role
  const isAdmin = user?.role === 'admin' || user?.role === 'master'

  // Integrity check mutation
  const integrityMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-data-integrity', {
        body: { comprehensive: true }
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      setIntegrityResults(data)
      toast.success('Integrity check complete')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Integrity check failed')
    },
  })

  // Duplicate detection mutation
  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('duplicate-detection', {
        body: {}
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      setDuplicateResults(data)
      toast.success('Duplicate scan complete')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Duplicate scan failed')
    },
  })

  // Export data mutation
  const exportMutation = useMutation({
    mutationFn: async () => {
      setIsExporting(true)
      setExportProgress(0)

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setExportProgress(prev => Math.min(prev + 10, 90))
      }, 300)

      const { data, error } = await supabase.functions.invoke('observations-export', {
        body: { format: exportFormat }
      })

      clearInterval(progressInterval)
      
      if (error) throw error
      
      setExportProgress(100)
      
      // Download the file
      if (data?.url) {
        const link = document.createElement('a')
        link.href = data.url
        link.download = `observations_export_${new Date().toISOString().split('T')[0]}.${exportFormat}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      
      return data
    },
    onSuccess: () => {
      toast.success('Export complete')
      setTimeout(() => {
        setIsExporting(false)
        setExportProgress(0)
      }, 2000)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Export failed')
      setIsExporting(false)
      setExportProgress(0)
    },
  })

  if (!isAdmin) {
    return (
      <AppLayout title="Data Management" description="Import, export, and manage data" showBackButton>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Admin access required.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Data Management" description="Import, export, and manage data" showBackButton>
      <GlobalFilterRibbon />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Data Export */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-blue-600" />
              <CardTitle>Export Data</CardTitle>
            </div>
            <CardDescription>
              Download observations and related data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Export Format</label>
                <Select
                  value={exportFormat}
                  onValueChange={(value: 'csv' | 'xlsx') => setExportFormat(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        CSV (Comma Separated)
                      </div>
                    </SelectItem>
                    <SelectItem value="xlsx">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4" />
                        XLSX (Excel)
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isExporting && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Exporting...</span>
                    <span className="font-medium">{exportProgress}%</span>
                  </div>
                  <Progress value={exportProgress} />
                </div>
              )}

              <Button
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending || isExporting}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? 'Exporting...' : 'Export Data'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Data Import */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-green-600" />
              <CardTitle>Import Data</CardTitle>
            </div>
            <CardDescription>
              Bulk import historical observations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
                <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  CSV or XLSX file
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Max 10,000 records per file
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full"
                disabled
              >
                <Upload className="h-4 w-4 mr-2" />
                Select File
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Integrity */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-purple-600" />
                <CardTitle>Data Integrity Check</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Verify database consistency and identify issues
              </CardDescription>
            </div>
            <Button
              onClick={() => integrityMutation.mutate()}
              disabled={integrityMutation.isPending}
            >
              <Activity className="h-4 w-4 mr-2" />
              {integrityMutation.isPending ? 'Running...' : 'Run Check'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {integrityMutation.isPending && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Checking data integrity...</p>
            </div>
          )}

          {integrityResults && (
            <div className="space-y-3">
              {integrityResults.checks?.map((check: any, idx: number) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border ${
                    check.passed
                      ? 'bg-green-50 border-green-200 dark:bg-green-900/20'
                      : 'bg-red-50 border-red-200 dark:bg-red-900/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {check.passed ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                    )}
                    <span className="font-medium">{check.name}</span>
                    <Badge variant={check.passed ? 'default' : 'destructive'}>
                      {check.passed ? 'Passed' : 'Failed'}
                    </Badge>
                  </div>
                  {check.details && (
                    <p className="text-sm text-gray-600 mt-2 ml-7">{check.details}</p>
                  )}
                </div>
              ))}

              <div className="pt-4 border-t">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total Checks:</span>
                  <span className="font-medium">{integrityResults.total_checks || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="text-gray-600">Passed:</span>
                  <span className="font-medium text-green-600">{integrityResults.passed || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="text-gray-600">Failed:</span>
                  <span className="font-medium text-red-600">{integrityResults.failed || 0}</span>
                </div>
              </div>
            </div>
          )}

          {!integrityResults && !integrityMutation.isPending && (
            <div className="text-center py-8 text-gray-600">
              Click "Run Check" to verify data integrity
            </div>
          )}
        </CardContent>
      </Card>

      {/* Duplicate Detection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-orange-600" />
                <CardTitle>Duplicate Detection</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Find and manage duplicate records
              </CardDescription>
            </div>
            <Button
              onClick={() => duplicateMutation.mutate()}
              disabled={duplicateMutation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {duplicateMutation.isPending ? 'Scanning...' : 'Scan Duplicates'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {duplicateMutation.isPending && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Scanning for duplicates...</p>
            </div>
          )}

          {duplicateResults && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {duplicateResults.observations || 0}
                  </div>
                  <div className="text-sm text-gray-600">Observation Duplicates</div>
                </div>

                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {duplicateResults.vehicles || 0}
                  </div>
                  <div className="text-sm text-gray-600">Vehicle Duplicates</div>
                </div>

                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {duplicateResults.breaches || 0}
                  </div>
                  <div className="text-sm text-gray-600">Breach Duplicates</div>
                </div>
              </div>

              {duplicateResults.details && duplicateResults.details.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="font-semibold">Duplicate Details:</h4>
                  {duplicateResults.details.map((detail: any, idx: number) => (
                    <div key={idx} className="p-3 bg-gray-50 dark:bg-gray-800 rounded text-sm">
                      {detail.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!duplicateResults && !duplicateMutation.isPending && (
            <div className="text-center py-8 text-gray-600">
              Click "Scan Duplicates" to find duplicate records
            </div>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
