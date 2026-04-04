import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  BrainCircuit,
  Building2,
  CheckCircle,
  Clock,
  Database,
  FileSpreadsheet,
  FileText,
  IdCard,
  Image,
  List,
  Route,
  ShieldCheck,
  Upload,
  AlertTriangle,
  CarFront,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { extractDocumentData } from '@/lib/documentExtraction'

const ASSISTANT_NAME = 'Bob'
const ASSISTANT_TITLE = 'Built-in Operations Brain'

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

interface OrganizationOption {
  id: string
  name: string
}

type ImportPurpose =
  | 'historical_records'
  | 'vehicle_of_interest_photo'
  | 'person_of_interest_photo'
  | 'identity_reference'
  | 'general_observation'
  | 'general_document'

type FileKind = 'spreadsheet' | 'image' | 'document' | 'text' | 'unknown'

interface ColumnRecommendation {
  target: string
  required?: boolean
  matchedSignals: string[]
}

interface TableRecommendation {
  table: string
  label: string
  score: number
  rationale: string
  route: { path: string; label: string }
  columns: ColumnRecommendation[]
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  processing: { label: 'Processing', variant: 'default' },
  enriching: { label: 'Enriching', variant: 'default' },
  completed: { label: 'Completed', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
}

const PURPOSE_OPTIONS: Array<{ value: ImportPurpose; label: string; description: string }> = [
  {
    value: 'historical_records',
    label: 'Historical vehicle or observation records',
    description: 'Spreadsheet import for historical records such as Downer or LINZ extracts.',
  },
  {
    value: 'vehicle_of_interest_photo',
    label: 'Vehicle of interest photo',
    description: 'Photo or document linked to a vehicle of interest or related intel.',
  },
  {
    value: 'person_of_interest_photo',
    label: 'Person of interest photo',
    description: 'Photo or document linked to a person of interest.',
  },
  {
    value: 'identity_reference',
    label: 'Identity card or credential sample',
    description: 'Reference identity documents for verification or data extraction setup.',
  },
  {
    value: 'general_observation',
    label: 'Observation evidence or field photo',
    description: 'General image or text import for observations, evidence, or notes.',
  },
  {
    value: 'general_document',
    label: 'General document for Bob review',
    description: 'PDF, Word, spreadsheet, or mixed evidence requiring guided review.',
  },
]

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

function classifyFile(file: File | null): FileKind {
  if (!file) return 'unknown'
  const extension = getFileExtension(file.name)
  if (['csv', 'xls', 'xlsx'].includes(extension)) return 'spreadsheet'
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(extension)) return 'image'
  if (['txt', 'json'].includes(extension) || file.type.startsWith('text/')) return 'text'
  if (['pdf', 'doc', 'docx'].includes(extension)) return 'document'
  return 'unknown'
}

function buildHistoricalImportStoragePath(organizationId: string | null | undefined, fileName: string): string {
  const safeOrg = (organizationId || 'unknown-org').replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `historical-imports/${safeOrg}/${Date.now()}-${safeName}`
}

function buildAiIntakeStoragePath(organizationId: string | null | undefined, purpose: ImportPurpose, fileName: string): string {
  const safeOrg = (organizationId || 'unassigned-org').replace(/[^a-zA-Z0-9_-]/g, '_')
  const safePurpose = purpose.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `bob-intake/${safeOrg}/${safePurpose}/${Date.now()}-${safeName}`
}

function getPurposeQuestions(purpose: ImportPurpose, fileKind: FileKind): string[] {
  switch (purpose) {
    case 'historical_records':
      return [
        'Which organisation owns these historical records?',
        'What source system produced the file, for example Downer or LINZ?',
        'What date range does the file cover?',
        'Do the columns contain zone names, plate numbers, timestamps, GPS, or officer names?',
      ]
    case 'vehicle_of_interest_photo':
      return [
        'What plate number or identifier should this vehicle be linked to?',
        'Why is the vehicle of interest?',
        'Is this image evidence, a watchlist reference, or an intel attachment?',
      ]
    case 'person_of_interest_photo':
      return [
        'Who is the person shown or referenced?',
        'What name, alias, or case reference should this be attached to?',
        'Is this a watchlist photo, incident evidence, or a public-source reference?',
      ]
    case 'identity_reference':
      return [
        'What document type is this, for example driver licence, access card, or ID badge?',
        'Which fields should be extracted or validated?',
        'Which organisation is requesting this template or import setup?',
      ]
    case 'general_observation':
      return [
        'Is this an observation photo, field note, breach evidence, or supporting context?',
        'What date or location should be used if it is not obvious in the file?',
        `Can Bob safely extract structured data from this ${fileKind}?`,
      ]
    case 'general_document':
      return [
        'What is this document for?',
        'Which organisation should own the import result?',
        'Should the file be analysed for structured fields, retained as reference, or routed for review?',
      ]
    default:
      return []
  }
}

function getRecommendedRoute(purpose: ImportPurpose): { path: string; label: string } {
  switch (purpose) {
    case 'historical_records':
      return { path: '/import-historical', label: 'Open Historical Import' }
    case 'vehicle_of_interest_photo':
    case 'person_of_interest_photo':
      return { path: '/points-of-interest', label: 'Open Points of Interest' }
    case 'identity_reference':
      return { path: '/identity-verification', label: 'Open Identity Verification' }
    default:
      return { path: '/ai-analysis', label: 'Open Bob Analysis' }
  }
}

function uniqueTokens(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || '').toLowerCase().split(/[^a-z0-9_]+/))
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  )
}

function extractHeaderHints(file: File | null, fileContent: string | null): string[] {
  if (!file || !fileContent) return []
  const extension = getFileExtension(file.name)

  if (extension === 'json') {
    try {
      const parsed = JSON.parse(fileContent)
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
        return Object.keys(parsed[0])
      }
      if (parsed && typeof parsed === 'object') {
        return Object.keys(parsed)
      }
    } catch {
      return []
    }
  }

  const firstLine = fileContent.split(/\r?\n/).find((line) => line.trim())
  if (!firstLine) return []
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes('|') ? '|' : ','
  return firstLine
    .split(delimiter)
    .map((part) => part.replace(/^"|"$/g, '').trim())
    .filter(Boolean)
}

function matchColumns(
  aliases: Record<string, { aliases: string[]; required?: boolean }>,
  tokens: string[],
  headerHints: string[],
): ColumnRecommendation[] {
  const headerPool = headerHints.map((value) => value.toLowerCase())
  return Object.entries(aliases)
    .map(([target, config]) => {
      const matchedSignals = config.aliases.filter((alias) => {
        const normalized = alias.toLowerCase()
        return tokens.includes(normalized) || headerPool.some((header) => header.includes(normalized) || normalized.includes(header))
      })
      return {
        target,
        required: config.required,
        matchedSignals,
      }
    })
    .filter((entry) => entry.matchedSignals.length > 0)
}

function scoreRecommendation(base: number, bonusSignals: string[], tokens: string[]): number {
  return base + bonusSignals.filter((signal) => tokens.includes(signal)).length * 8
}

function buildTableRecommendations(params: {
  purpose: ImportPurpose
  fileKind: FileKind
  file: File | null
  fileContent: string | null
  extractedHeaders: string[]
  sourceSystem: string
  notes: string
  expectedFields: string
  documentType: string
  plateNumber: string
  personName: string
}): TableRecommendation[] {
  const headerHints = params.extractedHeaders.length > 0 ? params.extractedHeaders : extractHeaderHints(params.file, params.fileContent)
  const tokens = uniqueTokens([
    params.file?.name,
    params.sourceSystem,
    params.notes,
    params.expectedFields,
    params.documentType,
    params.plateNumber,
    params.personName,
    params.purpose,
    ...headerHints,
  ])

  const recommendations: TableRecommendation[] = []

  const observationColumns = matchColumns(
    {
      plate_number: { aliases: ['plate', 'registration', 'rego', 'plate_number'], required: true },
      recorded_at: { aliases: ['recorded_at', 'observed_at', 'timestamp', 'date', 'time'], required: true },
      zone_name: { aliases: ['zone', 'zone_name', 'site', 'location'] },
      gps_latitude: { aliases: ['latitude', 'lat', 'gps_latitude'] },
      gps_longitude: { aliases: ['longitude', 'lng', 'gps_longitude'] },
      vehicle_make: { aliases: ['make', 'vehicle_make'] },
      vehicle_model: { aliases: ['model', 'vehicle_model'] },
      vehicle_color: { aliases: ['color', 'colour', 'vehicle_color'] },
      officer_notes: { aliases: ['notes', 'comment', 'officer_notes'] },
      organization_id: { aliases: ['organization', 'organisation', 'org_id'] },
    },
    tokens,
    headerHints,
  )

  recommendations.push({
    table: 'observations',
    label: 'Observations',
    score: scoreRecommendation(params.purpose === 'historical_records' ? 70 : params.purpose === 'general_observation' ? 58 : 20, ['plate', 'zone', 'gps', 'location', 'observation', 'breach', 'compliance'], tokens),
    rationale: 'Best fit for historical vehicle checks, observation backfills, and field evidence tied to a location or plate.',
    route: { path: '/import-historical', label: 'Open Historical Import' },
    columns: observationColumns,
  })

  const voiColumns = matchColumns(
    {
      plate_number: { aliases: ['plate', 'registration', 'rego', 'plate_number'], required: true },
      vehicle_make: { aliases: ['make', 'vehicle_make'] },
      vehicle_model: { aliases: ['model', 'vehicle_model'] },
      vehicle_color: { aliases: ['color', 'colour', 'vehicle_color'] },
      vehicle_year: { aliases: ['year', 'vehicle_year'] },
      reason: { aliases: ['reason', 'watchlist', 'risk'] },
      photos: { aliases: ['photo', 'image', 'photos'] },
      notes: { aliases: ['notes', 'comment', 'details'] },
      organization_id: { aliases: ['organization', 'organisation', 'org_id'] },
    },
    tokens,
    headerHints,
  )

  recommendations.push({
    table: 'vehicles_of_interest',
    label: 'Vehicles of Interest',
    score: scoreRecommendation(params.purpose === 'vehicle_of_interest_photo' ? 78 : 24, ['vehicle', 'plate', 'voi', 'watchlist', 'car'], tokens),
    rationale: 'Best fit for watchlist vehicles, reference images, and records keyed by plate number.',
    route: { path: '/points-of-interest', label: 'Open Points of Interest' },
    columns: voiColumns,
  })

  const poiColumns = matchColumns(
    {
      full_name: { aliases: ['name', 'full_name', 'person', 'subject'], required: true },
      date_of_birth: { aliases: ['dob', 'birth', 'date_of_birth'] },
      description: { aliases: ['description', 'summary'] },
      distinguishing_features: { aliases: ['feature', 'features', 'distinguishing'] },
      gender: { aliases: ['gender', 'sex'] },
      ethnicity: { aliases: ['ethnicity'] },
      reason: { aliases: ['reason', 'watchlist', 'risk'] },
      photos: { aliases: ['photo', 'image', 'photos'] },
      notes: { aliases: ['notes', 'comment', 'details'] },
      organization_id: { aliases: ['organization', 'organisation', 'org_id'] },
    },
    tokens,
    headerHints,
  )

  recommendations.push({
    table: 'persons_of_interest',
    label: 'Persons of Interest',
    score: scoreRecommendation(params.purpose === 'person_of_interest_photo' ? 78 : 22, ['person', 'poi', 'alias', 'name', 'dob', 'subject'], tokens),
    rationale: 'Best fit for named persons, aliases, reference photos, and supporting watchlist material.',
    route: { path: '/points-of-interest', label: 'Open Points of Interest' },
    columns: poiColumns,
  })

  const profileColumns = matchColumns(
    {
      first_name: { aliases: ['first_name', 'first', 'given_name'] },
      last_name: { aliases: ['last_name', 'last', 'surname', 'family_name'] },
      email: { aliases: ['email', 'mail'] },
      role: { aliases: ['role', 'position'] },
      organization_id: { aliases: ['organization', 'organisation', 'org_id'] },
      coa_number: { aliases: ['coa', 'coa_number', 'licence'] },
      warrant_number: { aliases: ['warrant', 'warrant_number'] },
    },
    tokens,
    headerHints,
  )

  recommendations.push({
    table: 'user_profiles',
    label: 'User Profiles / Identity Context',
    score: scoreRecommendation(params.purpose === 'identity_reference' ? 72 : 18, ['identity', 'id', 'badge', 'licence', 'credential', 'staff'], tokens),
    rationale: 'Best fit for operator identity samples, credential references, and staff profile-linked extraction fields.',
    route: { path: '/identity-verification', label: 'Open Identity Verification' },
    columns: profileColumns,
  })

  return recommendations.sort((a, b) => b.score - a.score)
}

export default function ImportData() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState('intake')
  const [file, setFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [analysisText, setAnalysisText] = useState<string | null>(null)
  const [extractedHeaders, setExtractedHeaders] = useState<string[]>([])
  const [batchName, setBatchName] = useState('')
  const [recordDate, setRecordDate] = useState('')
  const [notes, setNotes] = useState('')
  const [pastedTextInput, setPastedTextInput] = useState('')
  const [purpose, setPurpose] = useState<ImportPurpose>('historical_records')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [sourceSystem, setSourceSystem] = useState('')
  const [dateRange, setDateRange] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [personName, setPersonName] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [expectedFields, setExpectedFields] = useState('')
  const [uploading, setUploading] = useState(false)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [currentIntakeId, setCurrentIntakeId] = useState<string | null>(null)
  const [extractionStrategy, setExtractionStrategy] = useState<'full' | 'limited' | 'stage-only'>('full')
  const [extractionRationale, setExtractionRationale] = useState<string>('')
  const [result, setResult] = useState<any>(null)

  const accessibleOrgIds = useMemo(() => {
    if (!user) return [] as string[]
    return Array.from(
      new Set(
        [user.organization_id, ...(user.extra_organization_ids || []), ...(user.authorized_work_locations || [])].filter(Boolean) as string[],
      ),
    )
  }, [user])

  const isElevatedUser = user?.role === 'admin' || user?.role === 'master' || user?.role === 'grand_master'
  const historyOrgId = selectedOrgId || (user?.role === 'master' || user?.role === 'grand_master' ? undefined : user?.organization_id || undefined)

  const { data: organizations = [] } = useQuery<OrganizationOption[]>({
    queryKey: ['import-data-organizations', user?.id, user?.role, accessibleOrgIds],
    enabled: !!user,
    queryFn: async () => {
      let query = ((supabase.from('organizations') as any).select('id, name') as any).order('name')
      if (user?.role !== 'master' && user?.role !== 'grand_master') {
        if (!accessibleOrgIds.length) return []
        query = query.in('id', accessibleOrgIds)
      }
      const { data, error } = await query
      if (error) throw error
      return (data || []) as OrganizationOption[]
    },
  })

  useEffect(() => {
    if (!user) return
    if (selectedOrgId) return

    if (user.role !== 'master' && user.role !== 'grand_master' && user.organization_id) {
      setSelectedOrgId(user.organization_id)
      return
    }

    if (organizations.length === 1) {
      setSelectedOrgId(organizations[0].id)
    }
  }, [organizations, selectedOrgId, user])

  const fileKind = file ? classifyFile(file) : pastedTextInput.trim() ? 'text' : 'unknown'
  const effectiveAnalysisText = pastedTextInput.trim() || analysisText || (fileKind !== 'image' ? fileContent : null)
  const asksForOrganization = isElevatedUser && organizations.length > 1
  const purposeQuestions = useMemo(() => getPurposeQuestions(purpose, fileKind), [purpose, fileKind])
  const recommendedRoute = getRecommendedRoute(purpose)
  const tableRecommendations = useMemo(
    () => buildTableRecommendations({
      purpose,
      fileKind,
      file,
      fileContent: effectiveAnalysisText,
      extractedHeaders,
      sourceSystem,
      notes,
      expectedFields,
      documentType,
      plateNumber,
      personName,
    }),
    [purpose, fileKind, file, effectiveAnalysisText, extractedHeaders, sourceSystem, notes, expectedFields, documentType, plateNumber, personName],
  )
  const topRecommendation = tableRecommendations[0]

  const assistantBrief = useMemo(() => {
    const orgName = organizations.find((org) => org.id === selectedOrgId)?.name || 'No organisation selected'
    const details: string[] = [
      `Purpose: ${PURPOSE_OPTIONS.find((option) => option.value === purpose)?.label || purpose}`,
      `File type detected: ${fileKind}`,
      `Organisation: ${orgName}`,
      `Assistant: ${ASSISTANT_NAME} (${ASSISTANT_TITLE})`,
    ]

    if (topRecommendation) {
      details.push(`Suggested target table: ${topRecommendation.table}`)
      details.push(`Confidence score: ${topRecommendation.score}`)
    }

    details.push(`Extraction mode: ${extractionStrategy}`)
    if (extractionRationale.trim()) details.push(`Extraction note: ${extractionRationale.trim()}`)

    if (sourceSystem.trim()) details.push(`Source system: ${sourceSystem.trim()}`)
    if (dateRange.trim()) details.push(`Date range: ${dateRange.trim()}`)
    if (plateNumber.trim()) details.push(`Plate number: ${plateNumber.trim()}`)
    if (personName.trim()) details.push(`Person reference: ${personName.trim()}`)
    if (documentType.trim()) details.push(`Document type: ${documentType.trim()}`)
    if (expectedFields.trim()) details.push(`Expected fields: ${expectedFields.trim()}`)
    if (notes.trim()) details.push(`Operator notes: ${notes.trim()}`)

    return details.join('\n')
  }, [dateRange, documentType, expectedFields, extractionRationale, extractionStrategy, fileKind, notes, organizations, personName, plateNumber, purpose, selectedOrgId, sourceSystem, topRecommendation])

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['import-batches', historyOrgId],
    queryFn: async () => {
      let q = supabase
        .from('import_batches')
        .select('id, batch_name, file_name, status, total_records, successful_records, failed_records, created_at, completed_at, error_summary')
        .order('created_at', { ascending: false })
        .limit(50)
      if (historyOrgId) q = q.eq('organization_id', historyOrgId)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as ImportBatch[]
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const data = query.state.data as ImportBatch[] | undefined
      if (!data) return 5000
      return data.some((b) => ['pending', 'processing', 'enriching'].includes(b.status)) ? 5000 : false
    },
  })

  const inProgress = batches.filter((b) => ['pending', 'processing', 'enriching'].includes(b.status))

  const getTargetOrganizationId = () => selectedOrgId || user?.organization_id || ''

  const getFilePublicUrl = (path: string) => {
    const { data } = supabase.storage.from('evidence').getPublicUrl(path)
    return data.publicUrl
  }

  const persistIntakeRecord = async (params: {
    status: 'draft' | 'staged' | 'historical_started' | 'imported' | 'review_pending' | 'actioned' | 'failed'
    storagePath?: string | null
    filePublicUrl?: string | null
    actionTargetTable?: string | null
    actionTargetId?: string | null
    actionSummary?: string | null
  }) => {
    const organizationId = getTargetOrganizationId()
    if (!organizationId) throw new Error('Please select an organisation before creating an intake record')

    const payload = {
      organization_id: organizationId,
      created_by: user?.id || null,
      assistant_name: ASSISTANT_NAME,
      purpose,
      file_name: file?.name || batchName || 'untitled-import',
      file_kind: fileKind,
      mime_type: file?.type || null,
      storage_bucket: params.storagePath ? 'evidence' : null,
      storage_path: params.storagePath || null,
      file_public_url: params.filePublicUrl || null,
      source_system: sourceSystem || null,
      date_range: dateRange || null,
      operator_notes: notes || null,
      context: {
        batchName,
        recordDate,
        documentType,
        expectedFields,
        plateNumber,
        personName,
        pastedTextProvided: Boolean(pastedTextInput.trim()),
        extractionStrategy,
        extractionRationale,
      },
      extracted_text: effectiveAnalysisText,
      extracted_headers: extractedHeaders,
      assistant_brief: assistantBrief,
      recommended_table: topRecommendation?.table || null,
      recommendation_score: topRecommendation?.score || null,
      recommendations: tableRecommendations,
      status: params.status,
      action_target_table: params.actionTargetTable || null,
      action_target_id: params.actionTargetId || null,
      action_summary: params.actionSummary || null,
    }

    if (currentIntakeId) {
      const { data, error } = await ((supabase as any).from('ai_import_intakes') as any)
        .update(payload)
        .eq('id', currentIntakeId)
        .select('id')
        .single()
      if (error) throw error
      setCurrentIntakeId(data.id)
      return data.id as string
    }

    const { data, error } = await ((supabase as any).from('ai_import_intakes') as any)
      .insert(payload)
      .select('id')
      .single()
    if (error) throw error
    setCurrentIntakeId(data.id)
    return data.id as string
  }

  const ensureStagedIntakeForAction = async () => {
    if (currentIntakeId) return currentIntakeId
    const staged = await createAiIntakePackage()
    setResult(staged)
    return staged.intakeId as string
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = e.target.files?.[0]
    if (!nextFile) return
    setFile(nextFile)
    setResult(null)
    setCurrentIntakeId(null)
    setExtractedHeaders([])
    setAnalysisText(null)
    setExtractionStrategy('full')
    setExtractionRationale('')

    if (!batchName.trim()) {
      setBatchName(nextFile.name.replace(/\.[^.]+$/, ''))
    }

    const nextKind = classifyFile(nextFile)
    if (nextKind === 'image') {
      const reader = new FileReader()
      reader.readAsDataURL(nextFile)
      reader.onload = () => setFileContent(reader.result as string)
      try {
        const extracted = await extractDocumentData(nextFile, { enableImageOcr: true })
        setAnalysisText(extracted.text || null)
        setExtractedHeaders(extracted.headers || [])
        setExtractionStrategy(extracted.strategy)
        setExtractionRationale(extracted.rationale || '')
      } catch (error: any) {
        setExtractionStrategy('stage-only')
        setExtractionRationale(error?.message || 'Bob could not OCR this image safely in the browser.')
      }
      return
    }

    try {
      const extracted = await extractDocumentData(nextFile)
      setFileContent(nextKind === 'text' ? extracted.text || null : null)
      setAnalysisText(extracted.text || null)
      setExtractedHeaders(extracted.headers || [])
      setExtractionStrategy(extracted.strategy)
      setExtractionRationale(extracted.rationale || '')
    } catch (error: any) {
      setFileContent(null)
      setAnalysisText(null)
      setExtractedHeaders([])
      setExtractionStrategy('stage-only')
      setExtractionRationale(error?.message || 'Bob could not extract text from this file yet; routing will rely on metadata and file name.')
      toast.warning(error?.message || 'Bob could not extract text from this file yet; routing will rely on metadata and file name.')
    }
  }

  const createAiIntakePackage = async () => {
    if (!file && !pastedTextInput.trim()) throw new Error('Please select a file or paste content first')

    let storagePath: string | null = null
    let filePublicUrl: string | null = null

    if (file) {
      storagePath = buildAiIntakeStoragePath(selectedOrgId || user?.organization_id, purpose, file.name)
      const { error } = await supabase.storage
        .from('evidence')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || undefined,
        })

      if (error) throw error
      filePublicUrl = getFilePublicUrl(storagePath)
    }

    const intakeId = await persistIntakeRecord({
      status: 'staged',
      storagePath,
      filePublicUrl,
    })

    return {
      success: true,
      mode: 'intake-package',
      message: `${ASSISTANT_NAME} created a Bob intake package. The file has been staged for guided review and correct routing.`,
      intakeId,
      storagePath,
      filePublicUrl,
      recommendedRoute,
      assistantBrief,
      tableRecommendations,
    }
  }

  const runHistoricalImport = async () => {
    if (!file && !pastedTextInput.trim()) throw new Error('Please select a file or paste historical data first')
    if (file && fileKind !== 'spreadsheet') throw new Error('Historical import requires a CSV or Excel file')
    if (!selectedOrgId) throw new Error('Please select the target organisation for these historical records')

    let data: any = null
    let error: any = null
    let storagePath: string | null = null

    if (file) {
      storagePath = buildHistoricalImportStoragePath(selectedOrgId, file.name)
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || undefined,
        })

      error = uploadError
    }

    if (file && !error && storagePath) {
      ;({ data, error } = await edgeFunctions.importHistoricalData({
        filePath: storagePath,
        bucket: 'evidence',
        fileName: file.name,
        batchName: batchName.trim() || file.name,
        organizationId: selectedOrgId,
      }))
    } else {
      let encoded = ''
      const importName = file?.name || `${batchName.trim() || 'pasted-historical-import'}.csv`

      if (pastedTextInput.trim()) {
        encoded = btoa(unescape(encodeURIComponent(pastedTextInput.trim())))
      } else if (file) {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        const chunkSize = 8192
        const chunks: string[] = []
        for (let i = 0; i < bytes.length; i += chunkSize) {
          chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)))
        }
        encoded = btoa(chunks.join(''))
      }

      ;({ data, error } = await edgeFunctions.importHistoricalData({
        fileContent: encoded,
        fileName: importName,
        batchName: batchName.trim() || importName,
        organizationId: selectedOrgId,
      }))
    }

    if (error) throw new Error(error)

    const filePublicUrl = storagePath ? getFilePublicUrl(storagePath) : null
    const intakeId = await persistIntakeRecord({
      status: 'historical_started',
      storagePath,
      filePublicUrl,
    })

    return {
      success: true,
      mode: 'historical-import',
      intakeId,
      batchId: data?.batchId || null,
      message: data?.message || 'Historical import started successfully.',
      recommendedRoute,
      assistantBrief,
      tableRecommendations,
    }
  }

  const runDirectAiImport = async () => {
    if (!file && !pastedTextInput.trim()) throw new Error('Please select a file or paste content first')
    const importPayload = pastedTextInput.trim() || fileContent
    if (!importPayload) throw new Error('This content cannot be read directly in the browser. Create an intake package instead.')

    const { data, error } = await edgeFunctions.importData({
      fileContent: importPayload,
      fileName: file?.name || `${batchName.trim() || 'pasted-intake'}.txt`,
      isImage: fileKind === 'image',
      recordDate: recordDate || undefined,
      organizationId: selectedOrgId || user?.organization_id || undefined,
      importType: purpose,
    })

    if (error) throw new Error(error)

    const intakeId = await persistIntakeRecord({ status: 'imported' })

    return {
      ...data,
      intakeId,
      success: data?.success !== false,
      mode: 'direct-ai-import',
      recommendedRoute,
      assistantBrief,
      tableRecommendations,
    }
  }

  const handleCreateVehicleOfInterest = async () => {
    if (!user?.id) return
    if (!plateNumber.trim()) {
      toast.error('Add a plate number before creating a vehicle of interest')
      return
    }

    setActionPending('voi')
    try {
      const intakeId = await ensureStagedIntakeForAction()
      const fileUrl = result?.filePublicUrl || null
      const { data, error } = await ((supabase as any).from('vehicles_of_interest') as any)
        .insert({
          organization_id: getTargetOrganizationId(),
          created_by: user.id,
          plate_number: plateNumber.trim().toUpperCase(),
          vehicle_make: null,
          vehicle_model: null,
          vehicle_color: null,
          description: sourceSystem || documentType || null,
          status: 'voi',
          reason: notes || selectedPurpose?.label || 'Imported via Bob',
          photos: fileUrl ? [fileUrl] : [],
          notes: assistantBrief,
          active: true,
        })
        .select('id')
        .single()
      if (error) throw error

      await persistIntakeRecord({
        status: 'actioned',
        actionTargetTable: 'vehicles_of_interest',
        actionTargetId: data.id,
        actionSummary: `Vehicle of interest created from Bob intake ${intakeId}`,
      })

      toast.success('Vehicle of interest created')
      navigate('/points-of-interest')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create vehicle of interest')
    } finally {
      setActionPending(null)
    }
  }

  const handleCreatePersonOfInterest = async () => {
    if (!user?.id) return
    if (!personName.trim()) {
      toast.error('Add a person name or alias before creating a person of interest')
      return
    }

    setActionPending('poi')
    try {
      const intakeId = await ensureStagedIntakeForAction()
      const fileUrl = result?.filePublicUrl || null
      const { data, error } = await ((supabase as any).from('persons_of_interest') as any)
        .insert({
          organization_id: getTargetOrganizationId(),
          created_by: user.id,
          full_name: personName.trim(),
          description: documentType || sourceSystem || null,
          status: 'poi',
          reason: notes || selectedPurpose?.label || 'Imported via Bob',
          photos: fileUrl ? [fileUrl] : [],
          notes: assistantBrief,
          privacy_notice_given: false,
          active: true,
        })
        .select('id')
        .single()
      if (error) throw error

      await persistIntakeRecord({
        status: 'actioned',
        actionTargetTable: 'persons_of_interest',
        actionTargetId: data.id,
        actionSummary: `Person of interest created from Bob intake ${intakeId}`,
      })

      toast.success('Person of interest created')
      navigate('/points-of-interest')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create person of interest')
    } finally {
      setActionPending(null)
    }
  }

  const handleCreateIdentityReview = async () => {
    setActionPending('identity')
    try {
      const intakeId = await ensureStagedIntakeForAction()
      await persistIntakeRecord({
        status: 'review_pending',
        actionTargetTable: 'identity_reference_review',
        actionSummary: `Identity review queued from Bob intake ${intakeId}`,
      })
      toast.success('Identity review entry created')
      navigate('/identity-verification')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create identity review')
    } finally {
      setActionPending(null)
    }
  }

  const handleImport = async () => {
    if (!file && !pastedTextInput.trim()) {
      toast.error('Please select a file or paste content first')
      return
    }

    if (!batchName.trim()) {
      toast.error('Please enter a batch name')
      return
    }

    if (asksForOrganization && !selectedOrgId) {
      toast.error('Please select the organisation this import belongs to')
      return
    }

    setUploading(true)
    setResult(null)

    try {
      let nextResult: any
      const shouldForceStaging = extractionStrategy === 'stage-only' && purpose !== 'historical_records'

      if (purpose === 'historical_records') {
        nextResult = await runHistoricalImport()
        toast.success(nextResult.batchId ? `Historical import started — batch ${String(nextResult.batchId).slice(0, 8)}...` : 'Historical import started')
      } else if (shouldForceStaging || fileKind === 'document') {
        nextResult = await createAiIntakePackage()
        toast.success('Bob intake package created')
      } else if (fileKind === 'image' || fileKind === 'text') {
        nextResult = await runDirectAiImport()
        toast.success(nextResult?.success ? 'Bob import completed' : 'Bob import finished with warnings')
      } else {
        nextResult = await createAiIntakePackage()
        toast.success('Bob intake package created')
      }

      setResult(nextResult)
      queryClient.invalidateQueries({ queryKey: ['import-batches'] })
      setTab('intake')
    } catch (err: any) {
      toast.error(err?.message || 'Import failed')
      setResult({ error: err?.message || 'Import failed' })
    } finally {
      setUploading(false)
    }
  }

  const selectedPurpose = PURPOSE_OPTIONS.find((option) => option.value === purpose)

  return (
    <AppLayout title="Import Data" description={`One-stop Bob-guided import intake powered by ${ASSISTANT_NAME} for historical records, photos, PDFs, Word documents, and structured review.`}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="intake" className="flex items-center gap-1.5">
            <BrainCircuit className="h-4 w-4" />
            Guided Intake
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <List className="h-4 w-4" />
            Import History
            {inProgress.length > 0 && (
              <Badge variant="default" className="ml-1 h-4 px-1 text-[10px]">{inProgress.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="intake" className="mt-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BrainCircuit className="h-5 w-5 text-primary" />
                    {ASSISTANT_NAME} Import Intake Hub
                  </CardTitle>
                  <CardDescription>
                    Upload a photo, spreadsheet, PDF, Word document, or text file. {ASSISTANT_NAME} asks what the file is for, which organisation owns it, and what details are needed so it lands in the right workflow.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                      Historical spreadsheets
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Use for historical vehicle records, observation extracts, Downer/LINZ files, and Excel-based backfills.</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Image className="h-4 w-4 text-sky-600" />
                      Photos and image evidence
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Use for vehicle of interest photos, POI images, site evidence, or field observation media.</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-amber-600" />
                      PDF and Word documents
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Use for identity references, procedures, source documents, and files that need guided Bob review before import.</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Route className="h-4 w-4 text-violet-600" />
                      Correct destination routing
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">The intake summary tells the operator what details are still needed and which workflow should receive the file.</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Import Context</CardTitle>
                  <CardDescription>
                    Tell the assistant what this file is for before importing or packaging it.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>What is this file for? *</Label>
                    <Select value={purpose} onValueChange={(value) => setPurpose(value as ImportPurpose)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select import purpose" />
                      </SelectTrigger>
                      <SelectContent>
                        {PURPOSE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{selectedPurpose?.description}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>
                      Organisation {asksForOrganization ? '*' : '(auto-selected if only one is available)'}
                    </Label>
                    <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select organisation" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {asksForOrganization && (
                      <p className="text-xs text-muted-foreground">This user can import into multiple organisations, so the target organisation must be chosen explicitly.</p>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Batch Name *</Label>
                      <input
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={batchName}
                        onChange={(e) => setBatchName(e.target.value)}
                        placeholder="Descriptive name for this import"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Default Record Date</Label>
                      <input
                        type="date"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={recordDate}
                        onChange={(e) => setRecordDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Source system or supplier</Label>
                      <input
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={sourceSystem}
                        onChange={(e) => setSourceSystem(e.target.value)}
                        placeholder="Example: Downer, LINZ, CES Control"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Date range or coverage</Label>
                      <input
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        placeholder="Example: Jan 2025 to Mar 2026"
                      />
                    </div>
                  </div>

                  {(purpose === 'vehicle_of_interest_photo' || purpose === 'general_observation') && (
                    <div className="space-y-1.5">
                      <Label>Plate number or vehicle reference</Label>
                      <input
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={plateNumber}
                        onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                        placeholder="Example: ABC123"
                      />
                    </div>
                  )}

                  {purpose === 'person_of_interest_photo' && (
                    <div className="space-y-1.5">
                      <Label>Person name or alias</Label>
                      <input
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={personName}
                        onChange={(e) => setPersonName(e.target.value)}
                        placeholder="Example: Jane Doe or alias"
                      />
                    </div>
                  )}

                  {purpose === 'identity_reference' && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Document type</Label>
                        <input
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={documentType}
                          onChange={(e) => setDocumentType(e.target.value)}
                          placeholder="Example: ID card, access card, driver licence"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Fields Bob should check or extract</Label>
                        <Textarea
                          value={expectedFields}
                          onChange={(e) => setExpectedFields(e.target.value)}
                          placeholder="Example: full name, card number, expiry date, issuing organisation"
                        />
                      </div>
                    </>
                  )}

                  <div className="space-y-1.5">
                    <Label>Operator notes</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Explain what Bob should look for, where this data belongs, and any quality risks in the file."
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>File Upload</CardTitle>
                  <CardDescription>
                    Supported types: CSV, XLS, XLSX, TXT, JSON, JPG, PNG, GIF, BMP, WEBP, PDF, DOC, DOCX. You can also paste raw text or tabular content directly below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                    onClick={() => fileRef.current?.click()}
                  >
                    {file ? (
                      <div className="flex flex-col items-center gap-2">
                        {fileKind === 'image' ? <Image className="h-8 w-8 text-blue-500" /> : fileKind === 'spreadsheet' ? <FileSpreadsheet className="h-8 w-8 text-emerald-600" /> : <FileText className="h-8 w-8 text-amber-500" />}
                        <span className="font-semibold">{file.name}</span>
                        <span className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
                        <Badge variant="outline">Detected: {fileKind}</Badge>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Upload className="h-8 w-8" />
                        <span>Click to choose a file</span>
                        <span className="text-xs">Photos, spreadsheets, PDFs, Word docs, and text files</span>
                      </div>
                    )}
                  </div>

                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.txt,.json,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.bmp,.webp,.pdf,.doc,.docx"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="gap-1"><FileSpreadsheet className="h-3.5 w-3.5" /> Historical spreadsheet</Badge>
                    <Badge variant="outline" className="gap-1"><CarFront className="h-3.5 w-3.5" /> Vehicle image</Badge>
                    <Badge variant="outline" className="gap-1"><UserRound className="h-3.5 w-3.5" /> POI media</Badge>
                    <Badge variant="outline" className="gap-1"><IdCard className="h-3.5 w-3.5" /> Identity reference</Badge>
                    {extractedHeaders.length > 0 && <Badge variant="secondary">{extractedHeaders.length} detected headers</Badge>}
                    <Badge variant={extractionStrategy === 'stage-only' ? 'destructive' : extractionStrategy === 'limited' ? 'secondary' : 'outline'}>
                      Extraction: {extractionStrategy}
                    </Badge>
                  </div>

                  {extractionRationale && (
                    <p className="text-xs text-muted-foreground">{extractionRationale}</p>
                  )}

                  <div className="space-y-1.5">
                    <Label>Paste text, CSV, or extracted notes instead of uploading a file</Label>
                    <Textarea
                      value={pastedTextInput}
                      onChange={(e) => {
                        setPastedTextInput(e.target.value)
                        setCurrentIntakeId(null)
                        setResult(null)
                        setExtractionStrategy(e.target.value.trim() ? 'full' : extractionStrategy)
                        setExtractionRationale(e.target.value.trim() ? 'Bob is using pasted content directly, which avoids file parsing overhead.' : extractionRationale)
                      }}
                      placeholder="Paste CSV rows, copied spreadsheet text, notes, or extracted document text here if you do not want to upload a file."
                      className="min-h-[140px]"
                    />
                  </div>

                  {effectiveAnalysisText && fileKind !== 'image' && (
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2">{ASSISTANT_NAME}'s extracted text preview</div>
                      <pre className="whitespace-pre-wrap text-xs text-foreground max-h-40 overflow-auto">{effectiveAnalysisText.slice(0, 1200)}</pre>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Button className="w-full" onClick={handleImport} disabled={(!file && !pastedTextInput.trim()) || uploading}>
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing import...
                  </span>
                ) : purpose === 'historical_records' ? (
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" />
                    Start Historical Import
                  </span>
                ) : fileKind === 'image' || fileKind === 'text' ? (
                  <span className="flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4" />
                    Analyse and Import with Bob
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Create Guided Intake Package
                  </span>
                )}
              </Button>

              {result && (
                <Card className={result.error ? 'border-red-300' : 'border-green-300'}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      {result.error ? (
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                      ) : (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      )}
                      <span className="font-semibold">{result.error ? 'Import Error' : 'Bob Intake Result'}</span>
                    </div>

                    {result.message && <p className="text-sm text-muted-foreground">{result.message}</p>}
                    {result.records_inserted != null && <p className="text-sm">Records imported: <strong>{result.records_inserted}</strong></p>}
                    {result.batchId && <p className="text-sm">Batch ID: <strong>{result.batchId}</strong></p>}
                    {result.storagePath && <p className="text-sm">Staged file: <strong>{result.storagePath}</strong></p>}

                    {!result.error && (
                      <>
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <div className="text-xs font-medium text-muted-foreground mb-2">{ASSISTANT_NAME}'s routing brief</div>
                          <pre className="whitespace-pre-wrap text-xs text-foreground">{result.assistantBrief || assistantBrief}</pre>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => navigate(result.recommendedRoute?.path || recommendedRoute.path)}>
                            {result.recommendedRoute?.label || recommendedRoute.label}
                          </Button>
                          {purpose === 'historical_records' && (
                            <Button variant="outline" onClick={() => setTab('history')}>
                              View Import History
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>Assistant Questions</CardTitle>
                  <CardDescription>
                    These are the questions {ASSISTANT_NAME} is using to place the file correctly.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {purposeQuestions.map((question) => (
                    <div key={question} className="rounded-lg border p-3 text-sm">
                      {question}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{ASSISTANT_NAME}'s Logical Match</CardTitle>
                  <CardDescription>
                    {ASSISTANT_NAME} scores likely destination tables and matching columns before deciding whether to import now, package for review, or send the operator to a specialist workflow.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {topRecommendation && (
                    <div className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Top table match</div>
                          <div className="font-medium">{topRecommendation.label}</div>
                          <div className="text-xs text-muted-foreground mt-1">Table: {topRecommendation.table}</div>
                        </div>
                        <Badge variant={topRecommendation.score >= 75 ? 'default' : topRecommendation.score >= 55 ? 'secondary' : 'outline'}>
                          Score {topRecommendation.score}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{topRecommendation.rationale}</p>
                    </div>
                  )}

                  {topRecommendation && (
                    <div className="rounded-lg border p-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2">Likely column matches</div>
                      {topRecommendation.columns.length > 0 ? (
                        <div className="space-y-2">
                          {topRecommendation.columns.map((column) => (
                            <div key={column.target} className="flex items-start justify-between gap-3 rounded border bg-muted/20 px-3 py-2">
                              <div>
                                <div className="font-medium text-sm">{column.target}</div>
                                <div className="text-xs text-muted-foreground">Signals: {column.matchedSignals.join(', ')}</div>
                              </div>
                              {column.required && <Badge variant="outline">Required</Badge>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{ASSISTANT_NAME} does not yet have strong column evidence from the file contents, so this import should be reviewed before final mapping.</p>
                      )}
                    </div>
                  )}

                  {tableRecommendations.length > 1 && (
                    <div className="rounded-lg border p-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2">Alternative logical destinations</div>
                      <div className="space-y-2">
                        {tableRecommendations.slice(1, 4).map((candidate) => (
                          <div key={candidate.table} className="flex items-center justify-between gap-2 rounded border bg-muted/20 px-3 py-2">
                            <div>
                              <div className="font-medium text-sm">{candidate.label}</div>
                              <div className="text-xs text-muted-foreground">{candidate.table}</div>
                            </div>
                            <Badge variant="outline">Score {candidate.score}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">One-click actions</div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCreateVehicleOfInterest}
                        disabled={actionPending !== null || !(topRecommendation?.table === 'vehicles_of_interest' || purpose === 'vehicle_of_interest_photo')}
                      >
                        Create VOI
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCreatePersonOfInterest}
                        disabled={actionPending !== null || !(topRecommendation?.table === 'persons_of_interest' || purpose === 'person_of_interest_photo')}
                      >
                        Create POI
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCreateIdentityReview}
                        disabled={actionPending !== null || !(topRecommendation?.table === 'user_profiles' || purpose === 'identity_reference')}
                      >
                        Create Identity Review
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Bob will persist the intake, then create the selected downstream record or review entry.</p>
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Recommended destination</div>
                    <div className="font-medium">{recommendedRoute.label}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Current purpose</div>
                    <div className="font-medium">{selectedPurpose?.label}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedPurpose?.description}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Detected file type</div>
                    <div className="font-medium capitalize">{fileKind}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">{ASSISTANT_NAME}'s brief preview</div>
                    <pre className="whitespace-pre-wrap text-xs text-foreground">{assistantBrief}</pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-3">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : batches.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Database className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground">No import history</p>
              </CardContent>
            </Card>
          ) : (
            batches.map((batch) => {
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
                        {batch.file_name && <div className="text-xs text-muted-foreground">{batch.file_name}</div>}
                        <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                          {batch.total_records > 0 && <span>{batch.successful_records}/{batch.total_records} records</span>}
                          {batch.failed_records > 0 && <span className="text-red-600">{batch.failed_records} failed</span>}
                          <span>{formatDateTime(batch.created_at)}</span>
                          {batch.completed_at && <span>Completed {formatDateTime(batch.completed_at)}</span>}
                        </div>
                        {batch.error_summary && <p className="text-xs text-red-600 line-clamp-2">{batch.error_summary}</p>}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {isRunning ? 'In progress' : 'Finished'}
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