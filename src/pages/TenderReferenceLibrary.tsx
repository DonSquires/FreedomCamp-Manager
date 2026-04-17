import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime } from '@/lib/utils'
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  ToggleLeft,
  ToggleRight,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type MaterialType = 'policy' | 'pricing' | 'template' | 'compliance' | 'legal' | 'past_tender' | 'nz_reference' | 'other'
type ExtractionStatus = 'pending' | 'extracting' | 'extracted' | 'failed' | 'needs_review'

interface ReferenceMaterial {
  id: string
  organization_id: string
  title: string
  description: string | null
  material_type: MaterialType
  file_name: string | null
  file_path: string | null
  file_public_url: string | null
  file_kind: string | null
  extracted_text: string | null
  extraction_status: ExtractionStatus
  extraction_notes: string | null
  is_active: boolean
  version: number
  previous_version_id: string | null
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

interface ReferenceVersion {
  id: string
  reference_material_id: string
  version: number
  file_name: string | null
  file_path: string | null
  file_kind: string | null
  extracted_text: string | null
  replaced_at: string
  replaced_by: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  policy: 'Policy document',
  pricing: 'Pricing guide',
  template: 'Tender template',
  compliance: 'Compliance document',
  legal: 'NZ Legal reference',
  past_tender: 'Past tender submission',
  nz_reference: 'NZ Reference (seeded)',
  other: 'Other',
}

const MATERIAL_TYPE_COLORS: Record<MaterialType, string> = {
  policy: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200',
  pricing: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 border-green-200',
  template: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border-purple-200',
  compliance: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border-orange-200',
  legal: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-red-200',
  past_tender: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300 border-yellow-200',
  nz_reference: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 border-teal-200',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200',
}

const EXTRACTION_STATUS_CONFIG: Record<ExtractionStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending', color: 'bg-gray-100 text-gray-600 border-gray-200', icon: Clock },
  extracting: { label: 'Extracting…', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Loader2 },
  extracted: { label: 'Extracted', color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700 border-red-200', icon: AlertCircle },
  needs_review: { label: 'Needs review', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: AlertCircle },
}

function classifyFile(file: File): string {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.doc') || name.endsWith('.docx')) return 'document'
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'spreadsheet'
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || name.endsWith('.json')) return 'text'
  if (/\.(jpg|jpeg|png|gif|bmp|webp)$/.test(name)) return 'image'
  return 'unknown'
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function TenderReferenceLibrary() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replaceFileInputRef = useRef<HTMLInputElement>(null)

  // ── UI state ─────────────────────────────────────────────────────────────
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedRef, setSelectedRef] = useState<ReferenceMaterial | null>(null)
  const [editingText, setEditingText] = useState(false)
  const [editedText, setEditedText] = useState('')
  const [savingText, setSavingText] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [replacingFile, setReplacingFile] = useState(false)
  const [reExtractingId, setReExtractingId] = useState<string | null>(null)

  // ── Create dialog state ───────────────────────────────────────────────────
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newType, setNewType] = useState<MaterialType>('policy')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [newManualText, setNewManualText] = useState('')

  const canEdit = user?.role === 'admin' || user?.role === 'master' || user?.role === 'grand_master'

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: refs = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['tender-reference-library', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        (supabase as any)
          .from('tender_reference_materials')
          .select('*')
          .eq('organization_id', user!.organization_id)
          .order('is_active', { ascending: false })
          .order('material_type')
          .order('title'),
        20000,
        'Loading reference library',
      )
      if (error) throw error
      return (data || []) as ReferenceMaterial[]
    },
    enabled: !!user?.organization_id,
    refetchInterval: 10000, // poll for extraction status updates
  })

  const { data: versions = [] } = useQuery({
    queryKey: ['tender-reference-versions', selectedRef?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tender_reference_versions')
        .select('*')
        .eq('reference_material_id', selectedRef!.id)
        .order('version', { ascending: false })
      if (error) throw error
      return (data || []) as ReferenceVersion[]
    },
    enabled: !!selectedRef?.id && showVersionHistory,
  })

  // ── Upload + create ───────────────────────────────────────────────────────
  const handleFileSelect = useCallback((file: File) => {
    setNewFile(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }, [handleFileSelect])

  const createReference = useCallback(async () => {
    if (!newTitle.trim() || !user) return
    setUploading(true)
    try {
      let filePath: string | null = null
      let filePublicUrl: string | null = null
      let fileName: string | null = null
      let fileKind: string | null = null

      if (newFile) {
        fileName = newFile.name
        fileKind = classifyFile(newFile)
        const ts = Date.now()
        const storagePath = `tender-references/${user.organization_id}/${ts}-${newFile.name}`

        const { error: uploadError } = await withTimeout(
          supabase.storage
            .from('evidence')
            .upload(storagePath, newFile, { upsert: false }),
          45000,
          'Uploading reference file',
        )
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

        const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(storagePath)
        filePath = storagePath
        filePublicUrl = urlData?.publicUrl || null
      }

      // Insert DB row
      const { data: inserted, error: insertError } = await withTimeout(
        (supabase as any)
          .from('tender_reference_materials')
          .insert({
            organization_id: user.organization_id,
            title: newTitle.trim(),
            description: newDescription.trim() || null,
            material_type: newType,
            file_name: fileName,
            file_path: filePath,
            file_public_url: filePublicUrl,
            file_kind: fileKind,
            extracted_text: newManualText.trim() || null,
            extraction_status: newManualText.trim() ? 'extracted' : (newFile ? 'pending' : 'needs_review'),
            is_active: true,
            version: 1,
            uploaded_by: user.id,
          })
          .select('id')
          .single(),
        20000,
        'Saving reference record',
      )

      if (insertError) throw new Error(insertError.message)

      // Trigger async extraction if file was uploaded
      if (newFile && inserted?.id) {
        edgeFunctions.processReferenceMaterial({ reference_material_id: inserted.id })
          .catch(() => { /* non-fatal — user can re-trigger */ })
      }

      queryClient.invalidateQueries({ queryKey: ['tender-reference-library'] })
      toast.success('Reference material added' + (newFile && !newManualText.trim() ? ' — extraction started' : ''))
      setShowCreateDialog(false)
      setNewTitle('')
      setNewDescription('')
      setNewType('policy')
      setNewFile(null)
      setNewManualText('')
    } catch (err: any) {
      toast.error(err?.message || 'Create failed')
    } finally {
      setUploading(false)
    }
  }, [newTitle, newDescription, newType, newFile, newManualText, user, queryClient])

  // ── Toggle active ─────────────────────────────────────────────────────────
  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from('tender_reference_materials')
        .update({ is_active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tender-reference-library'] }),
    onError: (e: any) => toast.error(e?.message || 'Update failed'),
  })

  // ── Save extracted text edits ─────────────────────────────────────────────
  const saveTextEdit = useCallback(async () => {
    if (!selectedRef) return
    setSavingText(true)
    try {
      const { error } = await (supabase as any)
        .from('tender_reference_materials')
        .update({
          extracted_text: editedText,
          extraction_status: editedText.trim() ? 'extracted' : 'needs_review',
          extraction_notes: null,
        })
        .eq('id', selectedRef.id)
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['tender-reference-library'] })
      setSelectedRef({ ...selectedRef, extracted_text: editedText, extraction_status: editedText.trim() ? 'extracted' : 'needs_review', extraction_notes: null })
      setEditingText(false)
      toast.success('Text saved')
    } catch (err: any) {
      toast.error(err?.message || 'Save failed')
    } finally {
      setSavingText(false)
    }
  }, [selectedRef, editedText, queryClient])

  // ── Re-trigger extraction ─────────────────────────────────────────────────
  const reExtract = useCallback(async (ref: ReferenceMaterial) => {
    if (!ref.file_path) { toast.error('No file to re-extract'); return }
    setReExtractingId(ref.id)
    try {
      await (supabase as any).from('tender_reference_materials').update({ extraction_status: 'pending' }).eq('id', ref.id)
      const result = await edgeFunctions.processReferenceMaterial({ reference_material_id: ref.id })
      if (result?.error) throw new Error(result.error)
      queryClient.invalidateQueries({ queryKey: ['tender-reference-library'] })
      toast.success('Re-extraction complete')
    } catch (err: any) {
      toast.error(err?.message || 'Re-extraction failed')
    } finally {
      setReExtractingId(null)
    }
  }, [queryClient])

  // ── Replace file (creates new version) ───────────────────────────────────
  const handleReplaceFile = useCallback(async (file: File) => {
    if (!selectedRef || !user) return
    setReplacingFile(true)
    try {
      // Archive current version to tender_reference_versions
      await (supabase as any).from('tender_reference_versions').insert({
        reference_material_id: selectedRef.id,
        version: selectedRef.version,
        file_name: selectedRef.file_name,
        file_path: selectedRef.file_path,
        file_kind: selectedRef.file_kind,
        extracted_text: selectedRef.extracted_text,
        replaced_by: user.id,
      })

      // Upload new file
      const fileKind = classifyFile(file)
      const ts = Date.now()
      const storagePath = `tender-references/${user.organization_id}/versions/${selectedRef.id}/v${selectedRef.version + 1}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(storagePath, file, { upsert: false })
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(storagePath)

      // Update reference record
      await (supabase as any).from('tender_reference_materials').update({
        file_name: file.name,
        file_path: storagePath,
        file_public_url: urlData?.publicUrl || null,
        file_kind: fileKind,
        extracted_text: null,
        extraction_status: 'pending',
        extraction_notes: null,
        version: selectedRef.version + 1,
        uploaded_by: user.id,
      }).eq('id', selectedRef.id)

      // Trigger extraction
      edgeFunctions.processReferenceMaterial({ reference_material_id: selectedRef.id })
        .catch(() => { /* non-fatal */ })

      queryClient.invalidateQueries({ queryKey: ['tender-reference-library'] })
      setSelectedRef(null)
      toast.success(`File replaced — now v${selectedRef.version + 1}. Extraction started.`)
    } catch (err: any) {
      toast.error(err?.message || 'File replace failed')
    } finally {
      setReplacingFile(false)
    }
  }, [selectedRef, user, queryClient])

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  function ExtractionBadge({ status }: { status: ExtractionStatus }) {
    const cfg = EXTRACTION_STATUS_CONFIG[status] || EXTRACTION_STATUS_CONFIG.pending
    const Icon = cfg.icon
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${cfg.color}`}>
        <Icon className={`h-3 w-3 ${status === 'extracting' ? 'animate-spin' : ''}`} />
        {cfg.label}
      </span>
    )
  }

  function TypeBadge({ type }: { type: MaterialType }) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium ${MATERIAL_TYPE_COLORS[type]}`}>
        {MATERIAL_TYPE_LABELS[type]}
      </span>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/tender-workspace')}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Tenders
            </Button>
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Reference Library
              </h1>
              <p className="text-xs text-muted-foreground">
                Org-wide reference materials Bob uses as context for all tender analysis and generation
              </p>
            </div>
          </div>
          {canEdit && (
            <Button onClick={() => setShowCreateDialog(true)} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Reference
            </Button>
          )}
        </div>

        {/* Upload zone (quick drag-drop shortcut) */}
        {canEdit && (
          <div
            className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) { setNewFile(f); setShowCreateDialog(true) }
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) { setNewFile(f); setShowCreateDialog(true) }
              }}
            />
            <div className="space-y-1">
              <Upload className="h-5 w-5 mx-auto text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Drag & drop a file to add a new reference, or click</p>
              <p className="text-xs text-muted-foreground/60">PDF, Word, Excel, CSV, TXT, images</p>
            </div>
          </div>
        )}

        {/* Reference list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Reference Materials
              <Badge variant="secondary" className="ml-auto text-xs">{refs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading reference library…
              </div>
            ) : isError ? (
              <div className="py-8 text-center text-sm text-muted-foreground space-y-2">
                <p>Could not load reference library.</p>
                <p className="text-xs text-red-500">{(error as any)?.message || 'Unknown error'}</p>
                <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                  {isFetching ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Retrying…</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Retry</>}
                </Button>
              </div>
            ) : refs.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <BookOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                <p>No reference materials yet.</p>
                {canEdit && (
                  <p className="text-xs mt-1">Click "Add Reference" or drag a file to get started.</p>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {refs.map((ref) => (
                  <div
                    key={ref.id}
                    className={`flex items-center gap-3 py-3 ${!ref.is_active ? 'opacity-50' : ''}`}
                  >
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{ref.title}</span>
                        <TypeBadge type={ref.material_type} />
                        <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">v{ref.version}</span>
                        <ExtractionBadge status={ref.extraction_status} />
                        {!ref.is_active && (
                          <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {ref.file_name ? `${ref.file_name} · ` : ''}{formatDateTime(ref.updated_at)}
                      </p>
                      {ref.extraction_notes && (
                        <p className="text-[10px] text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          {ref.extraction_notes.slice(0, 120)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canEdit && ref.file_path && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={reExtractingId === ref.id}
                          onClick={() => reExtract(ref)}
                          title="Re-run extraction"
                        >
                          {reExtractingId === ref.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => toggleActive.mutate({ id: ref.id, is_active: !ref.is_active })}
                          title={ref.is_active ? 'Deactivate' : 'Activate'}
                        >
                          {ref.is_active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => {
                          setSelectedRef(ref)
                          setEditedText(ref.extracted_text || '')
                          setEditingText(false)
                          setShowVersionHistory(false)
                        }}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Create reference dialog ──────────────────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={(o) => { if (!uploading) setShowCreateDialog(o) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Reference Material</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input
                placeholder="e.g. Pricing Guide 2025, Freedom Camping Act summary…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as MaterialType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(MATERIAL_TYPE_LABELS) as [MaterialType, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input
                placeholder="Brief description of what this reference covers…"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>

            {/* File drop zone inside dialog */}
            <div className="space-y-1.5">
              <Label>File (optional)</Label>
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors text-sm ${newFile ? 'border-green-400 bg-green-50 dark:bg-green-950' : 'border-muted-foreground/30 hover:border-primary/50'}`}
                onClick={() => replaceFileInputRef.current?.click()}
              >
                <input
                  ref={replaceFileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setNewFile(f) }}
                />
                {newFile ? (
                  <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-300">
                    <Check className="h-4 w-4" />
                    {newFile.name}
                    <Button size="sm" variant="ghost" className="h-6 px-1 ml-auto" onClick={(e) => { e.stopPropagation(); setNewFile(null) }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">Click or drag to attach a file — text will be auto-extracted</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Or paste / type text directly</Label>
              <Textarea
                placeholder="Paste reference text here. Bob will use this content directly (no extraction needed)."
                className="min-h-[100px] text-xs font-mono"
                value={newManualText}
                onChange={(e) => setNewManualText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setNewFile(null) }} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={createReference} disabled={uploading || !newTitle.trim()}>
              {uploading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating…</> : 'Add Reference'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reference detail drawer/dialog ───────────────────────────────────── */}
      <Dialog open={!!selectedRef} onOpenChange={(o) => { if (!o) setSelectedRef(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedRef && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <BookOpen className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{selectedRef.title}</span>
                  <TypeBadge type={selectedRef.material_type} />
                  <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">v{selectedRef.version}</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* Extraction status + notes */}
                <div className="flex items-start gap-2 flex-wrap">
                  <ExtractionBadge status={selectedRef.extraction_status} />
                  {selectedRef.extraction_notes && (
                    <span className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {selectedRef.extraction_notes}
                    </span>
                  )}
                </div>

                {/* File info */}
                {selectedRef.file_name && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground rounded border bg-muted/10 p-2">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span>{selectedRef.file_name}</span>
                    <Badge variant="outline" className="text-[10px]">{selectedRef.file_kind}</Badge>
                    {selectedRef.file_public_url && (
                      <a href={selectedRef.file_public_url} target="_blank" rel="noreferrer" className="ml-auto text-primary underline hover:no-underline">
                        View file
                      </a>
                    )}
                  </div>
                )}

                {/* Replace file */}
                {canEdit && (
                  <div className="flex gap-2 flex-wrap">
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReplaceFile(f) }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={replacingFile}
                        asChild
                      >
                        <span>
                          {replacingFile ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Replacing…</> : <><Upload className="h-3.5 w-3.5 mr-1.5" />Replace file (new version)</>}
                        </span>
                      </Button>
                    </label>
                    {selectedRef.file_path && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reExtractingId === selectedRef.id}
                        onClick={() => reExtract(selectedRef)}
                      >
                        {reExtractingId === selectedRef.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Re-extracting…</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Re-run extraction</>}
                      </Button>
                    )}
                  </div>
                )}

                {/* Extracted text editor */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Extracted text (used by Bob)</Label>
                    {canEdit && !editingText && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => { setEditingText(true); setEditedText(selectedRef.extracted_text || '') }}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                  </div>

                  {editingText ? (
                    <div className="space-y-2">
                      <Textarea
                        className="min-h-[200px] font-mono text-xs"
                        value={editedText}
                        onChange={(e) => setEditedText(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveTextEdit} disabled={savingText}>
                          {savingText ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
                          Save text
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingText(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded border bg-muted/10 p-3 max-h-48 overflow-auto">
                      {selectedRef.extracted_text ? (
                        <pre className="whitespace-pre-wrap text-xs">{selectedRef.extracted_text.slice(0, 3000)}{selectedRef.extracted_text.length > 3000 ? '\n…(truncated)' : ''}</pre>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No text extracted yet.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Version history */}
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => setShowVersionHistory(!showVersionHistory)}
                  >
                    <History className="h-3.5 w-3.5 mr-1.5" />
                    {showVersionHistory ? 'Hide' : 'Show'} version history
                  </Button>

                  {showVersionHistory && (
                    <div className="mt-2 space-y-2">
                      {versions.length === 0 ? (
                        <p className="text-xs text-muted-foreground pl-1">No previous versions.</p>
                      ) : (
                        versions.map((v) => (
                          <div key={v.id} className="rounded border bg-muted/10 p-2.5 text-xs space-y-1">
                            <div className="flex items-center gap-2 font-medium">
                              <span>v{v.version}</span>
                              {v.file_name && <span className="text-muted-foreground">{v.file_name}</span>}
                              <span className="text-muted-foreground ml-auto">{formatDateTime(v.replaced_at)}</span>
                            </div>
                            {v.extracted_text && (
                              <details className="text-[10px]">
                                <summary className="cursor-pointer text-muted-foreground">View old extracted text</summary>
                                <pre className="mt-1 whitespace-pre-wrap bg-muted/20 p-2 rounded max-h-32 overflow-auto">{v.extracted_text.slice(0, 1000)}</pre>
                              </details>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedRef(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
