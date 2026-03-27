import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Upload,
  FileText,
  Image,
  CheckCircle,
  AlertTriangle,
  Clock,
  Database,
  Zap,
  List,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface ImportBatch {
  id: string
  batch_name: string
  file_name: string | null
  status: string
  total_records: number
  successful_records: number
  failed_records: number
  created_at: string
  completed_at: string | null
  error_summary: string | null
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending:    { label: 'Pending',    variant: 'secondary' },
  processing: { label: 'Processing', variant: 'default' },
  enriching:  { label: 'Enriching',  variant: 'default' },
  completed:  { label: 'Completed',  variant: 'secondary' },
  failed:     { label: 'Failed',     variant: 'destructive' },
}

export default function ImportData() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState('import')
  const [file, setFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [batchName, setBatchName] = useState('')
  const [recordDate, setRecordDate] = useState('')
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const orgId = user?.role === 'master' ? undefined : user?.organization_id

  // Fetch import history
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['import-batches', orgId],
    queryFn: async () => {
      let q = supabase
        .from('import_batches')
        .select('id, batch_name, file_name, status, total_records, successful_records, failed_records, created_at, completed_at, error_summary')
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
      if (!data) return 5000
      return data.some(b => ['pending', 'processing', 'enriching'].includes(b.status)) ? 5000 : false
    },
  })

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!batchName.trim()) {
      setBatchName(f.name.replace(/\.[^.]+$/, ''))
    }

    // Read file as base64 or text
    const reader = new FileReader()
    if (f.type.startsWith('image/')) {
      reader.readAsDataURL(f)
    } else {
      reader.readAsText(f)
    }
    reader.onload = () => {
      setFileContent(reader.result as string)
    }
  }

  const handleImport = async () => {
    if (!file || !fileContent) {
      toast.error('Please select a file first')
      return
    }
    if (!batchName.trim()) {
      toast.error('Please enter a batch name')
      return
    }
    setUploading(true)
    setResult(null)
    try {
      const isImage = file.type.startsWith('image/')
      const { data, error } = await edgeFunctions.importData({
        fileContent,
        fileName: file.name,
        isImage,
        recordDate: recordDate || undefined,
        organizationId: orgId,
      })
      if (error) throw new Error(error.message)
      setResult(data)
      toast.success(data?.success ? `✅ Import complete — ${data?.records_inserted || 0} records imported` : '⚠️ Import finished with warnings')
      queryClient.invalidateQueries({ queryKey: ['import-batches'] })
      setFile(null)
      setFileContent(null)
      if (fileRef.current) fileRef.current.value = ''
      setBatchName('')
    } catch (err: any) {
      toast.error(err.message || 'Import failed')
      setResult({ error: err.message })
    } finally {
      setUploading(false)
    }
  }

  const inProgress = batches.filter(b => ['pending', 'processing', 'enriching'].includes(b.status))

  return (
    <AppLayout title="Import Data" description="AI-powered data import — CSV, text, images and documents">

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="import" className="flex items-center gap-1.5">
            <Upload className="h-4 w-4" />
            Import File
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <List className="h-4 w-4" />
            Import History
            {inProgress.length > 0 && (
              <Badge variant="default" className="ml-1 h-4 px-1 text-[10px]">{inProgress.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Import tab */}
        <TabsContent value="import" className="mt-6">
          <div className="max-w-xl space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-500" />
                  AI-Powered Import
                </CardTitle>
                <CardDescription>
                  Upload any CSV, text file, or photo. The AI service will automatically extract zone names, plate numbers, dates and observations. Supported: .csv, .txt, .json, .xlsx (text), .jpg, .png
                </CardDescription>
              </CardHeader>
            </Card>

            {/* File picker */}
            <div className="space-y-1.5">
              <Label>File *</Label>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    {file.type.startsWith('image/') ? (
                      <Image className="h-8 w-8 text-blue-500" />
                    ) : (
                      <FileText className="h-8 w-8 text-blue-500" />
                    )}
                    <span className="font-semibold">{file.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="h-8 w-8" />
                    <span>Click to choose a file</span>
                    <span className="text-xs">CSV, TXT, JSON, JPG, PNG</span>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.json,.xlsx,.jpg,.jpeg,.png,.gif,.bmp"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Batch name */}
            <div className="space-y-1.5">
              <Label>Batch Name</Label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={batchName}
                onChange={e => setBatchName(e.target.value)}
                placeholder="Descriptive name for this import"
              />
            </div>

            {/* Record date */}
            <div className="space-y-1.5">
              <Label>Default Record Date (optional)</Label>
              <input
                type="date"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={recordDate}
                onChange={e => setRecordDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Used when dates cannot be extracted from the file</p>
            </div>

            <Button
              className="w-full"
              onClick={handleImport}
              disabled={!file || uploading}
            >
              {uploading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Importing…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Import File
                </span>
              )}
            </Button>

            {/* Result */}
            {result && (
              <Card className={result.error ? 'border-red-300' : 'border-green-300'}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {result.error ? (
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    <span className="font-semibold">{result.error ? 'Import Error' : 'Import Complete'}</span>
                  </div>
                  {result.records_inserted != null && (
                    <p className="text-sm">Records imported: <strong>{result.records_inserted}</strong></p>
                  )}
                  {result.zones_created != null && (
                    <p className="text-sm">Zones created: <strong>{result.zones_created}</strong></p>
                  )}
                  {(result.error || result.message) && (
                    <p className="text-sm text-muted-foreground mt-1">{result.error || result.message}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="mt-4 space-y-3">
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
              const isRunning = ['pending', 'processing', 'enriching'].includes(batch.status)
              return (
                <Card key={batch.id} className={isRunning ? 'border-blue-300' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{batch.batch_name}</span>
                          <Badge variant={meta.variant} className="text-xs">{meta.label}</Badge>
                          {isRunning && (
                            <span className="h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          )}
                        </div>
                        {batch.file_name && (
                          <div className="text-xs text-muted-foreground">{batch.file_name}</div>
                        )}
                        <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                          {batch.total_records > 0 && (
                            <span>{batch.successful_records}/{batch.total_records} records</span>
                          )}
                          {batch.failed_records > 0 && (
                            <span className="text-red-600">{batch.failed_records} failed</span>
                          )}
                          <span>{formatDateTime(batch.created_at)}</span>
                          {batch.completed_at && (
                            <span>Completed {formatDateTime(batch.completed_at)}</span>
                          )}
                        </div>
                        {batch.error_summary && (
                          <p className="text-xs text-red-600 line-clamp-2">{batch.error_summary}</p>
                        )}
                      </div>
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
