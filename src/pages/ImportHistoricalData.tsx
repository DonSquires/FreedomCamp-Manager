import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { getEffectiveOrgId } from '@/lib/orgUtils'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  Clock,
  Database,
  List,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface ImportBatch {
  id: string
  batch_name: string
  file_name: string | null
  status: string
  total_records: number
  processed_records: number
  successful_records: number
  failed_records: number
  zones_created: number
  created_at: string
  completed_at: string | null
  error_summary: string | null
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; color: string }> = {
  pending:     { label: 'Pending',     variant: 'secondary',   color: '#6b7280' },
  parsing:     { label: 'Parsing',     variant: 'default',     color: '#1d4ed8' },
  zone_matching:{ label: 'Matching Zones', variant: 'default',  color: '#7c3aed' },
  importing:   { label: 'Importing',   variant: 'default',     color: '#1d4ed8' },
  completed:   { label: 'Completed',   variant: 'secondary',   color: '#059669' },
  failed:      { label: 'Failed',      variant: 'destructive', color: '#dc2626' },
}

export default function ImportHistoricalData() {
  const { user } = useAuthStore()
  const { organizationId: globalOrgId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState('upload')
  const [file, setFile] = useState<File | null>(null)
  const [batchName, setBatchName] = useState('')
  const [storageSource, setStorageSource] = useState('')
  const [storageBatchName, setStorageBatchName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)

  // Use getEffectiveOrgId so that:
  //  - master users use their globally-selected org (from global filters store)
  //  - all other users use their own organization
  const orgId = getEffectiveOrgId(user, globalOrgId)

  const isMaster = user?.role === 'master'
  const missingMasterOrg = isMaster && !orgId

  // Fetch batches
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['historical-batches', orgId],
    queryFn: async () => {
      let q = supabase
        .from('import_batches')
        .select('id, batch_name, file_name, status, total_records, processed_records, successful_records, failed_records, zones_created, created_at, completed_at, error_summary')
        .order('created_at', { ascending: false })
        .limit(50)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as ImportBatch[]
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const data = query.state.data as ImportBatch[] | undefined
      if (!data) return 3000
      return data.some(b => ['pending', 'parsing', 'zone_matching', 'importing'].includes(b.status)) ? 3000 : false
    },
  })

  const activeBatch = activeBatchId ? batches.find(b => b.id === activeBatchId) : null

  // Clear activeBatchId once the tracked batch reaches a terminal state
  useEffect(() => {
    if (activeBatch && ['completed', 'failed'].includes(activeBatch.status)) {
      setActiveBatchId(null)
    }
  }, [activeBatch, setActiveBatchId])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!batchName.trim()) {
      setBatchName(f.name.replace(/\.[^.]+$/, ''))
    }
  }

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a CSV or Excel file')
      return
    }
    if (!batchName.trim()) {
      toast.error('Please enter a batch name')
      return
    }
    if (missingMasterOrg) {
      toast.error('Please select an organisation in the global filter bar before importing')
      return
    }
    setUploading(true)
    setUploadProgress(10)

    try {
      // Upload file to storage first
      const filePath = `imports/${user!.id}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(filePath, file, { contentType: file.type })

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)
      setUploadProgress(40)

      // Call edge function with file path
      const { data, error } = await supabase.functions.invoke('import-historical-data', {
        body: {
          filePath,
          batchName: batchName.trim(),
          organizationId: orgId,
        },
      })
      setUploadProgress(100)

      if (error) throw new Error(error.message)

      if (data?.batchId) {
        setActiveBatchId(data.batchId)
        toast.success(`✅ Import started — batch ${data.batchId.slice(0, 8)}…`)
        setTab('history')
        queryClient.invalidateQueries({ queryKey: ['historical-batches'] })
      } else if (data?.success) {
        const imported = data?.summary?.successful ?? data?.successful ?? 0
        const gpsInferred = data?.summary?.gps_inferred_records ?? 0
        const gpsFallback = data?.summary?.gps_fallback_records ?? 0
        toast.success(`✅ Import complete — ${imported} records imported (GPS inferred: ${gpsInferred}, fallback: ${gpsFallback})`)
        queryClient.invalidateQueries({ queryKey: ['historical-batches'] })
      } else {
        toast.warning(data?.message || 'Import started but no batch ID returned')
      }

      setFile(null)
      setBatchName('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (err: any) {
      toast.error(err.message || 'Import failed')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleImportFromStorage = async () => {
    if (!storageSource.trim()) {
      toast.error('Please enter a storage URL or file path')
      return
    }
    if (missingMasterOrg) {
      toast.error('Please select an organisation in the global filter bar before importing')
      return
    }

    setUploading(true)
    setUploadProgress(20)

    try {
      const { data, error } = await supabase.functions.invoke('import-historical-data', {
        body: {
          fileUrl: storageSource.trim(),
          batchName: storageBatchName.trim() || `Storage import ${new Date().toISOString().slice(0, 10)}`,
          organizationId: orgId,
        },
      })

      setUploadProgress(100)

      if (error) throw new Error(error.message)

      if (data?.batchId) {
        setActiveBatchId(data.batchId)
        toast.success(`✅ Storage import started — batch ${data.batchId.slice(0, 8)}…`)
        setTab('history')
        queryClient.invalidateQueries({ queryKey: ['historical-batches'] })
      } else if (data?.success) {
        const imported = data?.summary?.successful ?? data?.successful ?? 0
        toast.success(`✅ Storage import complete — ${imported} records imported`)
        queryClient.invalidateQueries({ queryKey: ['historical-batches'] })
      } else {
        toast.warning(data?.message || 'Import started but no batch ID returned')
      }

      setStorageSource('')
      setStorageBatchName('')
    } catch (err: any) {
      toast.error(err.message || 'Storage import failed')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const inProgress = batches.filter(b =>
    ['pending', 'parsing', 'zone_matching', 'importing'].includes(b.status)
  )

  return (
    <AppLayout
      title="Import Historical Data"
      description="Bulk Excel/CSV import — server-side processing with progress tracking"
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upload" className="flex items-center gap-1.5">
            <Upload className="h-4 w-4" />
            Upload File
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <List className="h-4 w-4" />
            Import History
            {inProgress.length > 0 && (
              <Badge variant="default" className="ml-1 h-4 px-1 text-[10px]">{inProgress.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Upload tab */}
        <TabsContent value="upload" className="mt-6">
          <div className="max-w-xl space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-green-600" />
                  Historical Data Import
                </CardTitle>
                <CardDescription>
                  Upload a CSV (.csv) or Excel (.xlsx) file with historical observation records. The system will parse all records server-side, auto-match zone names via fuzzy matching, create missing zones, and bulk-import all observations atomically. DOWNER/LINZ CSV format is supported. Progress is tracked in real time.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Expected format */}
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Supported Column Formats</p>
                <p className="text-xs text-muted-foreground mb-1 font-medium">DOWNER/LINZ CSV format:</p>
                <div className="font-mono text-xs text-muted-foreground grid grid-cols-3 gap-1 mb-2">
                  {['ID', 'Title', 'RecordedDate', 'REGO', 'Note'].map(col => (
                    <span key={col} className="bg-muted rounded px-1.5 py-0.5">{col}</span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">Generic Excel format:</p>
                <div className="font-mono text-xs text-muted-foreground grid grid-cols-3 gap-1">
                  {['ID', 'Zone', 'Date', 'Plate', 'Notes', 'Attachments'].map(col => (
                    <span key={col} className="bg-muted rounded px-1.5 py-0.5">{col}</span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Zone names are fuzzy-matched to existing zones. Dates in DD/MM/YYYY format are handled automatically.</p>
              </CardContent>
            </Card>

            {/* File drop */}
            <div className="space-y-1.5">
              <Label>CSV or Excel File (.csv, .xlsx) *</Label>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet className="h-8 w-8 text-green-600" />
                    <span className="font-semibold">{file.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="h-8 w-8" />
                    <span>Click to choose a file</span>
                    <span className="text-xs">.csv or .xlsx format</span>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Batch Name</Label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={batchName}
                onChange={e => setBatchName(e.target.value)}
                placeholder="e.g. Summer 2025 records"
              />
            </div>

            {uploading && uploadProgress > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm text-muted-foreground">
                  {uploadProgress < 40 ? 'Uploading file…' : uploadProgress < 100 ? 'Starting import…' : 'Import started!'}
                </div>
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}

            {missingMasterOrg && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  You are logged in as a master user. Please select an organisation using the global
                  filter bar at the top of the page before importing.
                </span>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleUpload}
              disabled={!file || uploading || missingMasterOrg}
            >
              {uploading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Start Import
                </span>
              )}
            </Button>

            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Import From Existing Storage File</CardTitle>
                <CardDescription>
                  Paste a Supabase Storage URL or a file path already in storage to trigger backend import directly.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Storage URL or Path *</Label>
                  <input
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={storageSource}
                    onChange={e => setStorageSource(e.target.value)}
                    placeholder="https://.../storage/v1/object/public/<bucket>/<file>.xlsx or imports/user/file.xlsx"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Batch Name (optional)</Label>
                  <input
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={storageBatchName}
                    onChange={e => setStorageBatchName(e.target.value)}
                    placeholder="e.g. Downer LINZ Vehicle Log 10-3-26"
                  />
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleImportFromStorage}
                  disabled={!storageSource.trim() || uploading || missingMasterOrg}
                >
                  {uploading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Starting…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Import From Storage URL
                    </span>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="mt-4 space-y-3">
          {/* Active batch progress */}
          {activeBatch && ['pending', 'parsing', 'zone_matching', 'importing'].includes(activeBatch.status) && (
            <Card className="border-blue-400 bg-blue-50/40">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold flex items-center gap-2">
                    <span className="h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    {activeBatch.batch_name}
                  </span>
                  <Badge variant="default" className="text-xs">
                    {STATUS_META[activeBatch.status]?.label || activeBatch.status}
                  </Badge>
                </div>
                {activeBatch.total_records > 0 && (
                  <>
                    <Progress
                      value={Math.round((activeBatch.processed_records / activeBatch.total_records) * 100)}
                      className="h-2 mb-1"
                    />
                    <div className="text-xs text-muted-foreground">
                      {activeBatch.processed_records} / {activeBatch.total_records} records
                      {activeBatch.successful_records > 0 && ` · ${activeBatch.successful_records} imported`}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading…</div>
          ) : batches.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Database className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground">No import history</p>
              </CardContent>
            </Card>
          ) : (
            batches.map(batch => {
              const meta = STATUS_META[batch.status] || STATUS_META.pending
              const isRunning = ['pending', 'parsing', 'zone_matching', 'importing'].includes(batch.status)
              const pct = batch.total_records > 0
                ? Math.round((batch.processed_records / batch.total_records) * 100)
                : null

              return (
                <Card key={batch.id} className={isRunning ? 'border-blue-300' : ''}>
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{batch.batch_name}</span>
                          <Badge variant={meta.variant} className="text-xs">{meta.label}</Badge>
                          {isRunning && (
                            <span className="h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => queryClient.invalidateQueries({ queryKey: ['historical-batches'] })}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {pct !== null && (
                        <Progress value={pct} className="h-1.5" />
                      )}

                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {batch.file_name && <span>{batch.file_name}</span>}
                        {batch.total_records > 0 && (
                          <span>{batch.successful_records}/{batch.total_records} records</span>
                        )}
                        {batch.zones_created > 0 && (
                          <span>{batch.zones_created} zones created</span>
                        )}
                        {batch.failed_records > 0 && (
                          <span className="text-red-600">{batch.failed_records} failed</span>
                        )}
                        <span>{formatDateTime(batch.created_at)}</span>
                      </div>

                      {batch.error_summary && (
                        <p className="text-xs text-red-600 line-clamp-2">{batch.error_summary}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
