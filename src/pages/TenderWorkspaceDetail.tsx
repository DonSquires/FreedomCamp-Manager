import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { generateTenderHtml, exportTenderPdf, downloadTenderDoc } from '@/lib/tenderExport'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime } from '@/lib/utils'
import {
  AlertCircle,
  BookOpen,
  BrainCircuit,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  Printer,
  Send,
  Shield,
  Star,
  Trash2,
  Upload,
  User2,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ])
}

const ANALYSIS_MAX_WAIT_MS = 240_000

type TenderStatus =
  | 'draft' | 'staged' | 'assessed' | 'drafting'
  | 'review_pending' | 'shortlisted' | 'approved' | 'submitted' | 'archived'

type CollaboratorRole = 'editor' | 'viewer' | 'approver'

interface TenderDocument {
  id: string
  title: string
  document_type: string
  issuing_body: string | null
  reference_number: string | null
  due_date: string | null
  description: string | null
  status: TenderStatus
  owner_id: string
  organization_id: string
  crm_client_organization_id: string | null
  file_name: string | null
  file_path: string | null
  file_public_url: string | null
  file_kind: string | null
  extracted_text: string | null
  bob_assessment: any
  bob_assessment_summary: string | null
  key_services: string[] | null
  key_requirements: string[] | null
  key_dates: Array<{ label: string; date: string }> | null
  enrichment_data: any
  response_sections: Record<string, string> | null
  generated_html: string | null
  approved_by: string | null
  approved_at: string | null
  approval_notes: string | null
  created_at: string
  updated_at: string
  // Generation tracking (from Bob /tender/generate)
  draft_sections: Record<string, string> | null
  generation_type: 'application' | 'response' | null
  generation_provider: string | null
  generation_model: string | null
  last_generated_at: string | null
  last_generated_by: string | null
}

interface Collaborator {
  id: string
  document_id: string
  user_id: string
  role: CollaboratorRole
  invited_by: string | null
  created_at: string
  user?: { first_name: string | null; last_name: string | null; email: string | null }
}

interface Comment {
  id: string
  document_id: string
  user_id: string
  content: string
  is_approval_note: boolean
  created_at: string
  user?: { first_name: string | null; last_name: string | null }
}

const STATUS_CONFIG: Record<TenderStatus, { label: string; color: string }> = {
  draft:          { label: 'Draft',          color: 'bg-gray-100 text-gray-700 border-gray-300' },
  staged:         { label: 'Staged',         color: 'bg-blue-100 text-blue-700 border-blue-300' },
  assessed:       { label: 'Assessed',       color: 'bg-purple-100 text-purple-700 border-purple-300' },
  drafting:       { label: 'Drafting',       color: 'bg-amber-100 text-amber-700 border-amber-300' },
  review_pending: { label: 'Pending Review', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  shortlisted:    { label: 'Shortlisted',    color: 'bg-sky-100 text-sky-700 border-sky-300' },
  approved:       { label: 'Approved',       color: 'bg-green-100 text-green-700 border-green-300' },
  submitted:      { label: 'Submitted',      color: 'bg-teal-100 text-teal-700 border-teal-300' },
  archived:       { label: 'Archived',       color: 'bg-slate-100 text-slate-500 border-slate-200' },
}

let extractionModulePromise: Promise<typeof import('@/lib/documentExtraction')> | null = null
async function extractDocumentDataLazy(file: File, opts?: { enableImageOcr?: boolean }) {
  if (!extractionModulePromise) extractionModulePromise = import('@/lib/documentExtraction')
  const mod = await extractionModulePromise
  return mod.extractDocumentData(file, opts)
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

function userName(u?: { first_name: string | null; last_name: string | null } | null): string {
  if (!u) return 'Unknown'
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Unknown'
}

interface RequirementCoverageRow {
  requirement: string
  mandatory: boolean
  covered: boolean
  matchedTokens: number
  totalTokens: number
  weightPercent: number | null
}

const REQUIREMENT_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'must', 'shall', 'should', 'will',
  'your', 'their', 'have', 'has', 'into', 'onto', 'about', 'were', 'been', 'being', 'also',
  'provide', 'provided', 'including', 'requirement', 'requirements', 'service', 'services',
  'tender', 'response', 'application', 'submission', 'document', 'organisation', 'organization',
])

function isMandatoryRequirement(requirement: string): boolean {
  return /\b(must|mandatory|required|shall|non-negotiable|compliance required|compulsory)\b/i.test(requirement)
}

function requirementTokens(requirement: string): string[] {
  const tokens = (requirement.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])
    .filter((token) => !REQUIREMENT_STOP_WORDS.has(token))
  return Array.from(new Set(tokens)).slice(0, 8)
}

function requirementWeightPercent(requirement: string): number | null {
  const match = requirement.match(/(?:\[WEIGHT\s*)?(\d{1,2})\s*%\]?/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function normalizeCoverageText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function evaluateRequirementCoverage(
  requirements: string[] | null | undefined,
  sections: Record<string, string> | null | undefined,
): { missingMandatory: string[]; uncovered: string[]; rows: RequirementCoverageRow[] } {
  const reqs = (requirements || []).filter((r) => typeof r === 'string' && r.trim().length > 0)
  if (reqs.length === 0) return { missingMandatory: [], uncovered: [], rows: [] }

  const corpus = Object.values(sections || {})
    .filter((v) => typeof v === 'string')
    .join('\n')
  const normalizedCorpus = normalizeCoverageText(corpus)

  if (!normalizedCorpus.trim()) {
    const mandatoryOnly = reqs.filter((r) => isMandatoryRequirement(r))
    const rows = reqs.map((r) => ({
      requirement: r,
      mandatory: isMandatoryRequirement(r),
      covered: false,
      matchedTokens: 0,
      totalTokens: requirementTokens(r).length,
      weightPercent: requirementWeightPercent(r),
    }))
    return {
      missingMandatory: mandatoryOnly,
      uncovered: reqs,
      rows,
    }
  }

  const uncovered: string[] = []
  const missingMandatory: string[] = []
  const rows: RequirementCoverageRow[] = []

  for (const req of reqs) {
    const tokens = requirementTokens(req)
    const normalizedRequirement = normalizeCoverageText(req)

    if (tokens.length === 0) {
      const covered = normalizedRequirement.length >= 8 && normalizedCorpus.includes(normalizedRequirement)
      if (!covered) {
        uncovered.push(req)
        if (isMandatoryRequirement(req)) missingMandatory.push(req)
      }
      rows.push({
        requirement: req,
        mandatory: isMandatoryRequirement(req),
        covered,
        matchedTokens: covered ? 1 : 0,
        totalTokens: 1,
        weightPercent: requirementWeightPercent(req),
      })
      continue
    }

    const matched = tokens.filter((token) => normalizedCorpus.includes(token)).length
    const tokenRatio = matched / tokens.length
    const minHits = tokens.length <= 3 ? 1 : Math.min(3, Math.ceil(tokens.length * 0.45))
    const phraseHit = normalizedRequirement.length >= 12 && normalizedCorpus.includes(normalizedRequirement)
    const covered = phraseHit || matched >= minHits || tokenRatio >= 0.65

    if (!covered) {
      uncovered.push(req)
      if (isMandatoryRequirement(req)) {
        missingMandatory.push(req)
      }
    }

    rows.push({
      requirement: req,
      mandatory: isMandatoryRequirement(req),
      covered,
      matchedTokens: matched,
      totalTokens: tokens.length,
      weightPercent: requirementWeightPercent(req),
    })
  }

  return {
    missingMandatory,
    uncovered,
    rows: rows.sort((a, b) => {
      const am = a.mandatory ? 1 : 0
      const bm = b.mandatory ? 1 : 0
      if (bm !== am) return bm - am
      const aw = a.weightPercent || 0
      const bw = b.weightPercent || 0
      return bw - aw
    }),
  }
}

export default function TenderWorkspaceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState('intake')
  const [extracting, setExtracting] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [analysingElapsed, setAnalysingElapsed] = useState(0)
  const analysingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<CollaboratorRole>('editor')
  const [inviting, setInviting] = useState(false)

  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)

  const [approvalNote, setApprovalNote] = useState('')
  const [approvingDoc, setApprovingDoc] = useState(false)

  const [sections, setSections] = useState<Record<string, string>>({})
  const [savingSections, setSavingSections] = useState(false)

  // Bob generation state
  const [generationType, setGenerationType] = useState<'application' | 'response'>('response')
  const [generating, setGenerating] = useState(false)
  const [lastGenerationMeta, setLastGenerationMeta] = useState<{ provider: string; model_used: string } | null>(null)

  // Reference materials state
  // Map of reference_material_id -> included (true=included, false=excluded)
  const [refInclusions, setRefInclusions] = useState<Record<string, boolean>>({})
  const [savingRefInclusion, setSavingRefInclusion] = useState(false)
  const [lastAnalysisRefCount, setLastAnalysisRefCount] = useState<{ used: number; total: number; at: string | null } | null>(null)

  // Rejection dialog state
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectCategory, setRejectCategory] = useState<'pricing' | 'scope' | 'qualifications' | 'compliance' | 'formatting' | 'other'>('other')
  const [rejecting, setRejecting] = useState(false)

  // Shortlist feedback state
  const [showShortlistDialog, setShowShortlistDialog] = useState(false)
  const [shortlistFeedback, setShortlistFeedback] = useState('')
  const [shortlisting, setShortlisting] = useState(false)

  // Fetch document — polls every 5s to detect background AI task completion
  const { data: doc, isLoading, isError, error, refetch, isFetching } = useQuery<TenderDocument>({
    queryKey: ['tender-document', id],
    enabled: !!id,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await withTimeout<{ data: any; error: any }>(
        ((supabase as any).from('tender_documents') as any)
          .select('*')
          .eq('id', id!)
          .single(),
        20000,
        'Loading tender document',
      )
      if (error) throw error
      return data as TenderDocument
    },
  })

  // Fetch collaborators
  const { data: collaborators = [] } = useQuery<Collaborator[]>({
    queryKey: ['tender-collaborators', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('tender_collaborators') as any)
        .select('*, user:user_id(first_name, last_name, email)')
        .eq('document_id', id!)
        .order('created_at')
      if (error) throw error
      return (data || []) as Collaborator[]
    },
  })

  // Fetch comments
  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey: ['tender-comments', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('tender_comments') as any)
        .select('*, user:user_id(first_name, last_name)')
        .eq('document_id', id!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []) as Comment[]
    },
  })

  // Fetch owner profile
  const { data: ownerProfile } = useQuery({
    queryKey: ['tender-owner', doc?.owner_id],
    enabled: !!doc?.owner_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('user_profiles')
        .select('first_name, last_name')
        .eq('id', doc!.owner_id)
        .single()
      return data as { first_name: string | null; last_name: string | null } | null
    },
  })

  // Fetch the organization name for export metadata
  const { data: orgData } = useQuery({
    queryKey: ['tender-org-name', doc?.organization_id],
    enabled: !!doc?.organization_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('organizations')
        .select('name')
        .eq('id', doc!.organization_id)
        .single()
      return data as { name: string } | null
    },
  })

  // Sync sections state from doc — prefer draft_sections (Bob-generated) over response_sections
  useEffect(() => {
    if (!doc) return
    const s = doc?.draft_sections || doc?.response_sections
    if (s) setSections(s)
  }, [doc])

  // Fetch org-wide reference materials
  const { data: orgRefs = [] } = useQuery({
    queryKey: ['tender-ref-materials', doc?.organization_id],
    enabled: !!doc?.organization_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tender_reference_materials')
        .select('id, title, material_type, extraction_status, extraction_notes, version, is_active, updated_at')
        .eq('organization_id', doc!.organization_id)
        .eq('is_active', true)
        .order('material_type')
        .order('title')
      if (error) throw error
      return (data || []) as Array<{
        id: string; title: string; material_type: string; extraction_status: string
        extraction_notes: string | null; version: number; is_active: boolean; updated_at: string
      }>
    },
  })

  // Fetch saved inclusion state for this document
  const { data: savedDocRefs = [] } = useQuery({
    queryKey: ['tender-doc-references', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tender_document_references')
        .select('reference_material_id, included, used_in_analysis, analysis_run_at')
        .eq('document_id', id!)
      if (error) throw error
      return (data || []) as Array<{ reference_material_id: string; included: boolean; used_in_analysis: boolean; analysis_run_at: string | null }>
    },
  })

  // Sync refInclusions from DB on load (default: all active refs included)
  useEffect(() => {
    if (!orgRefs.length) return
    const newInclusions: Record<string, boolean> = {}
    for (const ref of orgRefs) {
      const saved = savedDocRefs.find(s => s.reference_material_id === ref.id)
      newInclusions[ref.id] = saved ? saved.included : true
    }
    setRefInclusions(newInclusions)
    // Compute last analysis stats
    const usedRefs = savedDocRefs.filter(r => r.used_in_analysis)
    if (usedRefs.length > 0) {
      const latestAt = usedRefs.reduce((acc, r) => (!acc || (r.analysis_run_at && r.analysis_run_at > acc)) ? r.analysis_run_at : acc, null as string | null)
      setLastAnalysisRefCount({ used: usedRefs.length, total: orgRefs.length, at: latestAt })
    }
  }, [orgRefs, savedDocRefs])

  const isOwner = doc?.owner_id === user?.id
  const isAdminOrAbove = ['admin', 'master', 'grand_master'].includes(user?.role ?? '')
  const canEdit = isOwner || isAdminOrAbove ||
    collaborators.some((c) => c.user_id === user?.id && c.role === 'editor')
  const canApprove = isOwner || isAdminOrAbove ||
    collaborators.some((c) => c.user_id === user?.id && c.role === 'approver')

  // IDs of currently included references (extracted=ok only)
  const includedRefIds = orgRefs
    .filter(r => refInclusions[r.id] !== false && r.extraction_status === 'extracted')
    .map(r => r.id)

  // ── Toggle reference inclusion ─────────────────────────────────────────────
  const toggleRefInclusion = useCallback(async (refId: string, included: boolean) => {
    setRefInclusions(prev => ({ ...prev, [refId]: included }))
    setSavingRefInclusion(true)
    try {
      await (supabase as any)
        .from('tender_document_references')
        .upsert({ document_id: id!, reference_material_id: refId, included }, { onConflict: 'document_id,reference_material_id' })
      queryClient.invalidateQueries({ queryKey: ['tender-doc-references', id] })
    } catch {
      // Non-fatal — local state stays updated
    } finally {
      setSavingRefInclusion(false)
    }
  }, [id, queryClient])

  // ── File intake handlers ────────────────────────────────────────────────────
  const handleFileIntake = useCallback(async (file: File) => {
    if (!doc || !canEdit) return
    setExtracting(true)
    try {
      const kind = classifyFile(file)
      const storagePath = `tenders/${doc.organization_id}/${Date.now()}-${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('evidence')
        .upload(storagePath, file, { upsert: false })
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)
      const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(storagePath)

      let extractedText = ''
      try {
        const extracted = await extractDocumentDataLazy(file, { enableImageOcr: kind === 'image' })
        extractedText = extracted.text
      } catch {
        // Non-fatal
      }

      await ((supabase as any).from('tender_documents') as any)
        .update({
          file_name: file.name,
          file_kind: kind,
          file_path: storagePath,
          file_public_url: urlData?.publicUrl ?? null,
          extracted_text: extractedText || null,
          status: extractedText ? 'staged' : 'draft',
        })
        .eq('id', doc.id)

      queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
      toast.success('File uploaded and text extracted')
    } catch (err: any) {
      toast.error(err?.message || 'File intake failed')
    } finally {
      setExtracting(false)
    }
  }, [doc, canEdit, id, queryClient])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileIntake(f)
  }, [handleFileIntake])

  // ── Run Bob Analysis (fire-and-forget) ─────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    if (!doc || !canEdit) return
    if (!doc.extracted_text?.trim()) {
      toast.error('No text to analyse. Please upload a file or paste content first.')
      return
    }
    setAnalysing(true)
    setAnalysingElapsed(0)
    analysingTimerRef.current = setInterval(() => setAnalysingElapsed(s => s + 1), 1000)

    // Poll DB every 5s — the edge fn takes up to 110s and the supabase SDK
    // fetch can silently hang without resolving, so we detect completion via DB.
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let completed = false

    const cleanup = () => {
      if (analysingTimerRef.current) { clearInterval(analysingTimerRef.current); analysingTimerRef.current = null }
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
      setAnalysing(false)
      setAnalysingElapsed(0)
    }

    const startedAt = Date.now()

    pollInterval = setInterval(async () => {
      try {
        if (Date.now() - startedAt > ANALYSIS_MAX_WAIT_MS) {
          completed = true
          cleanup()
          queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
          try {
            const { data: health } = await edgeFunctions.checkRailwayHealth()
            const inferenceStatus = (health as any)?.services?.inference?.status || 'unknown'
            const ollamaStatus = (health as any)?.services?.ollama?.status || 'unknown'
            toast.error(`Bob analysis timed out (${Math.round(ANALYSIS_MAX_WAIT_MS / 1000)}s). Inference: ${inferenceStatus}, Ollama: ${ollamaStatus}. Retry once.`)
          } catch {
            toast.error('Bob analysis is taking too long. Please retry once or check Bob service health.')
          }
          return
        }

        const { data } = await (supabase as any)
          .from('tender_documents')
          .select('status, bob_assessment_summary, bob_assessment')
          .eq('id', doc.id)
          .single()

        const summary = (data?.bob_assessment_summary || '').trim()
        const hasErrorSummary = summary.startsWith('❌') || summary.startsWith('⚠️')
        const hasAssessmentPayload = !!data?.bob_assessment
        const hasNonPlaceholderSummary = summary.length > 0 && !summary.startsWith('⏳')

        if (data?.status === 'assessed' || hasAssessmentPayload || hasNonPlaceholderSummary) {
          completed = true
          cleanup()
          queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
          if (hasErrorSummary) {
            toast.error(summary)
          } else {
            toast.success('Bob has completed the analysis')
            setActiveTab('assessment')
          }
        } else if (data?.status === 'staged' && hasErrorSummary) {
          // Edge function wrote an error back to DB
          completed = true
          cleanup()
          queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
          toast.error(summary)
        }
      } catch { /* ignore poll errors */ }
    }, 5000)

    try {
      const startAnalysisAttempt = async () => {
        return edgeFunctions.processTenderDocument({
          document_id: doc.id,
          extracted_text: doc.extracted_text,
          force_enrich: true,
          reference_ids: includedRefIds,
        })
      }

      const isTransientStartError = (msg: string) => {
        const m = String(msg || '').toLowerCase()
        return (
          m.includes('timed out') ||
          m.includes('unable to reach') ||
          m.includes('network') ||
          m.includes('relay')
        )
      }

      // Fire-and-forget: edge function returns 202 immediately and processes in background.
      // The 5s refetchInterval on the document query will detect the status change to 'assessed'.
      let firstErr: any = null
      try {
        await startAnalysisAttempt()
      } catch (err: any) {
        firstErr = err
      }

      if (firstErr) {
        const message = firstErr?.message || String(firstErr)
        if (!isTransientStartError(message)) {
          throw firstErr
        }
        toast.message('First Bob start attempt timed out; retrying once...')
        await startAnalysisAttempt()
      }

      // 202 accepted — don't wait for AI to finish. Keep spinner running until
      // the polling detects status change from 'staged' to 'assessed'.
      toast.info('Bob is analysing in the background — the assessment tab will update automatically')
      setActiveTab('assessment')
    } catch (err: any) {
      toast.error(err?.message || 'Analysis failed to start')
      cleanup()
    }
    // Note: spinner cleared by useEffect below when doc.status changes to 'assessed'
  }, [doc, canEdit, id, queryClient, includedRefIds])

  // Clear analysing spinner when status transitions to 'assessed'
  useEffect(() => {
    if (!analysing) return
    if (doc?.status === 'assessed') {
      if (analysingTimerRef.current) { clearInterval(analysingTimerRef.current); analysingTimerRef.current = null }
      setAnalysing(false)
      setAnalysingElapsed(0)
      queryClient.invalidateQueries({ queryKey: ['tender-doc-references', id] })
    }
  }, [doc?.status, analysing, id, queryClient])

  // ── Update status ───────────────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async (status: TenderStatus) => {
      const { error } = await ((supabase as any).from('tender_documents') as any)
        .update({ status })
        .eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tender-document', id] }),
    onError: (e: any) => toast.error(e?.message || 'Status update failed'),
  })

  // ── Save sections ───────────────────────────────────────────────────────────
  const saveSections = useCallback(async () => {
    if (!doc || !canEdit) return
    setSavingSections(true)
    try {
      const { error } = await ((supabase as any).from('tender_documents') as any)
        .update({ response_sections: sections, status: 'drafting' })
        .eq('id', doc.id)
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
      toast.success('Draft saved')
    } catch (err: any) {
      toast.error(err?.message || 'Save failed')
    } finally {
      setSavingSections(false)
    }
  }, [doc, canEdit, sections, id, queryClient])

  // ── Generate with Bob (fire-and-forget) ────────────────────────────────────
  const generateWithBob = useCallback(async () => {
    if (!doc || !canEdit) return
    if (!doc.extracted_text?.trim() && !doc.bob_assessment) {
      toast.error('Run Bob Analysis first so Bob understands the tender before drafting')
      return
    }
    setGenerating(true)
    try {
      // Fire-and-forget: edge function returns 202 immediately.
      // The 5s refetchInterval will detect the new draft_sections.
      await edgeFunctions.generateTenderSections({
        document_id: doc.id,
        generation_type: generationType,
        organization_context: {},
        reference_ids: includedRefIds,
      })
      toast.info('Bob is drafting in the background — the Draft Response tab will update automatically')
      setActiveTab('draft')
    } catch (err: any) {
      toast.error(err?.message || 'Bob generation failed to start')
      setGenerating(false)
    }
    // Note: generating cleared by useEffect below when draft_sections updates
  }, [doc, canEdit, generationType, id, includedRefIds])

  // Detect when Bob finishes generating (last_generated_at timestamp changes)
  const prevGeneratedAt = useRef<string | null>(null)
  useEffect(() => {
    if (!generating) return
    if (doc?.last_generated_at && doc.last_generated_at !== prevGeneratedAt.current) {
      prevGeneratedAt.current = doc.last_generated_at
      const s = doc.draft_sections || doc.response_sections
      if (s) setSections(s)
      setLastGenerationMeta({ provider: doc.generation_provider || 'heuristic', model_used: doc.generation_model || 'template' })
      setGenerating(false)
      queryClient.invalidateQueries({ queryKey: ['tender-doc-references', id] })
      toast.success('Draft generated by Bob')
    }
  }, [doc?.last_generated_at, generating, doc, id, queryClient])

  // ── Submit for approval ─────────────────────────────────────────────────────
  const submitForApproval = useCallback(async () => {
    if (!doc || !canEdit) return

    const coverage = evaluateRequirementCoverage(doc.key_requirements, sections)
    if (coverage.missingMandatory.length > 0) {
      const sample = coverage.missingMandatory.slice(0, 2).join(' | ')
      toast.error(`Cannot submit: ${coverage.missingMandatory.length} mandatory requirement(s) are not evidenced in the draft. ${sample}`)
      setActiveTab('draft')
      return
    }

    if (coverage.uncovered.length > 0) {
      toast.info(`Draft submitted with ${coverage.uncovered.length} uncovered non-mandatory requirement(s). Review recommended.`)
    }

    await updateStatus.mutateAsync('review_pending')
    toast.success('Submitted for approval')
  }, [doc, canEdit, sections, updateStatus])

  // ── Approve document ────────────────────────────────────────────────────────
  const approveDocument = useCallback(async () => {
    if (!doc || !canApprove) return
    setApprovingDoc(true)
    try {
      const { error } = await ((supabase as any).from('tender_documents') as any)
        .update({
          status: 'approved',
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
          approval_notes: approvalNote.trim() || null,
        })
        .eq('id', doc.id)
      if (error) throw error

      if (approvalNote.trim()) {
        await ((supabase as any).from('tender_comments') as any).insert({
          document_id: doc.id,
          user_id: user!.id,
          content: approvalNote.trim(),
          is_approval_note: true,
        })
      }

      // Trigger Bob self-learning — silently, don't block approval on failure
      edgeFunctions.generateTenderSections({
        document_id: doc.id,
        generation_type: doc.generation_type || generationType,
        trigger_training: true,
        outcome: 'approved',
        outcome_notes: approvalNote.trim() || 'Approved by owner/approver',
        reference_ids: includedRefIds,
      }).catch(() => { /* non-fatal */ })

      queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
      queryClient.invalidateQueries({ queryKey: ['tender-comments', id] })
      setApprovalNote('')
      toast.success('Document approved — Bob is learning from this approval')
    } catch (err: any) {
      toast.error(err?.message || 'Approval failed')
    } finally {
      setApprovingDoc(false)
    }
  }, [doc, canApprove, approvalNote, user, generationType, id, queryClient, includedRefIds])

  // ── Reject document (Return to Draft with feedback) ─────────────────────────
  const rejectDocument = useCallback(async () => {
    if (!doc || !canApprove) return
    if (!rejectReason.trim()) { toast.error('Please enter a rejection reason'); return }
    setRejecting(true)
    try {
      const { error } = await (supabase as any)
        .from('tender_documents')
        .update({
          status: 'drafting',
          training_outcome_reason: rejectReason.trim(),
          rejection_category: rejectCategory,
        })
        .eq('id', doc.id)
      if (error) throw error

      // Add approval comment (rejection note)
      await (supabase as any).from('tender_comments').insert({
        document_id: doc.id,
        user_id: user!.id,
        content: `[REJECTED — ${rejectCategory}] ${rejectReason.trim()}`,
        is_approval_note: true,
      })

      // Trigger Bob self-learning with rejection signal
      edgeFunctions.generateTenderSections({
        document_id: doc.id,
        generation_type: doc.generation_type || generationType,
        trigger_training: true,
        outcome: 'rejected',
        outcome_notes: rejectReason.trim(),
        rejection_reason: rejectReason.trim(),
        rejection_category: rejectCategory,
        reference_ids: includedRefIds,
      }).catch(() => { /* non-fatal */ })

      queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
      queryClient.invalidateQueries({ queryKey: ['tender-comments', id] })
      setShowRejectDialog(false)
      setRejectReason('')
      setRejectCategory('other')
      toast.success('Returned to drafting — Bob is learning from this rejection')
    } catch (err: any) {
      toast.error(err?.message || 'Rejection failed')
    } finally {
      setRejecting(false)
    }
  }, [doc, canApprove, rejectReason, rejectCategory, user, generationType, id, queryClient, includedRefIds])

  // ── Mark as shortlisted ─────────────────────────────────────────────────────
  const markShortlisted = useCallback(async () => {
    if (!doc || !canApprove) return
    setShortlisting(true)
    try {
      const { error } = await (supabase as any)
        .from('tender_documents')
        .update({ status: 'shortlisted' })
        .eq('id', doc.id)
      if (error) throw error

      if (shortlistFeedback.trim()) {
        await (supabase as any).from('tender_comments').insert({
          document_id: doc.id,
          user_id: user!.id,
          content: `[SHORTLISTED] ${shortlistFeedback.trim()}`,
          is_approval_note: true,
        })
        // Train Bob on shortlist
        edgeFunctions.generateTenderSections({
          document_id: doc.id,
          generation_type: doc.generation_type || generationType,
          trigger_training: true,
          outcome: 'shortlisted',
          outcome_notes: shortlistFeedback.trim(),
          reference_ids: includedRefIds,
        }).catch(() => { /* non-fatal */ })
      }

      queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
      queryClient.invalidateQueries({ queryKey: ['tender-comments', id] })
      setShowShortlistDialog(false)
      setShortlistFeedback('')
      toast.success('Marked as Shortlisted')
    } catch (err: any) {
      toast.error(err?.message || 'Shortlist update failed')
    } finally {
      setShortlisting(false)
    }
  }, [doc, canApprove, shortlistFeedback, user, generationType, id, queryClient, includedRefIds])

  // ── Invite collaborator ─────────────────────────────────────────────────────
  const inviteCollaborator = useCallback(async () => {
    if (!doc || !isOwner) return
    if (!inviteEmail.trim()) { toast.error('Enter a user email'); return }
    setInviting(true)
    try {
      const { data: profile, error: profileErr } = await (supabase as any)
        .from('user_profiles')
        .select('id, first_name, last_name')
        .ilike('email', inviteEmail.trim())
        .maybeSingle()
      if (profileErr) throw profileErr
      if (!profile) throw new Error(`No user found with email: ${inviteEmail}`)

      const { error } = await ((supabase as any).from('tender_collaborators') as any)
        .insert({
          document_id: doc.id,
          user_id: profile.id,
          role: inviteRole,
          invited_by: user!.id,
        })
      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['tender-collaborators', id] })
      setInviteEmail('')
      toast.success(`${userName(profile)} invited as ${inviteRole}`)
    } catch (err: any) {
      toast.error(err?.message || 'Invite failed')
    } finally {
      setInviting(false)
    }
  }, [doc, isOwner, inviteEmail, inviteRole, user, id, queryClient])

  // ── Remove collaborator ─────────────────────────────────────────────────────
  const removeCollaborator = useCallback(async (collabId: string) => {
    await ((supabase as any).from('tender_collaborators') as any)
      .delete()
      .eq('id', collabId)
    queryClient.invalidateQueries({ queryKey: ['tender-collaborators', id] })
    toast.success('Collaborator removed')
  }, [id, queryClient])

  // ── Transfer ownership ──────────────────────────────────────────────────────
  const transferOwnership = useCallback(async (newOwnerId: string) => {
    if (!doc || !isOwner) return
    const { error } = await ((supabase as any).from('tender_documents') as any)
      .update({ owner_id: newOwnerId })
      .eq('id', doc.id)
    if (error) { toast.error(error.message); return }
    queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
    toast.success('Ownership transferred')
  }, [doc, isOwner, id, queryClient])

  // ── Add comment ─────────────────────────────────────────────────────────────
  const addComment = useCallback(async () => {
    if (!commentText.trim() || !user || !doc) return
    setSubmittingComment(true)
    try {
      const { error } = await ((supabase as any).from('tender_comments') as any).insert({
        document_id: doc.id,
        user_id: user.id,
        content: commentText.trim(),
        is_approval_note: false,
      })
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['tender-comments', id] })
      setCommentText('')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add comment')
    } finally {
      setSubmittingComment(false)
    }
  }, [commentText, user, doc, id, queryClient])

  // ── Export ───────────────────────────────────────────────────────────────────
  const handleExport = useCallback((format: 'pdf' | 'docx') => {
    if (!doc) return
    const html = generateTenderHtml(
      {
        title: doc.title,
        issuing_body: doc.issuing_body ?? undefined,
        reference_number: doc.reference_number ?? undefined,
        due_date: doc.due_date ?? undefined,
        organization_name: orgData?.name ?? 'FieldOps Manager',
        owner_name: userName(ownerProfile),
        export_date: new Date().toLocaleDateString('en-NZ'),
      },
      sections,
    )

    // Save generated HTML (best-effort; non-blocking)
    ;((supabase as any).from('tender_documents') as any)
      .update({ generated_html: html })
      .eq('id', doc.id)
      .then(({ error }: { error: any }) => {
        if (error) console.error('Failed to save tender HTML:', error.message)
        else queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
      })

    if (format === 'pdf') {
      exportTenderPdf(html)
    } else {
      const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
      downloadTenderDoc(html, `${slug}-response.doc`)
    }
  }, [doc, sections, ownerProfile, orgData, id, queryClient])

  if (isLoading) {
    return (
      <AppLayout title="Tender Workspace" showBackButton>
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading document…
        </div>
      </AppLayout>
    )
  }

  if (isError) {
    return (
      <AppLayout title="Tender Workspace" showBackButton>
        <div className="flex flex-col items-center justify-center py-20 text-sm text-muted-foreground gap-3">
          <p>Could not load this tender document.</p>
          <p className="text-xs text-red-500">{(error as any)?.message || 'Unknown error'}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Retrying…</> : <><Loader2 className="h-4 w-4 mr-2" />Retry load</>}
          </Button>
        </div>
      </AppLayout>
    )
  }

  if (!doc) {
    return (
      <AppLayout title="Not Found" showBackButton>
        <div className="text-center py-20 text-muted-foreground text-sm">Document not found.</div>
      </AppLayout>
    )
  }

  const st = STATUS_CONFIG[doc.status] ?? { label: doc.status, color: 'bg-gray-100 text-gray-600 border-gray-300' }
  const requirementCoverage = evaluateRequirementCoverage(doc.key_requirements, sections)

  const SECTION_LABELS: Array<{ key: string; label: string; hint?: string }> = [
    { key: 'cover_letter', label: 'Cover Letter', hint: 'Introduce your organisation and summarise your interest.' },
    { key: 'executive_summary', label: 'Executive Summary', hint: 'High-level summary of your offer.' },
    { key: 'services_offered', label: 'Services Offered', hint: 'Detail each service you are proposing, matching the tender requirements.' },
    { key: 'pricing_notes', label: 'Pricing', hint: 'Outline pricing structure, rates, and any volume discounts.' },
    { key: 'team_qualifications', label: 'Team & Qualifications', hint: 'Credentials, licences, experience, and subcontractors.' },
    { key: 'health_and_safety', label: 'Health & Safety', hint: 'H&S policy reference, accreditations, and safety plans.' },
    { key: 'declaration', label: 'Declaration', hint: 'Collusion, anti-competitive conduct, and certification declarations.' },
  ]

  return (
    <AppLayout
      title={doc.title}
      description={[doc.issuing_body, doc.reference_number].filter(Boolean).join(' · ')}
      showBackButton
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${st.color}`}>
          {st.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {doc.document_type.toUpperCase()} ·{' '}
          Owner: <strong>{userName(ownerProfile)}</strong>
        </span>
        {doc.due_date && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Due {new Date(doc.due_date).toLocaleDateString('en-NZ')}
          </span>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="intake">
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Intake
          </TabsTrigger>
          <TabsTrigger value="references">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            References
            {orgRefs.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary/20 text-[9px] font-medium">{includedRefIds.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="assessment">
            <BrainCircuit className="h-3.5 w-3.5 mr-1.5" />
            Bob Assessment
          </TabsTrigger>
          <TabsTrigger value="draft">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Draft Response
          </TabsTrigger>
          <TabsTrigger value="collaborators">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Collaborators
          </TabsTrigger>
          <TabsTrigger value="approval">
            <Shield className="h-3.5 w-3.5 mr-1.5" />
            Approval
          </TabsTrigger>
          <TabsTrigger value="export">
            <FileDown className="h-3.5 w-3.5 mr-1.5" />
            Export
          </TabsTrigger>
        </TabsList>

        {/* ── INTAKE TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="intake">
          <div className="space-y-4">
            {/* File upload */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  Document File
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {doc.file_name ? (
                  <div className="flex items-center justify-between rounded border bg-muted/20 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">{doc.file_name}</span>
                      <Badge variant="outline" className="text-[10px]">{doc.file_kind}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.file_public_url && (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={doc.file_public_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}

                {canEdit && (
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
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
                        if (f) handleFileIntake(f)
                      }}
                    />
                    {extracting ? (
                      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading & extracting text…
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="h-6 w-6 mx-auto text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">
                          {doc.file_name ? 'Replace file — ' : ''}drag & drop or click to upload
                        </p>
                        <p className="text-xs text-muted-foreground/60">
                          PDF, Word, Excel, CSV, images (with OCR)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Extracted text preview + edit */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  Extracted / Pasted Content
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {canEdit && (
                  <Textarea
                    placeholder="Paste document text here, or upload a file above. Bob uses this text for analysis."
                    className="min-h-[180px] font-mono text-xs"
                    value={doc.extracted_text ?? ''}
                    onChange={async (e) => {
                      await ((supabase as any).from('tender_documents') as any)
                        .update({ extracted_text: e.target.value, status: e.target.value.trim() ? 'staged' : doc.status })
                        .eq('id', doc.id)
                      queryClient.invalidateQueries({ queryKey: ['tender-document', id] })
                    }}
                  />
                )}
                {!canEdit && doc.extracted_text && (
                  <pre className="whitespace-pre-wrap text-xs bg-muted/20 p-3 rounded border max-h-48 overflow-auto">
                    {doc.extracted_text.slice(0, 2000)}
                    {doc.extracted_text.length > 2000 ? '\n…(truncated)' : ''}
                  </pre>
                )}

                {canEdit && (
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      onClick={runAnalysis}
                      disabled={analysing || !doc.extracted_text?.trim()}
                    >
                      {analysing ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" />Bob is analysing… ({analysingElapsed}s)</>
                      ) : (
                        <><BrainCircuit className="h-4 w-4 mr-2" />Run Bob Analysis</>
                      )}
                    </Button>
                    {analysing && (
                      <div className="space-y-1">
                        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                          <div
                            className="h-2 rounded-full bg-primary transition-all duration-1000"
                            style={{ width: `${Math.min(95, (analysingElapsed / 110) * 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground text-center">
                          {analysingElapsed < 15 ? 'Sending to Bob…' :
                           analysingElapsed < 40 ? 'Bob is reading the document…' :
                           analysingElapsed < 80 ? 'Bob is extracting key information…' :
                           'Almost done, finalising assessment…'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── REFERENCES TAB ─────────────────────────────────────────────── */}
        <TabsContent value="references">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Reference materials available for this tender
                  <Button
                    size="sm"
                    variant="link"
                    className="ml-auto text-xs h-auto py-0"
                    onClick={() => navigate('/tender-reference-library')}
                  >
                    Manage library →
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lastAnalysisRefCount && (
                  <div className="mb-3 rounded border bg-green-50 dark:bg-green-950 px-3 py-2 text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Used {lastAnalysisRefCount.used} of {lastAnalysisRefCount.total} references in last analysis
                    {lastAnalysisRefCount.at && <span className="text-green-600/70 ml-1">· {formatDateTime(lastAnalysisRefCount.at)}</span>}
                  </div>
                )}

                {orgRefs.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground space-y-2">
                    <BookOpen className="h-8 w-8 mx-auto text-muted-foreground/30" />
                    <p>No reference materials in your org's library yet.</p>
                    {isAdminOrAbove && (
                      <Button size="sm" variant="outline" onClick={() => navigate('/tender-reference-library')}>
                        Go to Reference Library
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y">
                    {orgRefs.map((ref) => {
                      const isExtracted = ref.extraction_status === 'extracted'
                      const isIncluded = refInclusions[ref.id] !== false
                      return (
                        <div key={ref.id} className="flex items-start gap-3 py-3">
                          <Checkbox
                            id={`ref-${ref.id}`}
                            checked={isIncluded && isExtracted}
                            disabled={!isExtracted || !canEdit}
                            onCheckedChange={(v) => toggleRefInclusion(ref.id, !!v)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <label htmlFor={`ref-${ref.id}`} className={`text-sm font-medium cursor-pointer ${!isExtracted ? 'text-muted-foreground' : ''}`}>
                              {ref.title}
                            </label>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5 capitalize">{ref.material_type.replace('_', ' ')}</span>
                              <span className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">v{ref.version}</span>
                              <span className={`text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border font-medium ${
                                ref.extraction_status === 'extracted' ? 'bg-green-50 text-green-700 border-green-200' :
                                ref.extraction_status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                                ref.extraction_status === 'needs_review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-gray-50 text-gray-600 border-gray-200'
                              }`}>
                                {ref.extraction_status === 'extracting' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                {ref.extraction_status}
                              </span>
                            </div>
                            {!isExtracted && (
                              <p className="text-[10px] text-amber-600 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                {ref.extraction_status === 'failed' ? 'Extraction failed — go to Reference Library to re-try' :
                                 ref.extraction_status === 'needs_review' ? 'Needs review — excluded until text is confirmed' :
                                 'Text not yet extracted — excluded from Bob context'}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {orgRefs.length > 0 && canEdit && (
                  <div className="mt-4 pt-3 border-t space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Ticked references will be included as context when you run Bob Analysis or Generate Draft.
                      {savingRefInclusion && <span className="ml-1 text-primary">Saving…</span>}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        onClick={runAnalysis}
                        disabled={analysing || !doc.extracted_text?.trim()}
                      >
                        {analysing ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Analysing…</>
                        ) : (
                          <><BrainCircuit className="h-3.5 w-3.5 mr-1.5" />Run Bob Analysis ({includedRefIds.length} refs)</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={generateWithBob}
                        disabled={generating || !doc.bob_assessment}
                      >
                        {generating ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Generating…</>
                        ) : (
                          <><Pencil className="h-3.5 w-3.5 mr-1.5" />Generate Draft ({includedRefIds.length} refs)</>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── ASSESSMENT TAB ─────────────────────────────────────────────── */}
        <TabsContent value="assessment">
          {!doc.bob_assessment ? (
            <Card>
              <CardContent className="py-10 text-center space-y-3">
                <BrainCircuit className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No analysis yet. Go to the Intake tab, upload or paste the document, then click <strong>Run Bob Analysis</strong>.
                </p>
                <Button variant="outline" onClick={() => setActiveTab('intake')}>
                  Go to Intake
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-primary" />
                    Bob's Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{doc.bob_assessment_summary}</p>
                </CardContent>
              </Card>

              <div className="grid gap-4 sm:grid-cols-2">
                {doc.key_services?.length ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                        Services Required
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {doc.key_services.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}

                {doc.key_requirements?.length ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                        Key Requirements
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {doc.key_requirements.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}

                {doc.key_dates?.length ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                        Key Dates
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {doc.key_dates.map((d, i) => (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            <Calendar className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                            <strong>{d.label}:</strong>&nbsp;{d.date}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}

                {doc.bob_assessment?.issuing_body && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                        Issuing Body
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary shrink-0" />
                      {doc.bob_assessment.issuing_body}
                      {doc.crm_client_organization_id && (
                        <Badge variant="outline" className="ml-auto text-[10px]">CRM linked</Badge>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {doc.enrichment_data && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                      Web Enrichment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(doc.enrichment_data, null, 2)}</pre>
                  </CardContent>
                </Card>
              )}

              {canEdit && (
                <Button variant="outline" onClick={runAnalysis} disabled={analysing}>
                  {analysing ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Re-analysing…</>
                  ) : (
                    <><BrainCircuit className="h-4 w-4 mr-2" />Re-run Analysis</>
                  )}
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── DRAFT RESPONSE TAB ─────────────────────────────────────────── */}
        <TabsContent value="draft">
          <div className="space-y-4">
            {/* ── Generate with Bob panel ───────────────────────────────── */}
            {canEdit && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-primary" />
                    Generate with Bob
                    <span className="text-[10px] font-normal text-muted-foreground ml-1">
                      100% self-hosted · Ollama on Railway · no cloud AI
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Generation type selector */}
                    <Select
                      value={generationType}
                      onValueChange={(v) => setGenerationType(v as 'application' | 'response')}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="response">Tender Response</SelectItem>
                        <SelectItem value="application">Tender Application</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      onClick={generateWithBob}
                      disabled={generating || !doc.extracted_text?.trim() && !doc.bob_assessment}
                      className="min-w-[160px]"
                    >
                      {generating
                        ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Bob is writing…</>
                        : <><BrainCircuit className="h-4 w-4 mr-2" />Generate Draft</>}
                    </Button>

                    {!doc.extracted_text?.trim() && !doc.bob_assessment && (
                      <p className="text-xs text-amber-600">
                        Run Bob Analysis first (Assessment tab) so Bob understands the tender.
                      </p>
                    )}
                  </div>

                  {/* Show which model generated the last draft */}
                  {lastGenerationMeta && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      Last generated by Bob using{' '}
                      <span className="font-medium text-foreground">
                        {lastGenerationMeta.provider === 'heuristic'
                          ? 'built-in template'
                          : lastGenerationMeta.provider === 'secondary-assistant'
                          ? `secondary assistant (${lastGenerationMeta.model_used})`
                          : `${lastGenerationMeta.provider} · ${lastGenerationMeta.model_used}`}
                      </span>
                    </div>
                  )}
                  {!(lastGenerationMeta) && doc?.generation_provider && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      Sections loaded from last Bob generation ·{' '}
                      <span className="font-medium text-foreground">
                        {doc?.generation_provider === 'heuristic'
                          ? 'built-in template'
                          : `${doc?.generation_provider} · ${doc.generation_model}`}
                      </span>
                      {doc?.last_generated_at && (
                        <span className="ml-1">· {formatDateTime(doc?.last_generated_at)}</span>
                      )}
                    </div>
                  )}

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Bob drafts all sections based on the tender document. Review and edit every section before submitting — human review is required.
                    When you approve this document, Bob automatically learns from the approved content to improve future drafts.
                  </p>
                </CardContent>
              </Card>
            )}

            {SECTION_LABELS.map(({ key, label, hint }) => (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{label}</CardTitle>
                  {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
                </CardHeader>
                <CardContent>
                  <Textarea
                    className="min-h-[100px] text-sm"
                    placeholder={hint}
                    value={sections[key] ?? ''}
                    readOnly={!canEdit}
                    onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.value }))}
                  />
                </CardContent>
              </Card>
            ))}

            {canEdit && (
              <div className="flex gap-2 flex-wrap">
                <Button onClick={saveSections} disabled={savingSections}>
                  {savingSections ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Draft
                </Button>
                <Button
                  variant="outline"
                  onClick={submitForApproval}
                  disabled={doc.status === 'review_pending' || doc.status === 'approved'}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Submit for Approval
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── COLLABORATORS TAB ──────────────────────────────────────────── */}
        <TabsContent value="collaborators">
          <div className="space-y-4">
            {isOwner && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-primary" />
                    Invite Collaborator
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    <Input
                      placeholder="User email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1 min-w-[200px]"
                    />
                    <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as CollaboratorRole)}>
                      <SelectTrigger className="w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="approver">Approver</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={inviteCollaborator} disabled={inviting}>
                      {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                      Invite
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Team
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* Owner row */}
                <div className="flex items-center justify-between rounded border bg-muted/10 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <User2 className="h-4 w-4 text-primary" />
                    <span className="font-medium">{userName(ownerProfile)}</span>
                    <Badge variant="secondary" className="text-[10px]">Owner</Badge>
                  </div>
                </div>

                {collaborators.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No collaborators yet.</p>
                )}

                {collaborators.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <User2 className="h-4 w-4 text-muted-foreground" />
                      <span>{userName(c.user)}</span>
                      {c.user?.email && <span className="text-muted-foreground text-xs">{c.user.email}</span>}
                      <Badge variant="outline" className="text-[10px]">{c.role}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {isOwner && c.role !== 'approver' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          onClick={() => transferOwnership(c.user_id)}
                        >
                          Make Owner
                        </Button>
                      )}
                      {isOwner && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeCollaborator(c.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Comments thread */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Comments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {comments.filter((c) => !c.is_approval_note).map((c) => (
                    <div key={c.id} className="rounded border bg-muted/10 p-2.5 text-xs">
                      <div className="font-medium text-foreground mb-1">
                        {userName(c.user)} · {formatDateTime(c.created_at)}
                      </div>
                      <p className="whitespace-pre-wrap">{c.content}</p>
                    </div>
                  ))}
                  {comments.filter((c) => !c.is_approval_note).length === 0 && (
                    <p className="text-xs text-muted-foreground">No comments yet.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Textarea
                    className="flex-1 min-h-[60px] text-sm"
                    placeholder="Add a comment…"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                  />
                  <Button
                    size="sm"
                    onClick={addComment}
                    disabled={!commentText.trim() || submittingComment}
                  >
                    {submittingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── APPROVAL TAB ───────────────────────────────────────────────── */}
        <TabsContent value="approval">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  Requirement Coverage Report
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!doc.key_requirements?.length ? (
                  <p className="text-sm text-muted-foreground">No extracted requirements are available yet. Re-run Bob Analysis to build a requirement map before approval.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">Total: {requirementCoverage.rows.length}</Badge>
                      <Badge variant="outline" className="border-green-300 text-green-700">Covered: {requirementCoverage.rows.filter((r) => r.covered).length}</Badge>
                      <Badge variant="outline" className="border-amber-300 text-amber-700">Uncovered: {requirementCoverage.uncovered.length}</Badge>
                      <Badge variant="outline" className="border-red-300 text-red-700">Mandatory missing: {requirementCoverage.missingMandatory.length}</Badge>
                    </div>

                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {requirementCoverage.rows.map((row, idx) => (
                        <div key={`${row.requirement}-${idx}`} className="rounded border px-2.5 py-2 text-xs">
                          <div className="flex items-start gap-2">
                            {row.covered ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="whitespace-pre-wrap">{row.requirement}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                {row.mandatory && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700">Mandatory</Badge>}
                                {typeof row.weightPercent === 'number' && <Badge variant="outline" className="text-[10px]">Weight {row.weightPercent}%</Badge>}
                                <span className="text-[10px] text-muted-foreground">Coverage tokens: {row.matchedTokens}/{row.totalTokens}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {requirementCoverage.missingMandatory.length > 0 && (
                      <p className="text-xs text-red-600">
                        Submission is blocked while mandatory requirements remain uncovered in the draft.
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Approval Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span>Current status:</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${st.color}`}>
                    {st.label}
                  </span>
                </div>

                {doc.approved_at && (
                  <div className="rounded border bg-green-50 dark:bg-green-950 p-3 text-sm space-y-1">
                    <div className="font-semibold text-green-700 dark:text-green-300 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />
                      Approved
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(doc.approved_at)}
                    </div>
                    {doc.approval_notes && (
                      <p className="text-xs mt-1 whitespace-pre-wrap">{doc.approval_notes}</p>
                    )}
                  </div>
                )}

                {doc.status === 'review_pending' && canApprove && (
                  <div className="space-y-2">
                    <Label>Approval note (required)</Label>
                    <Textarea
                      placeholder="Add your approval notes — what worked well? (Bob will learn from this)"
                      value={approvalNote}
                      onChange={(e) => setApprovalNote(e.target.value)}
                      className="min-h-[80px] text-sm"
                    />
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        className="flex-1"
                        onClick={approveDocument}
                        disabled={!approvalNote.trim() || approvingDoc}
                      >
                        {approvingDoc ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                        Approve Document
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowShortlistDialog(true)}
                      >
                        <Star className="h-4 w-4 mr-2" />
                        Mark Shortlisted
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setShowRejectDialog(true)}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Return to Draft
                      </Button>
                    </div>
                  </div>
                )}

                {doc.status === 'shortlisted' && canApprove && (
                  <div className="rounded border bg-sky-50 dark:bg-sky-950 p-3 text-sm space-y-2">
                    <p className="font-medium text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                      <Star className="h-4 w-4" />
                      Shortlisted — finalise for approval or return to drafting
                    </p>
                    <div className="space-y-2">
                      <Label>Final approval note</Label>
                      <Textarea
                        placeholder="Final notes before approval…"
                        value={approvalNote}
                        onChange={(e) => setApprovalNote(e.target.value)}
                        className="min-h-[60px] text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          className="flex-1"
                          onClick={approveDocument}
                          disabled={!approvalNote.trim() || approvingDoc}
                        >
                          {approvingDoc ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                          Approve Document
                        </Button>
                        <Button variant="destructive" onClick={() => setShowRejectDialog(true)}>
                          <XCircle className="h-4 w-4 mr-2" />
                          Return to Draft
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {doc.status === 'approved' && canEdit && (
                  <Button
                    onClick={() => updateStatus.mutateAsync('submitted')}
                    className="w-full"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Mark as Submitted
                  </Button>
                )}

                {/* Approval notes history */}
                {comments.filter((c) => c.is_approval_note).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Approval History</p>
                    {comments.filter((c) => c.is_approval_note).map((c) => (
                      <div key={c.id} className="rounded border bg-muted/10 p-2.5 text-xs">
                        <div className="font-medium mb-1">{userName(c.user)} · {formatDateTime(c.created_at)}</div>
                        <p className="whitespace-pre-wrap">{c.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── EXPORT TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="export">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileDown className="h-4 w-4 text-primary" />
                Export Tender Response
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {doc.status !== 'approved' && (
                <div className="flex items-start gap-2 rounded border bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>This document has not yet been approved. Export is available but approval is required before submission.</p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Card className="border-dashed">
                  <CardContent className="pt-5 pb-4 space-y-2 text-center">
                    <Printer className="h-8 w-8 mx-auto text-muted-foreground/60" />
                    <p className="text-sm font-medium">PDF (Print)</p>
                    <p className="text-xs text-muted-foreground">Opens a print-ready preview in a new tab</p>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => handleExport('pdf')}
                    >
                      <Printer className="h-4 w-4 mr-2" />
                      Export as PDF
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-dashed">
                  <CardContent className="pt-5 pb-4 space-y-2 text-center">
                    <Download className="h-8 w-8 mx-auto text-muted-foreground/60" />
                    <p className="text-sm font-medium">Word Document</p>
                    <p className="text-xs text-muted-foreground">Downloads as .doc — opens in Word or LibreOffice</p>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => handleExport('docx')}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download as Word (.doc)
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {doc.generated_html && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Last generated preview:</p>
                  <div className="border rounded overflow-hidden">
                    <iframe
                      className="w-full"
                      style={{ height: '400px' }}
                      srcDoc={doc.generated_html}
                      title="Document preview"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Rejection dialog ─────────────────────────────────────────────── */}
      <Dialog open={showRejectDialog} onOpenChange={(o) => { if (!rejecting) setShowRejectDialog(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              Return to Draft — Rejection Feedback
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This feedback trains Bob so future tenders avoid the same issues.
            </p>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={rejectCategory} onValueChange={(v) => setRejectCategory(v as typeof rejectCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pricing">Pricing</SelectItem>
                  <SelectItem value="scope">Scope / services</SelectItem>
                  <SelectItem value="qualifications">Qualifications / CoA</SelectItem>
                  <SelectItem value="compliance">Compliance / H&S</SelectItem>
                  <SelectItem value="formatting">Formatting / structure</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rejection reason <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="e.g. Pricing exceeded council budget by 20%, Missing H&S accreditation, Scope didn't address night patrols…"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="min-h-[100px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)} disabled={rejecting}>Cancel</Button>
            <Button variant="destructive" onClick={rejectDocument} disabled={rejecting || !rejectReason.trim()}>
              {rejecting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Rejecting…</> : 'Return to Draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Shortlist dialog ─────────────────────────────────────────────── */}
      <Dialog open={showShortlistDialog} onOpenChange={(o) => { if (!shortlisting) setShowShortlistDialog(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-4 w-4 text-sky-600" />
              Mark as Shortlisted
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              The tender has been shortlisted. Capture what to improve for the final submission stage.
            </p>
            <div className="space-y-1.5">
              <Label>Shortlist stage feedback (optional)</Label>
              <Textarea
                placeholder="e.g. Strong methodology, but pricing needs to be sharper for final submission. Add more detail on lone-worker welfare monitoring."
                value={shortlistFeedback}
                onChange={(e) => setShortlistFeedback(e.target.value)}
                className="min-h-[100px] text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShortlistDialog(false)} disabled={shortlisting}>Cancel</Button>
            <Button onClick={markShortlisted} disabled={shortlisting}>
              {shortlisting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : <><Star className="h-4 w-4 mr-2" />Mark Shortlisted</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
