import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime } from '@/lib/utils'
import {
  BrainCircuit,
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  FilePlus2,
  Upload,
  User2,
  Users,
  Building2,
  CheckCircle2,
  AlertCircle,
  Clock3,
} from 'lucide-react'
import { toast } from 'sonner'

type TenderStatus =
  | 'draft' | 'staged' | 'assessed' | 'drafting'
  | 'review_pending' | 'approved' | 'submitted' | 'archived'

type DocumentType =
  | 'rfp' | 'rfi' | 'rfq' | 'rfip'
  | 'tender_application' | 'tender_response' | 'proposal' | 'other'

interface TenderDocument {
  id: string
  title: string
  document_type: DocumentType
  issuing_body: string | null
  reference_number: string | null
  due_date: string | null
  status: TenderStatus
  owner_id: string
  organization_id: string
  created_at: string
  updated_at: string
  bob_assessment_summary: string | null
  // owner profile joined
  owner?: { first_name: string | null; last_name: string | null }
  // collaborator count joined
  collaborator_count?: number
}

const STATUS_CONFIG: Record<TenderStatus, { label: string; color: string }> = {
  draft:          { label: 'Draft',          color: 'bg-gray-100 text-gray-700 border-gray-300' },
  staged:         { label: 'Staged',         color: 'bg-blue-100 text-blue-700 border-blue-300' },
  assessed:       { label: 'Assessed',       color: 'bg-purple-100 text-purple-700 border-purple-300' },
  drafting:       { label: 'Drafting',       color: 'bg-amber-100 text-amber-700 border-amber-300' },
  review_pending: { label: 'Pending Review', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  approved:       { label: 'Approved',       color: 'bg-green-100 text-green-700 border-green-300' },
  submitted:      { label: 'Submitted',      color: 'bg-teal-100 text-teal-700 border-teal-300' },
  archived:       { label: 'Archived',       color: 'bg-slate-100 text-slate-500 border-slate-200' },
}

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  rfp: 'RFP',
  rfi: 'RFI',
  rfq: 'RFQ',
  rfip: 'RFIP',
  tender_application: 'Tender Application',
  tender_response: 'Tender Response',
  proposal: 'Proposal',
  other: 'Other',
}

let extractionModulePromise: Promise<typeof import('@/lib/documentExtraction')> | null = null
async function extractDocumentDataLazy(file: File, options?: { enableImageOcr?: boolean }) {
  if (!extractionModulePromise) extractionModulePromise = import('@/lib/documentExtraction')
  const mod = await extractionModulePromise
  return mod.extractDocumentData(file, options)
}

function classifyFile(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'spreadsheet'
  if (['pdf'].includes(ext)) return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'document'
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return 'image'
  if (['txt', 'json'].includes(ext)) return 'text'
  return 'unknown'
}

export default function TenderWorkspace() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [tabFilter, setTabFilter] = useState<'all' | 'mine' | 'pending_approval' | 'submitted'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [pastedText, setPastedText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    title: '',
    document_type: 'rfip' as DocumentType,
    issuing_body: '',
    reference_number: '',
    due_date: '',
    description: '',
  })

  // Fetch tender documents
  const { data: docs = [], isLoading } = useQuery<TenderDocument[]>({
    queryKey: ['tender-documents', user?.id, user?.role, tabFilter],
    enabled: !!user,
    queryFn: async () => {
      let q = ((supabase as any).from('tender_documents') as any)
        .select(`
          id, title, document_type, issuing_body, reference_number, due_date,
          status, owner_id, organization_id, created_at, updated_at,
          bob_assessment_summary
        `)
        .order('updated_at', { ascending: false })
        .limit(100)

      if (tabFilter === 'mine') {
        q = q.eq('owner_id', user!.id)
      } else if (tabFilter === 'pending_approval') {
        q = q.eq('status', 'review_pending')
      } else if (tabFilter === 'submitted') {
        q = q.eq('status', 'submitted')
      }

      const { data, error } = await q
      if (error) throw error
      return (data || []) as TenderDocument[]
    },
  })

  // Create document mutation
  const createDoc = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error('Title is required')
      if (!user) throw new Error('Not authenticated')

      let extractedText = pastedText.trim()
      let fileName: string | null = null
      let fileKind: string | null = null
      let filePath: string | null = null
      let filePublicUrl: string | null = null

      // Upload file to Storage if provided
      if (file) {
        fileName = file.name
        fileKind = classifyFile(file)
        const storagePath = `tenders/${user.organization_id}/${Date.now()}-${file.name}`
        const { error: uploadErr } = await supabase.storage
          .from('evidence')
          .upload(storagePath, file, { upsert: false })
        if (uploadErr) throw new Error(`File upload failed: ${uploadErr.message}`)
        const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(storagePath)
        filePath = storagePath
        filePublicUrl = urlData?.publicUrl ?? null

        // Extract text for analysis
        if (!extractedText) {
          try {
            const isImage = fileKind === 'image'
            const extracted = await extractDocumentDataLazy(file, { enableImageOcr: isImage })
            extractedText = extracted.text
          } catch {
            // Non-fatal — Bob can stage and analyse later
          }
        }
      }

      const { data, error } = await ((supabase as any).from('tender_documents') as any)
        .insert({
          organization_id: user.organization_id,
          owner_id: user.id,
          title: form.title.trim(),
          document_type: form.document_type,
          issuing_body: form.issuing_body.trim() || null,
          reference_number: form.reference_number.trim() || null,
          due_date: form.due_date || null,
          description: form.description.trim() || null,
          status: extractedText ? 'staged' : 'draft',
          extracted_text: extractedText || null,
          file_name: fileName,
          file_kind: fileKind,
          file_path: filePath,
          file_public_url: filePublicUrl,
        })
        .select('id')
        .single()

      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tender-documents'] })
      setCreateOpen(false)
      resetCreateForm()
      toast.success('Document created')
      navigate(`/tender-workspace/${data.id}`)
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create document'),
  })

  function resetCreateForm() {
    setForm({ title: '', document_type: 'rfip', issuing_body: '', reference_number: '', due_date: '', description: '' })
    setPastedText('')
    setFile(null)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (text) {
      e.preventDefault()
      setPastedText((prev) => prev + text)
    }
  }, [])

  const filteredDocs = useMemo(() => docs, [docs])

  return (
    <AppLayout
      title="Tender & Document Workspace"
      description="Manage RFP/RFIP responses, tender applications, and Bob-powered document analysis."
      showBackButton
    >
      <GlobalFilterRibbon />

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={tabFilter} onValueChange={(v) => setTabFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All Documents</TabsTrigger>
            <TabsTrigger value="mine">My Documents</TabsTrigger>
            <TabsTrigger value="pending_approval">Pending Approval</TabsTrigger>
            <TabsTrigger value="submitted">Submitted</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
          <FilePlus2 className="h-4 w-4" />
          New Tender / Document
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading tender documents…</div>
      ) : filteredDocs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">No tender documents yet.</p>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <FilePlus2 className="h-4 w-4 mr-2" />
              Create first document
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredDocs.map((doc) => {
            const st = STATUS_CONFIG[doc.status] ?? { label: doc.status, color: 'bg-gray-100 text-gray-600' }
            const isOverdue = doc.due_date && new Date(doc.due_date) < new Date() && !['submitted', 'archived'].includes(doc.status)
            return (
              <Card
                key={doc.id}
                className="cursor-pointer hover:shadow-md transition-shadow border"
                onClick={() => navigate(`/tender-workspace/${doc.id}`)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold leading-snug flex items-start justify-between gap-2">
                    <span className="flex-1 line-clamp-2">{doc.title}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                    </Badge>
                    <span className={`inline-flex items-center px-1.5 py-0 rounded border text-[10px] ${st.color}`}>
                      {st.label}
                    </span>
                    {isOverdue && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded border text-[10px] bg-red-100 text-red-700 border-red-300">
                        <AlertCircle className="h-2.5 w-2.5" /> Overdue
                      </span>
                    )}
                  </div>

                  {doc.issuing_body && (
                    <div className="flex items-center gap-1">
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{doc.issuing_body}</span>
                    </div>
                  )}

                  {doc.due_date && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span>Due {new Date(doc.due_date).toLocaleDateString('en-NZ')}</span>
                    </div>
                  )}

                  {doc.bob_assessment_summary && (
                    <div className="flex items-start gap-1 mt-1">
                      <BrainCircuit className="h-3 w-3 shrink-0 text-primary mt-0.5" />
                      <span className="line-clamp-2 text-foreground/70">{doc.bob_assessment_summary}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-1 border-t border-dashed">
                    <div className="flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      <span>{formatDateTime(doc.updated_at)}</span>
                    </div>
                    <Button asChild size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]">
                      <Link to={`/tender-workspace/${doc.id}`}>Open Document</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Create New Document Dialog ──────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePlus2 className="h-5 w-5 text-primary" />
              New Tender / Document
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="title">Document Title *</Label>
                <Input
                  id="title"
                  placeholder="e.g. Security Services RFIP — Marlborough DC"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc_type">Document Type</Label>
                <Select
                  value={form.document_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, document_type: v as DocumentType }))}
                >
                  <SelectTrigger id="doc_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rfip">RFIP — Request for Information & Pricing</SelectItem>
                    <SelectItem value="rfp">RFP — Request for Proposal</SelectItem>
                    <SelectItem value="rfi">RFI — Request for Information</SelectItem>
                    <SelectItem value="rfq">RFQ — Request for Quote</SelectItem>
                    <SelectItem value="tender_application">Tender Application</SelectItem>
                    <SelectItem value="tender_response">Tender Response</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="due_date">Submission Due Date</Label>
                <Input
                  id="due_date"
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="issuing_body">Issuing Body</Label>
                <Input
                  id="issuing_body"
                  placeholder="e.g. Marlborough District Council"
                  value={form.issuing_body}
                  onChange={(e) => setForm((f) => ({ ...f, issuing_body: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Bob will auto-create a CRM client if this organisation isn&apos;t found.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ref_num">Reference Number</Label>
                <Input
                  id="ref_num"
                  placeholder="e.g. MDC-2026-RFIP-004"
                  value={form.reference_number}
                  onChange={(e) => setForm((f) => ({ ...f, reference_number: e.target.value }))}
                />
              </div>
            </div>

            {/* File Drop Zone */}
            <div className="space-y-1.5">
              <Label>Upload Document (optional)</Label>
              <div
                className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                  isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) setFile(f)
                  }}
                />
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-foreground">
                    <FileText className="h-5 w-5 text-primary" />
                    <span className="font-medium">{file.name}</span>
                    <button
                      className="text-muted-foreground hover:text-destructive ml-1 text-xs underline"
                      onClick={(e) => { e.stopPropagation(); setFile(null) }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Drag & drop or click to upload
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      PDF, Word, Excel, CSV, images — Bob will extract and analyse
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Paste text area */}
            <div className="space-y-1.5">
              <Label htmlFor="pasted_text">Or paste document content</Label>
              <Textarea
                id="pasted_text"
                placeholder="Paste the RFP or tender document text here…"
                className="min-h-[100px] font-mono text-xs"
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                onPaste={handlePaste}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm() }}>
              Cancel
            </Button>
            <Button
              onClick={() => createDoc.mutate()}
              disabled={!form.title.trim() || createDoc.isPending}
            >
              {createDoc.isPending ? 'Creating…' : 'Create Document'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
