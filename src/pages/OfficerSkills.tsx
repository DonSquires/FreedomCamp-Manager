import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import {
  listTrainingAssignmentAudit,
  listTrainingAssignmentQueue,
  listTrainingLibrary,
  recordTrainingCompletionAttempt,
  runAutoAssignTraining,
  saveTrainingModuleToLibrary,
  sendBulkTrainingAssignmentReminders,
  sendTrainingAssignmentReminder,
  type AutoAssignResult,
  type TrainingBulkReminderResult,
  type TrainingAssignmentAuditRow,
  type TrainingAssignmentRow,
  type TrainingLibraryItem,
} from '@/lib/trainingOrchestration'
import {
  consumeLatestTrainingComposerPacket,
  type ReferenceVerification,
  type TrainingModuleDraft,
} from '@/lib/trainingComposerBridge'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'
import {
  GraduationCap,
  Plus,
  Pencil,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  Download,
  Paperclip,
  Shield,
  BadgeCheck,
  Brain,
  BookOpen,
  Sparkles,
  BellRing,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

type SkillCategory =
  | 'licence'
  | 'certification'
  | 'training'
  | 'equipment'
  | 'language'
  | 'general'

interface OfficerSkill {
  id: string
  officer_id: string
  organization_id: string
  skill_name: string
  skill_category: SkillCategory
  certification_number: string | null
  issued_at: string | null
  expires_at: string | null
  document_url: string | null
  is_verified: boolean
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  officer?: {
    first_name: string
    last_name: string
    email: string
  }
}

interface OfficerProfile {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
  organization_id: string
  is_active: boolean
  coa_number: string | null
  coa_expiry: string | null
  warrant_number: string | null
  warrant_expiry: string | null
  credentials_verified: boolean
}

type StatusFilter = 'all' | 'active' | 'expiring' | 'expired' | 'unverified'

const SKILL_SUGGESTIONS = [
  'Certificate of Authority',
  'First Aid Level 2',
  'Fire Warden',
  'Dog Handler',
  'CCTV Operator',
  'Driver Licence Class 2',
  'Noise Control Officer',
  'Defensive Driving',
]

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  licence: 'Licence',
  certification: 'Certification',
  training: 'Training',
  equipment: 'Equipment',
  language: 'Language',
  general: 'General',
}

const EXPIRING_SOON_DAYS = 60
const ALERT_DAYS = 90

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function getSkillStatus(expires_at: string | null): 'valid' | 'expiring' | 'expired' | 'no_expiry' {
  if (!expires_at) return 'no_expiry'
  const days = daysUntil(expires_at)
  if (days < 0) return 'expired'
  if (days <= EXPIRING_SOON_DAYS) return 'expiring'
  return 'valid'
}

function StatusBadge({ expires_at }: { expires_at: string | null }) {
  const status = getSkillStatus(expires_at)
  if (status === 'no_expiry')
    return <Badge variant="secondary">No Expiry</Badge>
  if (status === 'valid')
    return <Badge className="bg-green-100 text-green-800 border-green-200">Valid</Badge>
  if (status === 'expiring')
    return <Badge className="bg-orange-100 text-orange-800 border-orange-200">Expiring</Badge>
  return <Badge className="bg-red-100 text-red-800 border-red-200">Expired</Badge>
}

function CategoryBadge({ category }: { category: SkillCategory }) {
  const colors: Record<SkillCategory, string> = {
    licence: 'bg-blue-100 text-blue-800',
    certification: 'bg-purple-100 text-purple-800',
    training: 'bg-yellow-100 text-yellow-800',
    equipment: 'bg-slate-100 text-slate-800',
    language: 'bg-pink-100 text-pink-800',
    general: 'bg-gray-100 text-gray-800',
  }
  return (
    <Badge className={`${colors[category]} border-0`}>
      {CATEGORY_LABELS[category]}
    </Badge>
  )
}

// ─── Add/Edit Dialog ─────────────────────────────────────────────────────────

interface SkillFormData {
  officer_id: string
  skill_name: string
  skill_category: SkillCategory
  certification_number: string
  issued_at: string
  expires_at: string
  document_url: string
  notes: string
}

const EMPTY_FORM: SkillFormData = {
  officer_id: '',
  skill_name: '',
  skill_category: 'certification',
  certification_number: '',
  issued_at: '',
  expires_at: '',
  document_url: '',
  notes: '',
}

interface SkillDialogProps {
  open: boolean
  onClose: () => void
  editing: OfficerSkill | null
  officers: OfficerProfile[]
  organizationId: string
  userId: string
}

function SkillDialog({ open, onClose, editing, officers, organizationId, userId }: SkillDialogProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SkillFormData>(EMPTY_FORM)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Populate form when editing changes
  useEffect(() => {
    if (editing) {
      setForm({
        officer_id: editing.officer_id,
        skill_name: editing.skill_name,
        skill_category: editing.skill_category,
        certification_number: editing.certification_number ?? '',
        issued_at: editing.issued_at ?? '',
        expires_at: editing.expires_at ?? '',
        document_url: editing.document_url ?? '',
        notes: editing.notes ?? '',
      })
    } else {
      setForm(EMPTY_FORM)
    }
  }, [editing])

  const upsertMutation = useMutation({
    mutationFn: async (data: SkillFormData) => {
      const payload = {
        officer_id: data.officer_id,
        organization_id: organizationId,
        skill_name: data.skill_name.trim(),
        skill_category: data.skill_category,
        certification_number: data.certification_number.trim() || null,
        issued_at: data.issued_at || null,
        expires_at: data.expires_at || null,
        document_url: data.document_url.trim() || null,
        notes: data.notes.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (editing) {
        const { error } = await (supabase as any)
          .from('officer_skills')
          .update(payload)
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('officer_skills')
          .insert({ ...payload, created_at: new Date().toISOString() })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officer_skills'] })
      toast.success(editing ? 'Skill updated' : 'Skill added')
      onClose()
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to save skill'),
  })

  const set = (field: keyof SkillFormData) => (val: string) =>
    setForm((f) => ({ ...f, [field]: val }))

  const filteredSuggestions = SKILL_SUGGESTIONS.filter((s) =>
    s.toLowerCase().includes(form.skill_name.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Skill / Qualification' : 'Add Skill / Qualification'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Officer */}
          <div className="space-y-1">
            <Label>Officer <span className="text-red-500">*</span></Label>
            <Select value={form.officer_id} onValueChange={set('officer_id')}>
              <SelectTrigger>
                <SelectValue placeholder="Select officer…" />
              </SelectTrigger>
              <SelectContent>
                {officers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.first_name} {o.last_name} — {o.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Skill Name */}
          <div className="space-y-1 relative">
            <Label>Skill / Qualification Name <span className="text-red-500">*</span></Label>
            <Input
              value={form.skill_name}
              onChange={(e) => {
                set('skill_name')(e.target.value)
                setShowSuggestions(true)
              }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="e.g. Certificate of Authority"
            />
            {showSuggestions && form.skill_name && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg">
                {filteredSuggestions.map((s) => (
                  <button
                    key={s}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    onMouseDown={() => {
                      set('skill_name')(s)
                      setShowSuggestions(false)
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={form.skill_category} onValueChange={(v) => set('skill_category')(v as SkillCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_LABELS) as SkillCategory[]).map((cat) => (
                  <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Certification Number */}
          <div className="space-y-1">
            <Label>Certification Number</Label>
            <Input value={form.certification_number} onChange={(e) => set('certification_number')(e.target.value)} placeholder="e.g. CoA-12345" />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Issued Date</Label>
              <Input type="date" value={form.issued_at} onChange={(e) => set('issued_at')(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expires_at} onChange={(e) => set('expires_at')(e.target.value)} />
            </div>
          </div>

          {/* Document URL */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" /> Document URL
            </Label>
            <Input value={form.document_url} onChange={(e) => set('document_url')(e.target.value)} placeholder="https://…" />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} rows={3} placeholder="Additional notes…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => upsertMutation.mutate(form)}
            disabled={!form.officer_id || !form.skill_name || upsertMutation.isPending}
          >
            {upsertMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Add Skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function OfficerSkills() {
  const location = useLocation()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const organizationId: string = user?.organization_id ?? ''
  const isAdmin = user?.role === 'admin' || user?.role === 'master' || user?.role === 'grand_master'

  const [tab, setTab] = useState<'skills' | 'licences' | 'classroom'>(() => {
    const search = new URLSearchParams(location.search)
    return search.get('tab') === 'classroom' ? 'classroom' : 'skills'
  })
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showExpiring, setShowExpiring] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<OfficerSkill | null>(null)

  useEffect(() => {
    const search = new URLSearchParams(location.search)
    if (search.get('tab') === 'classroom') {
      setTab('classroom')
    }
  }, [location.search])

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: skills = [], isLoading: skillsLoading } = useQuery({
    queryKey: ['officer_skills', organizationId],
    queryFn: async (): Promise<OfficerSkill[]> => {
      const { data, error } = await (supabase as any)
        .from('officer_skills')
        .select(`
          *,
          officer:user_profiles!officer_id(first_name, last_name, email)
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as OfficerSkill[]
    },
    enabled: !!organizationId,
  })

  const { data: officers = [] } = useQuery({
    queryKey: ['officers', organizationId],
    queryFn: async (): Promise<OfficerProfile[]> => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('first_name')
      if (error) throw error
      return data as OfficerProfile[]
    },
    enabled: !!organizationId,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const verifyMutation = useMutation({
    mutationFn: async (skillId: string) => {
      const { error } = await (supabase as any)
        .from('officer_skills')
        .update({
          is_verified: true,
          verified_by: user?.id,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', skillId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['officer_skills'] })
      toast.success('Skill verified')
    },
    onError: (err: any) => toast.error(err.message ?? 'Verification failed'),
  })

  // ── Derived / Filters ─────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return skills.filter((s) => {
      const officerName = s.officer
        ? `${s.officer.first_name} ${s.officer.last_name} ${s.officer.email}`.toLowerCase()
        : ''
      if (search && !officerName.includes(search.toLowerCase()) && !s.skill_name.toLowerCase().includes(search.toLowerCase()))
        return false
      if (categoryFilter !== 'all' && s.skill_category !== categoryFilter) return false
      const status = getSkillStatus(s.expires_at)
      if (statusFilter === 'active' && status !== 'valid' && status !== 'no_expiry') return false
      if (statusFilter === 'expiring' && status !== 'expiring') return false
      if (statusFilter === 'expired' && status !== 'expired') return false
      if (statusFilter === 'unverified' && s.is_verified) return false
      if (showExpiring) {
        const days = daysUntil(s.expires_at)
        if (days === null || days > EXPIRING_SOON_DAYS) return false
      }
      return true
    })
  }, [skills, search, categoryFilter, statusFilter, showExpiring])

  const stats = useMemo(() => {
    const total = skills.length
    const expiringSoon = skills.filter((s) => getSkillStatus(s.expires_at) === 'expiring').length
    const expired = skills.filter((s) => getSkillStatus(s.expires_at) === 'expired').length
    const verified = skills.filter((s) => s.is_verified).length
    return { total, expiringSoon, expired, verified }
  }, [skills])

  const alertSkills = useMemo(() =>
    skills
      .filter((s) => {
        const days = daysUntil(s.expires_at)
        return days !== null && days <= ALERT_DAYS
      })
      .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime()),
    [skills]
  )

  // ── CSV Export ────────────────────────────────────────────────────────────

  function exportCSV() {
    const rows = [
      ['Officer', 'Email', 'Skill', 'Category', 'Cert Number', 'Issued', 'Expires', 'Status', 'Verified'],
      ...skills.map((s) => [
        s.officer ? `${s.officer.first_name} ${s.officer.last_name}` : s.officer_id,
        s.officer?.email ?? '',
        s.skill_name,
        s.skill_category,
        s.certification_number ?? '',
        s.issued_at ?? '',
        s.expires_at ?? '',
        getSkillStatus(s.expires_at),
        s.is_verified ? 'Yes' : 'No',
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `officer-skills-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Officer Skills & Qualifications</h1>
              <p className="text-sm text-muted-foreground">Track certifications, licences and training records</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => { setEditingSkill(null); setDialogOpen(true) }}>
                <Plus className="h-4 w-4 mr-1" /> Add Skill
              </Button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <GraduationCap className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Total Skills</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className={stats.expiringSoon > 0 ? 'border-orange-300' : ''}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <Clock className={`h-8 w-8 ${stats.expiringSoon > 0 ? 'text-orange-500' : 'text-gray-400'}`} />
                <div>
                  <p className={`text-2xl font-bold ${stats.expiringSoon > 0 ? 'text-orange-600' : ''}`}>
                    {stats.expiringSoon}
                  </p>
                  <p className="text-xs text-muted-foreground">Expiring Soon</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className={stats.expired > 0 ? 'border-red-300' : ''}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <XCircle className={`h-8 w-8 ${stats.expired > 0 ? 'text-red-500' : 'text-gray-400'}`} />
                <div>
                  <p className={`text-2xl font-bold ${stats.expired > 0 ? 'text-red-600' : ''}`}>
                    {stats.expired}
                  </p>
                  <p className="text-xs text-muted-foreground">Expired</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <BadgeCheck className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold text-green-600">{stats.verified}</p>
                  <p className="text-xs text-muted-foreground">Verified</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex border-b gap-1">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'skills' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('skills')}
          >
            Skills & Certifications
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'licences' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('licences')}
          >
            <Shield className="h-4 w-4 inline mr-1" />
            Licences (CoA / Warrant)
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'classroom' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab('classroom')}
          >
            <Brain className="h-4 w-4 inline mr-1" />
            Bob Classroom Tutor
          </button>
        </div>

        {/* ── SKILLS TAB ── */}
        {tab === 'skills' && (
          <div className="space-y-5">
            {/* Filters */}
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <Label className="text-xs mb-1 block">Search Officer / Skill</Label>
                    <Input
                      placeholder="Name, email or skill…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="min-w-[160px]">
                    <Label className="text-xs mb-1 block">Category</Label>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {(Object.keys(CATEGORY_LABELS) as SkillCategory[]).map((cat) => (
                          <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[160px]">
                    <Label className="text-xs mb-1 block">Status</Label>
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="expiring">Expiring</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="unverified">Unverified</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pb-0.5">
                    <Switch
                      id="expiring-toggle"
                      checked={showExpiring}
                      onCheckedChange={setShowExpiring}
                    />
                    <Label htmlFor="expiring-toggle" className="text-xs cursor-pointer">
                      Expiring only
                    </Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Main Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Skills & Qualifications
                  <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} records)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {skillsLoading ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
                ) : filtered.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">No skills found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Officer</TableHead>
                          <TableHead>Skill / Qualification</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Cert Number</TableHead>
                          <TableHead>Issued</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Verified</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((skill) => (
                          <TableRow key={skill.id}>
                            <TableCell className="font-medium whitespace-nowrap">
                              {skill.officer
                                ? `${skill.officer.first_name} ${skill.officer.last_name}`
                                : skill.officer_id}
                              {skill.officer?.email && (
                                <div className="text-xs text-muted-foreground">{skill.officer.email}</div>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{skill.skill_name}</TableCell>
                            <TableCell><CategoryBadge category={skill.skill_category} /></TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {skill.certification_number ?? '—'}
                            </TableCell>
                            <TableCell className="text-sm">
                              {skill.issued_at ? formatDate(skill.issued_at) : '—'}
                            </TableCell>
                            <TableCell className="text-sm">
                              {skill.expires_at ? formatDate(skill.expires_at) : '—'}
                            </TableCell>
                            <TableCell><StatusBadge expires_at={skill.expires_at} /></TableCell>
                            <TableCell>
                              {skill.is_verified ? (
                                <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                                  <CheckCircle className="h-4 w-4" /> Verified
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-gray-400 text-xs">
                                  <XCircle className="h-4 w-4" /> Unverified
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {isAdmin && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => { setEditingSkill(skill); setDialogOpen(true) }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                                {isAdmin && !skill.is_verified && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-green-600 hover:text-green-700"
                                    onClick={() => verifyMutation.mutate(skill.id)}
                                    disabled={verifyMutation.isPending}
                                  >
                                    <BadgeCheck className="h-4 w-4" />
                                  </Button>
                                )}
                                {skill.document_url && (
                                  <a href={skill.document_url} target="_blank" rel="noreferrer">
                                    <Button size="sm" variant="ghost">
                                      <Paperclip className="h-4 w-4" />
                                    </Button>
                                  </a>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Expiry Alerts Section */}
            {alertSkills.length > 0 && (
              <Card className="border-orange-200 bg-orange-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-orange-700">
                    <AlertTriangle className="h-5 w-5" />
                    Expiring / Expired Alerts
                    <span className="text-sm font-normal text-orange-600">
                      ({alertSkills.length} within {ALERT_DAYS} days)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Officer</TableHead>
                          <TableHead>Skill</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Days</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {alertSkills.map((s) => {
                          const days = daysUntil(s.expires_at)
                          return (
                            <TableRow key={s.id} className={days !== null && days < 0 ? 'bg-red-50' : 'bg-orange-50/50'}>
                              <TableCell className="font-medium">
                                {s.officer ? `${s.officer.first_name} ${s.officer.last_name}` : s.officer_id}
                              </TableCell>
                              <TableCell>{s.skill_name}</TableCell>
                              <TableCell>{s.expires_at ? formatDate(s.expires_at) : '—'}</TableCell>
                              <TableCell>
                                <span className={`font-semibold ${days !== null && days < 0 ? 'text-red-600' : 'text-orange-600'}`}>
                                  {days !== null && days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                                </span>
                              </TableCell>
                              <TableCell><StatusBadge expires_at={s.expires_at} /></TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── LICENCES TAB ── */}
        {tab === 'licences' && (
          <LicencesTab officers={officers} />
        )}

        {tab === 'classroom' && (
          <BobClassroomTutor skills={skills} />
        )}
      </div>

      {/* Dialog */}
      <SkillDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingSkill(null) }}
        editing={editingSkill}
        officers={officers}
        organizationId={organizationId}
        userId={user?.id ?? ''}
      />
    </AppLayout>
  )
}

type TutorQuestion = {
  question: string
  hints: string[]
  model_answer: string
  rubric: string[]
}

type TutorEvaluation = {
  correct: boolean
  score: number
  feedback: string
  coaching_steps: string[]
  next_prompt: string
}

type LearningImportSummary = {
  courses: string[]
  completedCount: number
  requiredCount: number
  recompletionCount: number
}

function extractJsonObject(text: string): Record<string, any> | null {
  const direct = String(text || '').trim()
  if (!direct) return null

  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenced?.[1] || direct

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function parseElmoLearningDump(rawText: string): LearningImportSummary {
  const lines = String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const courses: string[] = []
  let completedCount = 0
  let requiredCount = 0
  let recompletionCount = 0

  const ignore = new Set([
    'dashboard',
    'my team',
    'team members',
    'my learning',
    'courses',
    'sessions',
    'cancel',
    'incomplete',
    'completed',
    'report type: direct report',
  ])

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const lowered = line.toLowerCase()

    if (lowered === 'required') {
      requiredCount += 1
      continue
    }
    if (lowered === 'recompletion') {
      recompletionCount += 1
      continue
    }

    if (/^completed\s+\d{1,2}\s+[a-z]{3}\s+\d{4}$/i.test(line)) {
      completedCount += 1
      for (let j = i - 1; j >= 0; j -= 1) {
        const candidate = lines[j]
        const candidateLower = candidate.toLowerCase()
        if (
          !candidate ||
          /^completed\s+/i.test(candidate) ||
          candidateLower === 'required' ||
          candidateLower === 'recompletion' ||
          ignore.has(candidateLower) ||
          candidateLower.includes('users shown') ||
          candidateLower.startsWith('search by')
        ) {
          continue
        }
        courses.push(candidate)
        break
      }
    }
  }

  const uniqueCourses = Array.from(new Set(courses)).sort((a, b) => a.localeCompare(b))
  return {
    courses: uniqueCourses,
    completedCount,
    requiredCount,
    recompletionCount,
  }
}

const DEFAULT_NZ_NOISE_REFERENCE = [
  'Meaning of Excessive Noise',
  'Under Section 326 of RMA 1991, excessive noise is defined as:',
  '"any noise under human control and of such a nature as to unreasonably interfere with the peace, comfort and convenience of any person (other than a person in or at the place from which the noise is being emitted), but does not include any noise emitted by any"',
  '(a) Aircraft being operated during, or immediately before or after, flight; or',
  '(b) Vehicle being driven on a road (within the meaning of section 2(1) of the Land Transport Act 1998); or',
  '(c) Train, other than when being tested (when stationary), maintained, loaded, or unloaded.',
].join('\n')

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v || '').trim()).filter(Boolean)
}

function BobClassroomTutor({ skills }: { skills: OfficerSkill[] }) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const organizationId = user?.organization_id ?? ''
  const isManager = ['admin', 'admin_officer', 'master', 'grand_master'].includes(String(user?.role || ''))
  const skillNames = useMemo(() => {
    const unique = new Set(
      skills
        .map((s) => s.skill_name)
        .filter(Boolean)
        .map((s) => s.trim())
        .filter(Boolean),
    )
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [skills])

  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')
  const [traineeName, setTraineeName] = useState('')
  const [traineeUsername, setTraineeUsername] = useState('')
  const [traineeMobile, setTraineeMobile] = useState('')
  const [traineeEmail, setTraineeEmail] = useState('')
  const [traineePosition, setTraineePosition] = useState('')
  const [learningPaste, setLearningPaste] = useState('')
  const [trainingSourceText, setTrainingSourceText] = useState('')
  const [legalReferenceText, setLegalReferenceText] = useState(DEFAULT_NZ_NOISE_REFERENCE)
  const [trainingDraft, setTrainingDraft] = useState<TrainingModuleDraft | null>(null)
  const [referenceVerification, setReferenceVerification] = useState<ReferenceVerification | null>(null)
  const [selectedLibraryMaterialIds, setSelectedLibraryMaterialIds] = useState<string[]>([])
  const [autoAssignHoursAhead, setAutoAssignHoursAhead] = useState('72')
  const [autoAssignResults, setAutoAssignResults] = useState<AutoAssignResult[]>([])
  const [learningSummary, setLearningSummary] = useState<LearningImportSummary>({
    courses: [],
    completedCount: 0,
    requiredCount: 0,
    recompletionCount: 0,
  })
  const [question, setQuestion] = useState<TutorQuestion | null>(null)
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState<TutorEvaluation | null>(null)
  const [hintIndex, setHintIndex] = useState(0)
  const [loadingQuestion, setLoadingQuestion] = useState(false)
  const [loadingEvaluation, setLoadingEvaluation] = useState(false)
  const [loadingTrainingDraft, setLoadingTrainingDraft] = useState(false)
  const [loadingReferenceVerification, setLoadingReferenceVerification] = useState(false)
  const [savingToLibrary, setSavingToLibrary] = useState(false)
  const [runningAutoAssign, setRunningAutoAssign] = useState(false)
  const [moduleStatus, setModuleStatus] = useState<'draft' | 'legal_review' | 'approved'>('draft')
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false)
  const [completionTarget, setCompletionTarget] = useState<TrainingAssignmentRow | null>(null)
  const [completionScore, setCompletionScore] = useState('100')
  const [completionEvidence, setCompletionEvidence] = useState('')
  const [completionNotes, setCompletionNotes] = useState('')
  const [completionPassed, setCompletionPassed] = useState(true)
  const [recordingCompletion, setRecordingCompletion] = useState(false)
  const [auditStatusFilter, setAuditStatusFilter] = useState<'all' | 'assigned' | 'in_progress' | 'overdue' | 'completed' | 'cancelled'>('all')
  const [auditReminderType, setAuditReminderType] = useState<'in_app' | 'email' | 'sms' | 'escalation'>('in_app')
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null)
  const [runningBulkReminder, setRunningBulkReminder] = useState(false)

  useEffect(() => {
    const packet = consumeLatestTrainingComposerPacket()
    if (!packet) return

    if (packet.topic) setTopic(packet.topic)
    if (packet.sourceText) setTrainingSourceText(packet.sourceText)
    if (packet.legalReferenceText) setLegalReferenceText(packet.legalReferenceText)
    if (packet.trainingDraft) setTrainingDraft(packet.trainingDraft)
    if (packet.referenceVerification) setReferenceVerification(packet.referenceVerification)
    if (packet.audience && !traineePosition) setTraineePosition(packet.audience)

    toast.success('Bob Assistant handed a structured training module into Bob Classroom Tutor')
  }, [traineePosition])

  const { data: trainingLibrary = [] } = useQuery({
    queryKey: ['training_material_library', organizationId],
    queryFn: async (): Promise<TrainingLibraryItem[]> => listTrainingLibrary(organizationId),
    enabled: !!organizationId,
  })

  const { data: assignmentQueue = [] } = useQuery({
    queryKey: ['training_assignments_queue', organizationId],
    queryFn: async (): Promise<TrainingAssignmentRow[]> => listTrainingAssignmentQueue(organizationId),
    enabled: !!organizationId,
  })

  const { data: assignmentAudit = [] } = useQuery({
    queryKey: ['training_assignments_audit', organizationId],
    queryFn: async (): Promise<TrainingAssignmentAuditRow[]> => listTrainingAssignmentAudit(organizationId),
    enabled: !!organizationId && isManager,
  })

  useEffect(() => {
    if (!user) return

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    if (fullName && !traineeName) setTraineeName(fullName)
    if (user.email && !traineeEmail) setTraineeEmail(user.email)
    if (user.role && !traineePosition) setTraineePosition(String(user.role))
  }, [user, traineeEmail, traineeName, traineePosition])

  const traineeContext = [
    `name=${traineeName || 'unknown'}`,
    `username=${traineeUsername || 'unknown'}`,
    `mobile=${traineeMobile || 'unknown'}`,
    `email=${traineeEmail || 'unknown'}`,
    `position=${traineePosition || 'unknown'}`,
  ].join(' | ')

  const syllabusContext = learningSummary.courses.slice(0, 30).join(' | ')
  const selectedLibraryMaterials = trainingLibrary.filter((item) => selectedLibraryMaterialIds.includes(item.id))

  const selectedLibraryContext = selectedLibraryMaterials
    .map((item) => {
      const skillTagText = Array.isArray(item.skill_tags) && item.skill_tags.length
        ? item.skill_tags.join(', ')
        : 'none'
      return `title=${item.title}; topic=${item.topic || 'n/a'}; type=${item.content_type}; skill_tags=${skillTagText}; source=${String(item.source_text || '').slice(0, 600)}`
    })
    .join(' || ')

  const generateTrainingDraft = async () => {
    if (!topic.trim()) {
      toast.error('Choose a topic before generating training')
      return
    }
    if (!trainingSourceText.trim()) {
      toast.error('Paste source training material so Bob can build verified content')
      return
    }

    setLoadingTrainingDraft(true)
    setReferenceVerification(null)

    try {
      const prompt = [
        'You are Bob Training Architect for NZ security and enforcement operations.',
        `Generate a modern training module for topic: ${topic}.`,
        `Trainee profile context: ${traineeContext}.`,
        syllabusContext ? `Current learning syllabus context: ${syllabusContext}.` : 'No LMS syllabus provided.',
        selectedLibraryContext ? `Selected reusable material context for composition: ${selectedLibraryContext}.` : 'No reusable library materials selected.',
        'Training must be easy to follow and include picture, video, and interactive teaching steps.',
        'Training must include interactive assessment and automated tutor guidance for wrong answers.',
        'Verify legal references and best practices for New Zealand context.',
        `Use this NZ legal reference text as mandatory context:\n${legalReferenceText}`,
        `Use this source material as primary facts:\n${trainingSourceText}`,
        'Return strict JSON only with keys:',
        '{"title":string,"audience":string,"objectives":string[],"lesson_plan":[{"step":number,"title":string,"instruction":string,"media_type":"picture|video|interactive|mixed","media_prompt":string,"interactive_activity":string}],"assessments":[{"question":string,"answer_guide":string,"difficulty":"beginner|intermediate|advanced"}],"legal_references":[{"title":string,"section":string,"summary":string,"source":string,"verification_status":"verified|needs_review"}],"best_practices":string[],"fact_check_notes":string[]}',
      ].join(' ')

      const { data, error } = await edgeFunctions.aiChat({
        provider: 'auto',
        messages: [
          { role: 'system', content: 'You are a strict JSON generator for compliance-grade training modules.' },
          { role: 'user', content: prompt },
        ],
      })

      if (error || !data?.response) throw new Error(error || 'Bob returned no training draft content')

      const parsed = extractJsonObject(String(data.response || ''))
      if (!parsed?.title) throw new Error('Could not parse training module JSON')

      const nextDraft: TrainingModuleDraft = {
        title: String(parsed.title || ''),
        audience: String(parsed.audience || ''),
        objectives: asStringArray(parsed.objectives),
        lesson_plan: Array.isArray(parsed.lesson_plan)
          ? parsed.lesson_plan.map((item: any, idx: number) => ({
              step: Number(item?.step || idx + 1),
              title: String(item?.title || ''),
              instruction: String(item?.instruction || ''),
              media_type: ['picture', 'video', 'interactive', 'mixed'].includes(String(item?.media_type || ''))
                ? (String(item.media_type) as TrainingModuleDraft['lesson_plan'][number]['media_type'])
                : 'mixed',
              media_prompt: String(item?.media_prompt || ''),
              interactive_activity: String(item?.interactive_activity || ''),
            }))
          : [],
        assessments: Array.isArray(parsed.assessments)
          ? parsed.assessments.map((item: any) => ({
              question: String(item?.question || ''),
              answer_guide: String(item?.answer_guide || ''),
              difficulty: ['beginner', 'intermediate', 'advanced'].includes(String(item?.difficulty || ''))
                ? (String(item.difficulty) as TrainingModuleDraft['assessments'][number]['difficulty'])
                : 'beginner',
            }))
          : [],
        legal_references: Array.isArray(parsed.legal_references)
          ? parsed.legal_references.map((item: any) => ({
              title: String(item?.title || ''),
              section: String(item?.section || ''),
              summary: String(item?.summary || ''),
              source: String(item?.source || ''),
              verification_status: String(item?.verification_status || '') === 'verified' ? 'verified' : 'needs_review',
            }))
          : [],
        best_practices: asStringArray(parsed.best_practices),
        fact_check_notes: asStringArray(parsed.fact_check_notes),
      }

      setTrainingDraft(nextDraft)
      toast.success('Training draft generated from source materials')
    } catch (err: any) {
      toast.error(err?.message || 'Could not generate training draft')
    } finally {
      setLoadingTrainingDraft(false)
    }
  }

  const verifyReferences = async () => {
    if (!trainingDraft) {
      toast.error('Generate a training draft first')
      return
    }

    setLoadingReferenceVerification(true)
    try {
      const prompt = [
        'You are Bob Legal and Fact Checker for NZ security and enforcement training.',
        'Validate legal references and factual claims against provided source materials only.',
        'If uncertain, mark needs review and do not invent certainty.',
        `NZ legal reference text:\n${legalReferenceText}`,
        `Source material:\n${trainingSourceText}`,
        `Training draft legal references and facts:\n${JSON.stringify(trainingDraft, null, 2)}`,
        'Return strict JSON only with keys:',
        '{"verified":string[],"needs_review":string[],"legal_risks":string[],"recommendations":string[]}',
      ].join(' ')

      const { data, error } = await edgeFunctions.aiChat({
        provider: 'auto',
        messages: [
          { role: 'system', content: 'You are a strict JSON verifier for legal and factual quality.' },
          { role: 'user', content: prompt },
        ],
      })

      if (error || !data?.response) throw new Error(error || 'Bob returned no verification content')

      const parsed = extractJsonObject(String(data.response || ''))
      if (!parsed) throw new Error('Could not parse verification JSON')

      setReferenceVerification({
        verified: asStringArray(parsed.verified),
        needs_review: asStringArray(parsed.needs_review),
        legal_risks: asStringArray(parsed.legal_risks),
        recommendations: asStringArray(parsed.recommendations),
      })
      toast.success('Reference and fact verification completed')
    } catch (err: any) {
      toast.error(err?.message || 'Could not verify references')
    } finally {
      setLoadingReferenceVerification(false)
    }
  }

  const saveTrainingDraftToLibrary = async () => {
    if (!trainingDraft) {
      toast.error('Generate a training draft first')
      return
    }
    if (!organizationId) {
      toast.error('Missing organization context')
      return
    }

    setSavingToLibrary(true)
    try {
      const payload = {
        organization_id: organizationId,
        title: trainingDraft.title || `Training Module: ${topic || 'Untitled'}`,
        description: trainingDraft.objectives.slice(0, 3).join(' | ') || null,
        topic: topic || trainingDraft.title || 'general',
        content_type: 'composite',
        source_text: trainingSourceText || null,
        legal_references: legalReferenceText || null,
        skill_tags: Array.from(new Set([topic, ...(trainingDraft.best_practices || [])].filter(Boolean))),
        best_practices: trainingDraft.best_practices || [],
        generated_by_bob: true,
        status: moduleStatus,
        composed_from_material_ids: selectedLibraryMaterialIds,
        metadata: {
          training_draft: trainingDraft,
          reference_verification: referenceVerification,
          created_from_classroom_tutor: true,
          publication_state: moduleStatus,
        },
        created_by: user?.id || null,
      }

      await saveTrainingModuleToLibrary(payload)

      await queryClient.invalidateQueries({ queryKey: ['training_material_library', organizationId] })
      toast.success('Training saved to reusable library')
    } catch (err: any) {
      toast.error(err?.message || 'Could not save training to library')
    } finally {
      setSavingToLibrary(false)
    }
  }

  const runAutoAssignment = async () => {
    if (!organizationId) {
      toast.error('Missing organization context')
      return
    }

    const hoursAhead = Math.max(1, Number(autoAssignHoursAhead || '72'))
    setRunningAutoAssign(true)
    try {
      const rows = await runAutoAssignTraining({
        organizationId,
        hoursAhead,
        actorId: user?.id || null,
      })
      setAutoAssignResults(rows)
      await queryClient.invalidateQueries({ queryKey: ['training_assignments_queue', organizationId] })

      const created = rows.reduce((sum, row) => sum + Number(row.assignments_created || 0), 0)
      toast.success(`Auto-assignment completed. ${created} assignment(s) created.`)
    } catch (err: any) {
      toast.error(err?.message || 'Could not run auto-assignment')
    } finally {
      setRunningAutoAssign(false)
    }
  }

  const openCompletionDialog = (assignment: TrainingAssignmentRow) => {
    setCompletionTarget(assignment)
    setCompletionScore('100')
    setCompletionEvidence('')
    setCompletionNotes('')
    setCompletionPassed(true)
    setCompletionDialogOpen(true)
  }

  const sendReminder = async (
    assignment: Pick<TrainingAssignmentRow, 'id' | 'title' | 'due_at' | 'status'>,
    reminderType: 'in_app' | 'email' | 'sms' | 'escalation',
  ) => {
    if (!assignment?.id) return
    if (assignment.status === 'completed') {
      toast.message('This assignment is already completed')
      return
    }

    setSendingReminderId(assignment.id)
    try {
      const dueText = assignment.due_at
        ? ` by ${new Date(assignment.due_at).toLocaleString('en-NZ')}`
        : ''
      const message = reminderType === 'escalation'
        ? `Escalation: training assignment "${assignment.title}" is still pending${dueText}.`
        : `Reminder: please complete training assignment "${assignment.title}"${dueText}.`

      await sendTrainingAssignmentReminder({
        assignmentId: assignment.id,
        reminderType,
        message,
        actorId: user?.id || null,
      })

      await queryClient.invalidateQueries({ queryKey: ['training_assignments_queue', organizationId] })
      await queryClient.invalidateQueries({ queryKey: ['training_assignments_audit', organizationId] })

      toast.success(reminderType === 'escalation' ? 'Escalation reminder sent' : 'Reminder sent')
    } catch (err: any) {
      toast.error(err?.message || 'Could not send reminder')
    } finally {
      setSendingReminderId(null)
    }
  }

  const sendBulkReminders = async (params: {
    statuses: Array<'assigned' | 'in_progress' | 'overdue' | 'cancelled'>
    dueBefore?: string | null
    modeLabel: string
  }) => {
    if (!organizationId) {
      toast.error('Missing organization context')
      return
    }

    setRunningBulkReminder(true)
    try {
      const result: TrainingBulkReminderResult = await sendBulkTrainingAssignmentReminders({
        organizationId,
        statusFilter: params.statuses,
        dueBefore: params.dueBefore || null,
        reminderType: auditReminderType,
        actorId: user?.id || null,
      })

      await queryClient.invalidateQueries({ queryKey: ['training_assignments_queue', organizationId] })
      await queryClient.invalidateQueries({ queryKey: ['training_assignments_audit', organizationId] })

      toast.success(`${params.modeLabel}: ${result.reminders_created} reminder(s) queued/sent`)
    } catch (err: any) {
      toast.error(err?.message || 'Could not send bulk reminders')
    } finally {
      setRunningBulkReminder(false)
    }
  }

  const exportAuditCsv = () => {
    const rows = [
      [
        'Officer',
        'Assignment',
        'Type',
        'Status',
        'Due At',
        'Completed At',
        'Attempt Count',
        'Last Attempt Score',
        'Last Attempt Passed',
        'Last Attempt At',
        'Reminder Count',
        'Last Reminder At',
        'Last Reminder Delivery',
      ],
      ...filteredAuditRows.map((row) => [
        `${row.officer?.first_name || 'Officer'} ${row.officer?.last_name || ''}`.trim(),
        row.title,
        row.assignment_type,
        row.status,
        row.due_at ? new Date(row.due_at).toISOString() : '',
        row.completed_at ? new Date(row.completed_at).toISOString() : '',
        row.attempt_count,
        row.last_attempt_score ?? '',
        typeof row.last_attempt_passed === 'boolean' ? (row.last_attempt_passed ? 'pass' : 'fail') : '',
        row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : '',
        row.reminder_count,
        row.last_reminder_at ? new Date(row.last_reminder_at).toISOString() : '',
        row.last_reminder_delivery_status || '',
      ]),
    ]

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `training-completion-audit-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('Manager completion audit exported to CSV')
  }

  const filteredAuditRows = useMemo(() => {
    if (auditStatusFilter === 'all') return assignmentAudit
    return assignmentAudit.filter((row) => row.status === auditStatusFilter)
  }, [assignmentAudit, auditStatusFilter])

  const auditSummary = useMemo(() => {
    return assignmentAudit.reduce(
      (acc, row) => {
        if (row.status === 'completed') acc.completed += 1
        if (row.status === 'overdue') acc.overdue += 1
        if (row.status === 'assigned' || row.status === 'in_progress') acc.pending += 1
        return acc
      },
      { pending: 0, overdue: 0, completed: 0 },
    )
  }, [assignmentAudit])

  const reminderDeliverySummary = useMemo(() => {
    return assignmentAudit.reduce(
      (acc, row) => {
        acc.sent += Number(row.reminder_sent_count || 0)
        acc.failed += Number(row.reminder_failed_count || 0)
        acc.queued += Number(row.reminder_queued_count || 0)
        return acc
      },
      { sent: 0, failed: 0, queued: 0 },
    )
  }, [assignmentAudit])

  const submitCompletionAttempt = async () => {
    if (!completionTarget) return

    setRecordingCompletion(true)
    try {
      const score = Math.max(0, Math.min(100, Number(completionScore || '0')))
      const result = await recordTrainingCompletionAttempt({
        assignmentId: completionTarget.id,
        score,
        evidence: completionEvidence,
        notes: completionNotes,
        passed: completionPassed,
        actorId: user?.id || null,
      })

      await queryClient.invalidateQueries({ queryKey: ['training_assignments_queue', organizationId] })
      await queryClient.invalidateQueries({ queryKey: ['officer_skills', organizationId] })

      toast.success(
        result.competency_granted
          ? `Completion recorded and competency granted for ${result.skill_name || 'training'}`
          : `Completion recorded for ${completionTarget.title}`,
      )

      setCompletionDialogOpen(false)
      setCompletionTarget(null)
    } catch (err: any) {
      toast.error(err?.message || 'Could not record completion attempt')
    } finally {
      setRecordingCompletion(false)
    }
  }

  const generateQuestion = async () => {
    if (!topic.trim()) {
      toast.error('Choose or enter a training topic first')
      return
    }

    setLoadingQuestion(true)
    setEvaluation(null)
    setAnswer('')
    setHintIndex(0)

    try {
      const prompt = [
        'You are Bob Classroom Tutor for NZ security and enforcement operations training.',
        `Create one ${difficulty} assessment question on topic: ${topic}.`,
        `Trainee profile context: ${traineeContext}.`,
        syllabusContext ? `Current learning syllabus context: ${syllabusContext}.` : 'No LMS course list supplied yet.',
        'Return strict JSON only with keys:',
        '{"question": string, "hints": string[2-4], "model_answer": string, "rubric": string[3-6]}',
        'Use practical field language and include safety/compliance context where relevant.',
      ].join(' ')

      const { data, error } = await edgeFunctions.aiChat({
        provider: 'auto',
        messages: [
          { role: 'system', content: 'You are a strict JSON generator for training content.' },
          { role: 'user', content: prompt },
        ],
      })

      if (error || !data?.response) throw new Error(error || 'Bob returned no question content')

      const parsed = extractJsonObject(String(data.response || ''))
      if (!parsed?.question) throw new Error('Could not parse Bob tutor question JSON')

      setQuestion({
        question: String(parsed.question || ''),
        hints: Array.isArray(parsed.hints) ? parsed.hints.map((h: any) => String(h)) : [],
        model_answer: String(parsed.model_answer || ''),
        rubric: Array.isArray(parsed.rubric) ? parsed.rubric.map((r: any) => String(r)) : [],
      })
      toast.success('Bob generated a classroom question')
    } catch (err: any) {
      toast.error(err?.message || 'Could not generate training question')
    } finally {
      setLoadingQuestion(false)
    }
  }

  const submitAnswer = async () => {
    if (!question) {
      toast.error('Generate a question first')
      return
    }
    if (!answer.trim()) {
      toast.error('Enter your answer before submitting')
      return
    }

    setLoadingEvaluation(true)
    try {
      const prompt = [
        'You are Bob Classroom Tutor. Grade the trainee answer.',
        'Return strict JSON only with keys:',
        '{"correct": boolean, "score": number, "feedback": string, "coaching_steps": string[2-5], "next_prompt": string}',
        `Trainee profile context: ${traineeContext}.`,
        syllabusContext ? `Current learning syllabus context: ${syllabusContext}.` : 'No LMS course list supplied yet.',
        `Question: ${question.question}`,
        `Rubric: ${(question.rubric || []).join(' | ')}`,
        `Model answer: ${question.model_answer}`,
        `Trainee answer: ${answer}`,
        'If wrong, explain gently and coach toward the correct reasoning without shaming.',
      ].join(' ')

      const { data, error } = await edgeFunctions.aiChat({
        provider: 'auto',
        messages: [
          { role: 'system', content: 'You are a strict JSON evaluator for training assessments.' },
          { role: 'user', content: prompt },
        ],
      })

      if (error || !data?.response) throw new Error(error || 'Bob returned no evaluation content')

      const parsed = extractJsonObject(String(data.response || ''))
      if (!parsed || typeof parsed.correct !== 'boolean') {
        throw new Error('Could not parse Bob tutor evaluation JSON')
      }

      const next: TutorEvaluation = {
        correct: Boolean(parsed.correct),
        score: Math.max(0, Math.min(100, Number(parsed.score || 0))),
        feedback: String(parsed.feedback || ''),
        coaching_steps: Array.isArray(parsed.coaching_steps) ? parsed.coaching_steps.map((s: any) => String(s)) : [],
        next_prompt: String(parsed.next_prompt || ''),
      }

      setEvaluation(next)
      if (next.correct) {
        toast.success('Correct answer. Great work.')
      } else {
        toast.message('Not quite right. Bob has provided tutoring guidance.')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not evaluate answer')
    } finally {
      setLoadingEvaluation(false)
    }
  }

  const showNextHint = () => {
    if (!question?.hints?.length) return
    setHintIndex((prev) => Math.min(prev + 1, question.hints.length))
  }

  const importLearningHistory = () => {
    const summary = parseElmoLearningDump(learningPaste)
    setLearningSummary(summary)

    if (!summary.courses.length) {
      toast.error('No course history detected from pasted learning text')
      return
    }

    if (!topic.trim()) {
      setTopic(summary.courses[0])
    }

    toast.success(`Imported ${summary.courses.length} courses into Bob classroom syllabus`)
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600" />
            Bob Classroom Tutor
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Interactive training: Bob asks a question, grades your answer, and tutors you when you get it wrong.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Import Learning History (ELMO-style paste)</Label>
            <Textarea
              value={learningPaste}
              onChange={(e) => setLearningPaste(e.target.value)}
              rows={6}
              placeholder="Paste your LMS learning history here so Bob can tutor by real course context..."
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={importLearningHistory}>
                Import Learning History
              </Button>
              {learningSummary.courses.length > 0 && (
                <Badge variant="outline">Courses imported: {learningSummary.courses.length}</Badge>
              )}
              {learningSummary.completedCount > 0 && (
                <Badge variant="outline">Completed: {learningSummary.completedCount}</Badge>
              )}
              {learningSummary.requiredCount > 0 && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200">Required flags: {learningSummary.requiredCount}</Badge>
              )}
              {learningSummary.recompletionCount > 0 && (
                <Badge className="bg-orange-100 text-orange-800 border-orange-200">Recompletion flags: {learningSummary.recompletionCount}</Badge>
              )}
            </div>
            {learningSummary.courses.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {learningSummary.courses.slice(0, 16).map((course) => (
                  <Button
                    key={course}
                    variant="secondary"
                    size="sm"
                    onClick={() => setTopic(course)}
                    className="h-auto py-1"
                  >
                    {course}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Source Training Materials (drop in notes, SOPs, policy text)</Label>
            <Textarea
              value={trainingSourceText}
              onChange={(e) => setTrainingSourceText(e.target.value)}
              rows={8}
              placeholder="Paste operational instructions, site directions, client policies, and evidence handling guidance here..."
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">NZ Legal Reference Context</Label>
            <Textarea
              value={legalReferenceText}
              onChange={(e) => setLegalReferenceText(e.target.value)}
              rows={7}
              placeholder="Paste NZ legal wording and references used for training compliance checks..."
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Classroom Trainee Profile</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={traineeName} onChange={(e) => setTraineeName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-1">
                <Label>Username</Label>
                <Input value={traineeUsername} onChange={(e) => setTraineeUsername(e.target.value)} placeholder="Staff username or ID" />
              </div>
              <div className="space-y-1">
                <Label>Mobile</Label>
                <Input value={traineeMobile} onChange={(e) => setTraineeMobile(e.target.value)} placeholder="Mobile number" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={traineeEmail} onChange={(e) => setTraineeEmail(e.target.value)} placeholder="Email" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Position</Label>
                <Input value={traineePosition} onChange={(e) => setTraineePosition(e.target.value)} placeholder="Position, unit, or specialty" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label>Training Topic</Label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Noise control escalation, briefing video SOP, site induction"
                list="bob-tutor-topic-suggestions"
              />
              <datalist id="bob-tutor-topic-suggestions">
                {skillNames.slice(0, 40).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as typeof difficulty)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={generateQuestion} disabled={loadingQuestion}>
              <Sparkles className="h-4 w-4 mr-1" />
              {loadingQuestion ? 'Generating…' : 'Generate Question'}
            </Button>
            <Button variant="secondary" onClick={generateTrainingDraft} disabled={loadingTrainingDraft}>
              {loadingTrainingDraft ? 'Building Training…' : 'Generate Full Training Module'}
            </Button>
            <Button variant="outline" onClick={verifyReferences} disabled={loadingReferenceVerification || !trainingDraft}>
              {loadingReferenceVerification ? 'Verifying…' : 'Verify Facts and Legal References'}
            </Button>
            <Button variant="outline" onClick={saveTrainingDraftToLibrary} disabled={savingToLibrary || !trainingDraft}>
              {savingToLibrary ? 'Saving…' : 'Save Module to Library'}
            </Button>
            <Select value={moduleStatus} onValueChange={(value) => setModuleStatus(value as typeof moduleStatus)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Publication state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="legal_review">Legal Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
            {question && (
              <Button variant="outline" onClick={() => {
                setQuestion(null)
                setEvaluation(null)
                setAnswer('')
                setHintIndex(0)
              }}>
                Reset Session
              </Button>
            )}
          </div>

          {trainingDraft && (
            <div className="space-y-3 border rounded-md p-3 bg-slate-50/60">
              <div>
                <p className="text-sm font-semibold">Training Draft: {trainingDraft.title}</p>
                <p className="text-xs text-muted-foreground">Audience: {trainingDraft.audience || 'Not specified'}</p>
              </div>

              {trainingDraft.objectives.length > 0 && (
                <div>
                  <Label>Objectives</Label>
                  {trainingDraft.objectives.map((objective, idx) => (
                    <p key={`${objective}-${idx}`} className="text-sm text-muted-foreground">{idx + 1}. {objective}</p>
                  ))}
                </div>
              )}

              {trainingDraft.lesson_plan.length > 0 && (
                <div>
                  <Label>Lesson Plan (Picture, Video, Interactive)</Label>
                  {trainingDraft.lesson_plan.map((step) => (
                    <div key={`${step.step}-${step.title}`} className="mt-2 p-2 border rounded bg-white">
                      <p className="text-sm font-medium">Step {step.step}: {step.title}</p>
                      <p className="text-sm text-muted-foreground">{step.instruction}</p>
                      <p className="text-xs mt-1">Media: {step.media_type} | Media prompt: {step.media_prompt}</p>
                      <p className="text-xs text-muted-foreground">Interactive activity: {step.interactive_activity}</p>
                    </div>
                  ))}
                </div>
              )}

              {trainingDraft.assessments.length > 0 && (
                <div>
                  <Label>Assessment Questions</Label>
                  {trainingDraft.assessments.map((item, idx) => (
                    <div key={`${item.question}-${idx}`} className="mt-2 p-2 border rounded bg-white">
                      <p className="text-sm font-medium">Q{idx + 1}. {item.question}</p>
                      <p className="text-xs">Difficulty: {item.difficulty}</p>
                      <p className="text-xs text-muted-foreground">Guide: {item.answer_guide}</p>
                    </div>
                  ))}
                </div>
              )}

              {trainingDraft.legal_references.length > 0 && (
                <div>
                  <Label>Legal References</Label>
                  {trainingDraft.legal_references.map((ref, idx) => (
                    <div key={`${ref.title}-${idx}`} className="mt-2 p-2 border rounded bg-white">
                      <p className="text-sm font-medium">{ref.title} ({ref.section})</p>
                      <p className="text-xs text-muted-foreground">{ref.summary}</p>
                      <p className="text-xs">Source: {ref.source}</p>
                      <Badge className={ref.verification_status === 'verified' ? 'bg-green-100 text-green-800 border-green-200 mt-1' : 'bg-amber-100 text-amber-800 border-amber-200 mt-1'}>
                        {ref.verification_status === 'verified' ? 'Verified' : 'Needs Review'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              {trainingDraft.best_practices.length > 0 && (
                <div>
                  <Label>Best Practices</Label>
                  {trainingDraft.best_practices.map((item, idx) => (
                    <p key={`${item}-${idx}`} className="text-sm text-muted-foreground">{idx + 1}. {item}</p>
                  ))}
                </div>
              )}

              {trainingDraft.fact_check_notes.length > 0 && (
                <div>
                  <Label>Fact-check Notes</Label>
                  {trainingDraft.fact_check_notes.map((item, idx) => (
                    <p key={`${item}-${idx}`} className="text-sm text-muted-foreground">{idx + 1}. {item}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2 border rounded-md p-3 bg-white">
            <p className="text-sm font-semibold">Reusable Training Library</p>
            <p className="text-xs text-muted-foreground">
              Select reusable materials below and Bob will compose targeted training by reusing relevant pieces.
            </p>
            {trainingLibrary.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No library materials found yet. Save a generated module first.
              </p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {trainingLibrary.map((item) => {
                  const checked = selectedLibraryMaterialIds.includes(item.id)
                  return (
                    <label key={item.id} className="flex items-start gap-2 p-2 border rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedLibraryMaterialIds((prev) => {
                            if (e.target.checked) return [...prev, item.id]
                            return prev.filter((id) => id !== item.id)
                          })
                        }}
                      />
                      <div>
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Topic: {item.topic || 'n/a'} | Type: {item.content_type}
                        </p>
                        <Badge variant="outline" className="mt-1">
                          {item.status || 'draft'}
                        </Badge>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-2 border rounded-md p-3 bg-slate-50/50">
            <p className="text-sm font-semibold">Auto-Assign Training From Upcoming Shifts</p>
            <p className="text-xs text-muted-foreground">
              Bob checks upcoming roster shifts, required skills, and site induction gaps, then assigns training before shift due time.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Label>Hours ahead</Label>
              <Input
                value={autoAssignHoursAhead}
                onChange={(e) => setAutoAssignHoursAhead(e.target.value)}
                className="w-28"
                inputMode="numeric"
              />
              <Button variant="secondary" onClick={runAutoAssignment} disabled={runningAutoAssign}>
                {runningAutoAssign ? 'Assigning…' : 'Run Bob Auto-Assignment'}
              </Button>
            </div>

            {autoAssignResults.length > 0 && (
              <div className="space-y-1">
                {autoAssignResults.map((row) => (
                  <p key={`${row.shift_id}-${row.officer_id}`} className="text-sm text-muted-foreground">
                    Shift {row.shift_id.slice(0, 8)}: created {row.assignments_created} assignment(s)
                    {Array.isArray(row.missing_skills) && row.missing_skills.length > 0 ? ` | missing skills: ${row.missing_skills.join(', ')}` : ''}
                    {row.site_induction_assigned ? ' | site induction assigned' : ''}
                  </p>
                ))}
              </div>
            )}

            <div>
              <Label>Current Assignment Queue</Label>
              {assignmentQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active training assignments.</p>
              ) : (
                <div className="space-y-1 mt-1 max-h-48 overflow-y-auto">
                  {assignmentQueue.map((assignment) => (
                    <div key={assignment.id} className="rounded border bg-white p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          {assignment.officer?.first_name || 'Officer'} {assignment.officer?.last_name || ''}: {assignment.title}
                        </span>
                        <Badge variant="outline">{assignment.status}</Badge>
                        {assignment.required_skill && <Badge variant="secondary">Skill: {assignment.required_skill}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {assignment.due_at ? `Due: ${new Date(assignment.due_at).toLocaleString('en-NZ')}` : 'No due date set'}
                        {assignment.completed_at ? ` | Completed: ${new Date(assignment.completed_at).toLocaleString('en-NZ')}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button size="sm" variant="secondary" onClick={() => openCompletionDialog(assignment)}>
                          Record Completion
                        </Button>
                        {isManager && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendReminder(assignment, 'in_app')}
                            disabled={sendingReminderId === assignment.id || assignment.status === 'completed'}
                          >
                            {sendingReminderId === assignment.id ? 'Sending…' : 'Send Reminder'}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isManager && (
            <div className="space-y-3 border rounded-md p-3 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label>Manager Completion Audit</Label>
                  <p className="text-xs text-muted-foreground">
                    Review assignment lifecycle, completion evidence, and reminder history.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Pending: {auditSummary.pending}</Badge>
                  <Badge className="bg-orange-100 text-orange-800 border-orange-200">Overdue: {auditSummary.overdue}</Badge>
                  <Badge className="bg-green-100 text-green-800 border-green-200">Completed: {auditSummary.completed}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded border bg-green-50/60 p-2">
                  <p className="text-xs text-muted-foreground">Reminders Sent</p>
                  <p className="text-base font-semibold text-green-700">{reminderDeliverySummary.sent}</p>
                </div>
                <div className="rounded border bg-amber-50/60 p-2">
                  <p className="text-xs text-muted-foreground">Reminders Queued</p>
                  <p className="text-base font-semibold text-amber-700">{reminderDeliverySummary.queued}</p>
                </div>
                <div className="rounded border bg-red-50/60 p-2">
                  <p className="text-xs text-muted-foreground">Reminders Failed</p>
                  <p className="text-base font-semibold text-red-700">{reminderDeliverySummary.failed}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Filter</Label>
                <Select value={auditStatusFilter} onValueChange={(value) => setAuditStatusFilter(value as typeof auditStatusFilter)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={auditReminderType} onValueChange={(value) => setAuditReminderType(value as typeof auditReminderType)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_app">In-app</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="escalation">Escalation</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sendBulkReminders({ statuses: ['overdue'], modeLabel: 'Bulk overdue reminders' })}
                  disabled={runningBulkReminder}
                >
                  {runningBulkReminder ? 'Sending…' : 'Remind All Overdue'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sendBulkReminders({
                    statuses: ['assigned', 'in_progress', 'overdue'],
                    dueBefore: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                    modeLabel: 'Due in 24h reminders',
                  })}
                  disabled={runningBulkReminder}
                >
                  {runningBulkReminder ? 'Sending…' : 'Remind Due <24h'}
                </Button>
                <Button size="sm" variant="outline" onClick={exportAuditCsv}>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Export Audit CSV
                </Button>
              </div>

              {filteredAuditRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assignments found for the selected filter.</p>
              ) : (
                <div className="max-h-80 overflow-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Officer</TableHead>
                        <TableHead>Assignment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Due / Completed</TableHead>
                        <TableHead>Completion Audit</TableHead>
                        <TableHead>Reminders</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAuditRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            {(row.officer?.first_name || 'Officer')} {(row.officer?.last_name || '')}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{row.title}</p>
                              {row.required_skill && (
                                <Badge variant="secondary">Skill: {row.required_skill}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{row.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-muted-foreground">
                              {row.due_at ? `Due ${new Date(row.due_at).toLocaleString('en-NZ')}` : 'No due date'}
                            </p>
                            {row.completed_at && (
                              <p className="text-xs text-muted-foreground">
                                Completed {new Date(row.completed_at).toLocaleString('en-NZ')}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-muted-foreground">Attempts: {row.attempt_count}</p>
                            {row.last_attempt_at ? (
                              <p className="text-xs text-muted-foreground">
                                Last: {row.last_attempt_score ?? '-'} ({row.last_attempt_passed ? 'pass' : 'fail'})
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">No attempts yet</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-muted-foreground">Sent: {row.reminder_count}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.last_reminder_at
                                ? `Last ${new Date(row.last_reminder_at).toLocaleString('en-NZ')}`
                                : 'No reminders'}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="secondary" onClick={() => openCompletionDialog(row)}>
                                Record
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => sendReminder(row, auditReminderType)}
                                disabled={sendingReminderId === row.id || row.status === 'completed'}
                              >
                                <BellRing className="h-3.5 w-3.5 mr-1" />
                                Remind
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => sendReminder(row, 'escalation')}
                                disabled={sendingReminderId === row.id || row.status === 'completed'}
                              >
                                Escalate
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          <Dialog open={completionDialogOpen} onOpenChange={setCompletionDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Training Completion</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Assignment</Label>
                  <p className="text-sm text-muted-foreground">
                    {completionTarget?.title || 'No assignment selected'}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Score</Label>
                    <Input value={completionScore} onChange={(e) => setCompletionScore(e.target.value)} inputMode="numeric" />
                  </div>
                  <div className="space-y-1">
                    <Label>Outcome</Label>
                    <Select value={completionPassed ? 'passed' : 'failed'} onValueChange={(value) => setCompletionPassed(value === 'passed')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="passed">Passed</SelectItem>
                        <SelectItem value="failed">Failed / Needs Coaching</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Evidence</Label>
                  <Textarea
                    rows={3}
                    value={completionEvidence}
                    onChange={(e) => setCompletionEvidence(e.target.value)}
                    placeholder="Optional evidence, notes, or link to supporting material..."
                  />
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Textarea
                    rows={3}
                    value={completionNotes}
                    onChange={(e) => setCompletionNotes(e.target.value)}
                    placeholder="Optional assessor notes or coaching guidance..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCompletionDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={submitCompletionAttempt} disabled={recordingCompletion || !completionTarget}>
                  {recordingCompletion ? 'Recording…' : 'Save Completion'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {referenceVerification && (
            <div className="space-y-2 border rounded-md p-3 bg-white">
              <p className="text-sm font-semibold">Verification Report</p>
              {referenceVerification.verified.length > 0 && (
                <div>
                  <Label>Verified</Label>
                  {referenceVerification.verified.map((item, idx) => (
                    <p key={`${item}-${idx}`} className="text-sm text-green-700">{idx + 1}. {item}</p>
                  ))}
                </div>
              )}
              {referenceVerification.needs_review.length > 0 && (
                <div>
                  <Label>Needs Review</Label>
                  {referenceVerification.needs_review.map((item, idx) => (
                    <p key={`${item}-${idx}`} className="text-sm text-amber-700">{idx + 1}. {item}</p>
                  ))}
                </div>
              )}
              {referenceVerification.legal_risks.length > 0 && (
                <div>
                  <Label>Legal Risks</Label>
                  {referenceVerification.legal_risks.map((item, idx) => (
                    <p key={`${item}-${idx}`} className="text-sm text-red-700">{idx + 1}. {item}</p>
                  ))}
                </div>
              )}
              {referenceVerification.recommendations.length > 0 && (
                <div>
                  <Label>Recommendations</Label>
                  {referenceVerification.recommendations.map((item, idx) => (
                    <p key={`${item}-${idx}`} className="text-sm text-muted-foreground">{idx + 1}. {item}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {question && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Classroom Question</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-md border bg-blue-50/60">
              <p className="text-sm font-medium">{question.question}</p>
            </div>

            {question.hints.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Hints</Label>
                  <Button variant="outline" size="sm" onClick={showNextHint} disabled={hintIndex >= question.hints.length}>
                    Show Hint
                  </Button>
                </div>
                <div className="space-y-1">
                  {question.hints.slice(0, hintIndex).map((hint, idx) => (
                    <p key={`${hint}-${idx}`} className="text-sm text-muted-foreground">Hint {idx + 1}: {hint}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label>Your Answer</Label>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={6}
                placeholder="Write your answer as if reporting or acting in the field..."
              />
            </div>

            <Button onClick={submitAnswer} disabled={loadingEvaluation}>
              {loadingEvaluation ? 'Bob is grading…' : 'Submit Answer'}
            </Button>
          </CardContent>
        </Card>
      )}

      {evaluation && (
        <Card className={evaluation.correct ? 'border-green-300 bg-green-50/30' : 'border-amber-300 bg-amber-50/30'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {evaluation.correct ? <CheckCircle className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
              Bob Tutor Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className={evaluation.correct ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'}>
                {evaluation.correct ? 'Correct' : 'Needs Coaching'}
              </Badge>
              <Badge variant="outline">Score: {evaluation.score}%</Badge>
            </div>

            <p className="text-sm">{evaluation.feedback}</p>

            {!evaluation.correct && evaluation.coaching_steps.length > 0 && (
              <div className="space-y-1">
                <Label>Coaching Steps</Label>
                {evaluation.coaching_steps.map((step, idx) => (
                  <p key={`${step}-${idx}`} className="text-sm text-muted-foreground">{idx + 1}. {step}</p>
                ))}
              </div>
            )}

            {evaluation.next_prompt && (
              <div className="p-3 rounded-md border bg-white/70">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Bob follow-up prompt</p>
                <p className="text-sm mt-1">{evaluation.next_prompt}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Licences Tab ─────────────────────────────────────────────────────────────

function LicencesTab({ officers }: { officers: OfficerProfile[] }) {
  const [search, setSearch] = useState('')

  const filtered = officers.filter((o) => {
    const name = `${o.first_name} ${o.last_name} ${o.email}`.toLowerCase()
    return !search || name.includes(search.toLowerCase())
  })

  function licenceStatus(expiry: string | null): 'valid' | 'expiring' | 'expired' | 'none' {
    if (!expiry) return 'none'
    const days = daysUntil(expiry)
    if (days < 0) return 'expired'
    if (days <= EXPIRING_SOON_DAYS) return 'expiring'
    return 'valid'
  }

  function LicenceBadge({ expiry }: { expiry: string | null }) {
    const status = licenceStatus(expiry)
    if (status === 'none') return <Badge variant="secondary">Not Set</Badge>
    if (status === 'valid') return <Badge className="bg-green-100 text-green-800 border-green-200">Valid</Badge>
    if (status === 'expiring') return <Badge className="bg-orange-100 text-orange-800 border-orange-200">Expiring</Badge>
    return <Badge className="bg-red-100 text-red-800 border-red-200">Expired</Badge>
  }

  const stats = useMemo(() => {
    const coaExpiringSoon = officers.filter((o) => licenceStatus(o.coa_expiry) === 'expiring').length
    const coaExpired = officers.filter((o) => licenceStatus(o.coa_expiry) === 'expired').length
    const warrantExpiringSoon = officers.filter((o) => licenceStatus(o.warrant_expiry) === 'expiring').length
    const warrantExpired = officers.filter((o) => licenceStatus(o.warrant_expiry) === 'expired').length
    const credentialsVerified = officers.filter((o) => o.credentials_verified).length
    return { coaExpiringSoon, coaExpired, warrantExpiringSoon, warrantExpired, credentialsVerified }
  }, [officers])

  return (
    <div className="space-y-5">
      {/* Licence Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xl font-bold">{officers.length}</p>
            <p className="text-xs text-muted-foreground">Total Officers</p>
          </CardContent>
        </Card>
        <Card className={stats.coaExpiringSoon > 0 ? 'border-orange-300' : ''}>
          <CardContent className="pt-4 pb-3">
            <p className={`text-xl font-bold ${stats.coaExpiringSoon > 0 ? 'text-orange-600' : ''}`}>
              {stats.coaExpiringSoon}
            </p>
            <p className="text-xs text-muted-foreground">CoA Expiring</p>
          </CardContent>
        </Card>
        <Card className={stats.coaExpired > 0 ? 'border-red-300' : ''}>
          <CardContent className="pt-4 pb-3">
            <p className={`text-xl font-bold ${stats.coaExpired > 0 ? 'text-red-600' : ''}`}>
              {stats.coaExpired}
            </p>
            <p className="text-xs text-muted-foreground">CoA Expired</p>
          </CardContent>
        </Card>
        <Card className={stats.warrantExpiringSoon > 0 ? 'border-orange-300' : ''}>
          <CardContent className="pt-4 pb-3">
            <p className={`text-xl font-bold ${stats.warrantExpiringSoon > 0 ? 'text-orange-600' : ''}`}>
              {stats.warrantExpiringSoon}
            </p>
            <p className="text-xs text-muted-foreground">Warrant Expiring</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xl font-bold text-green-600">{stats.credentialsVerified}</p>
            <p className="text-xs text-muted-foreground">Creds Verified</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <Input
          placeholder="Search officer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Licences Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            NZ Security Licences — CoA & Warrant
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Officer</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>CoA Number</TableHead>
                  <TableHead>CoA Expiry</TableHead>
                  <TableHead>CoA Status</TableHead>
                  <TableHead>Warrant Number</TableHead>
                  <TableHead>Warrant Expiry</TableHead>
                  <TableHead>Warrant Status</TableHead>
                  <TableHead>Creds</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No officers found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {o.first_name} {o.last_name}
                        <div className="text-xs text-muted-foreground capitalize">{o.role}</div>
                      </TableCell>
                      <TableCell className="text-sm">{o.email}</TableCell>
                      <TableCell className="text-sm font-mono">
                        {o.coa_number ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.coa_expiry ? formatDate(o.coa_expiry) : '—'}
                      </TableCell>
                      <TableCell><LicenceBadge expiry={o.coa_expiry} /></TableCell>
                      <TableCell className="text-sm font-mono">
                        {o.warrant_number ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.warrant_expiry ? formatDate(o.warrant_expiry) : '—'}
                      </TableCell>
                      <TableCell><LicenceBadge expiry={o.warrant_expiry} /></TableCell>
                      <TableCell>
                        {o.credentials_verified ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle className="h-4 w-4" /> Yes
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Expiry Alerts for Licences */}
      {(stats.coaExpiringSoon + stats.coaExpired + stats.warrantExpiringSoon + stats.warrantExpired) > 0 && (
        <Card className="border-orange-200 bg-orange-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-orange-700">
              <AlertTriangle className="h-5 w-5" />
              Licence Expiry Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Officer</TableHead>
                    <TableHead>Licence Type</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {officers.flatMap((o) => {
                    const rows = []
                    const coaDays = daysUntil(o.coa_expiry)
                    if (o.coa_expiry && coaDays !== null && coaDays <= ALERT_DAYS) {
                      rows.push(
                        <TableRow key={`${o.id}-coa`} className={coaDays < 0 ? 'bg-red-50' : 'bg-orange-50/50'}>
                          <TableCell className="font-medium">{o.first_name} {o.last_name}</TableCell>
                          <TableCell><Badge variant="outline">Certificate of Authority</Badge></TableCell>
                          <TableCell className="font-mono text-sm">{o.coa_number ?? '—'}</TableCell>
                          <TableCell>{formatDate(o.coa_expiry)}</TableCell>
                          <TableCell>
                            <span className={`font-semibold ${coaDays < 0 ? 'text-red-600' : 'text-orange-600'}`}>
                              {coaDays < 0 ? `${Math.abs(coaDays)}d ago` : `${coaDays}d`}
                            </span>
                          </TableCell>
                          <TableCell><LicenceBadge expiry={o.coa_expiry} /></TableCell>
                        </TableRow>
                      )
                    }
                    const wDays = daysUntil(o.warrant_expiry)
                    if (o.warrant_expiry && wDays !== null && wDays <= ALERT_DAYS) {
                      rows.push(
                        <TableRow key={`${o.id}-warrant`} className={wDays < 0 ? 'bg-red-50' : 'bg-orange-50/50'}>
                          <TableCell className="font-medium">{o.first_name} {o.last_name}</TableCell>
                          <TableCell><Badge variant="outline">Warrant</Badge></TableCell>
                          <TableCell className="font-mono text-sm">{o.warrant_number ?? '—'}</TableCell>
                          <TableCell>{formatDate(o.warrant_expiry)}</TableCell>
                          <TableCell>
                            <span className={`font-semibold ${wDays < 0 ? 'text-red-600' : 'text-orange-600'}`}>
                              {wDays < 0 ? `${Math.abs(wDays)}d ago` : `${wDays}d`}
                            </span>
                          </TableCell>
                          <TableCell><LicenceBadge expiry={o.warrant_expiry} /></TableCell>
                        </TableRow>
                      )
                    }
                    return rows
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
