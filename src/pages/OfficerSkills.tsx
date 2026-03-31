import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const organizationId: string = user?.organization_id ?? ''
  const isAdmin = user?.role === 'admin' || user?.role === 'master'

  const [tab, setTab] = useState<'skills' | 'licences'>('skills')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showExpiring, setShowExpiring] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<OfficerSkill | null>(null)

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
