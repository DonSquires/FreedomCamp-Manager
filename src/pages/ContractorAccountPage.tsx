/**
 * ContractorAccountPage – Zoho-style CRM Account detail for a contractor org.
 *
 * Sections (collapsible, Zoho-style):
 *   1. Account Information  – contact person, accounts/invoicing contact
 *   2. Rate Card            – guard, travel, standby, short-notice, long-term
 *   3. Compliance Documents – service agreement, insurance, H&S, other
 *   4. Recent Shifts        – roster shifts assigned to this contractor's staff
 *
 * Access:
 *   • Service provider admins / master / grand_master: full edit
 *   • Contractor's own admin users: can edit contact info + upload documents
 */

import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useClientOrgIds } from '@/hooks/useClientOrgIds'
import { uploadFile } from '@/lib/fileUpload'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Building2, Phone, Mail, ChevronDown, ChevronUp, Edit2,
  Save, X, Upload, FileText, CheckCircle2, AlertTriangle,
  Clock, DollarSign, Users, ArrowLeft, Shield, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContractorProfile {
  id: string
  organization_id: string
  contact_name: string | null
  contact_role: string | null
  contact_phone: string | null
  contact_email: string | null
  accounts_name: string | null
  accounts_email: string | null
  accounts_phone: string | null
  guard_rate_per_hour: number | null
  travel_rate_per_km: number | null
  standby_rate_per_hour: number | null
  short_notice_rate_per_hour: number | null
  long_term_rate_per_hour: number | null
  long_term_definition: string | null
  long_term_min_days: number | null
  service_agreement_signed: boolean
  service_agreement_expiry: string | null
  insurance_verified: boolean
  insurance_expiry: string | null
  hs_policy_verified: boolean
  hs_policy_expiry: string | null
  notes: string | null
}

interface ContractorDocument {
  id: string
  organization_id: string
  document_type: string
  document_name: string
  document_url: string
  expiry_date: string | null
  is_current: boolean
  notes: string | null
  uploaded_by: string | null
  created_at: string
  uploader: { first_name: string; last_name: string } | null
}

interface RecentShift {
  id: string
  shift_date: string
  shift_type: string
  start_time: string | null
  end_time: string | null
  status: string
  guard_cost_rate: number | null
  client_charge_rate: number | null
  officer: { first_name: string; last_name: string } | null
  site: { name: string } | null
}

const DOC_TYPE_LABELS: Record<string, string> = {
  service_agreement: 'Service Agreement',
  insurance:         'Insurance Certificate',
  hs_policy:         'Health & Safety Policy',
  compliance:        'Compliance Document',
  other:             'Other',
}

const DOC_TYPE_ICONS: Record<string, React.ElementType> = {
  service_agreement: FileText,
  insurance:         Shield,
  hs_policy:         CheckCircle2,
  compliance:        CheckCircle2,
  other:             FileText,
}

// ─── Section wrapper (Zoho-style collapsible panel) ──────────────────────────

function Section({
  title, icon: Icon, defaultOpen = true,
  action, children,
}: {
  title: string
  icon: React.ElementType
  defaultOpen?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2 font-semibold text-sm text-gray-700">
          <Icon className="h-4 w-4" />
          {title}
        </div>
        <div className="flex items-center gap-2">
          {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
          {open
            ? <ChevronUp className="h-4 w-4 text-gray-400" />
            : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

// ─── Rate field ───────────────────────────────────────────────────────────────

function RateField({
  label, value, editing, name,
  onChange, prefix = '$', suffix = '/hr',
}: {
  label: string; value: number | null; editing: boolean; name: string
  onChange: (name: string, val: string) => void
  prefix?: string; suffix?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-gray-500">{label}</p>
      {editing ? (
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-400">{prefix}</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            className="h-8 text-sm w-24"
            value={value ?? ''}
            onChange={(e) => onChange(name, e.target.value)}
          />
          <span className="text-sm text-gray-400">{suffix}</span>
        </div>
      ) : (
        <p className="text-sm font-medium">
          {value != null ? `${prefix}${Number(value).toFixed(2)}${suffix}` : <span className="text-gray-400">—</span>}
        </p>
      )}
    </div>
  )
}

// ─── Expiry indicator ─────────────────────────────────────────────────────────

function ExpiryIndicator({ date }: { date: string | null }) {
  if (!date) return <span className="text-xs text-gray-400">No expiry</span>
  const today = new Date().toISOString().split('T')[0]
  const soon  = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  if (date < today)  return <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Expired {format(parseISO(date), 'd MMM yyyy')}</span>
  if (date < soon)   return <span className="text-xs text-amber-600 flex items-center gap-1"><Clock className="h-3 w-3" />Expires {format(parseISO(date), 'd MMM yyyy')}</span>
  return <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Valid to {format(parseISO(date), 'd MMM yyyy')}</span>
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ContractorAccountPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [editingContact, setEditingContact] = useState(false)
  const [editingRates, setEditingRates]     = useState(false)
  const [contactForm, setContactForm]       = useState<Partial<ContractorProfile>>({})
  const [ratesForm, setRatesForm]           = useState<Partial<ContractorProfile>>({})

  // Upload dialog state
  const [uploadOpen, setUploadOpen]         = useState(false)
  const [uploadType, setUploadType]         = useState('insurance')
  const [uploadName, setUploadName]         = useState('')
  const [uploadExpiry, setUploadExpiry]     = useState('')
  const [uploadNotes, setUploadNotes]       = useState('')
  const [uploading, setUploading]           = useState(false)
  const [deleteDocId, setDeleteDocId]       = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const isServiceProvider = ['grand_master', 'master', 'admin', 'admin_officer'].includes(user?.role ?? '')

  // ── Org access guard — prevent URL-spoofed orgId from leaking data ──────────
  const { orgIds, isLoading: orgIdsLoading } = useClientOrgIds()
  useEffect(() => {
    if (orgIdsLoading || !orgId) return
    if (orgIds !== null && !orgIds.includes(orgId)) {
      navigate('/crm', { replace: true })
    }
  }, [orgId, orgIds, orgIdsLoading, navigate])

  // ── Organisation ────────────────────────────────────────────────────────

  const { data: org } = useQuery({
    queryKey: ['crm_contractor_org', orgId],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('organizations') as any)
        .select('id, name, organization_type, is_active, contact_email, contact_phone, parent:organizations!parent_organization_id(name)')
        .eq('id', orgId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!orgId,
  })

  // ── Contractor profile ────────────────────────────────────────────────────

  const { data: profile, isLoading: profileLoading } = useQuery<ContractorProfile | null>({
    queryKey: ['crm_contractor_profile', orgId],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('contractor_profiles') as any)
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!orgId,
  })

  // ── Documents ────────────────────────────────────────────────────────────

  const { data: documents = [] } = useQuery<ContractorDocument[]>({
    queryKey: ['crm_contractor_docs', orgId],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('contractor_documents') as any)
        .select(`
          id, organization_id, document_type, document_name, document_url,
          expiry_date, is_current, notes, uploaded_by, created_at,
          uploader:user_profiles!uploaded_by(first_name, last_name)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((d: any) => ({
        ...d,
        uploader: Array.isArray(d.uploader) ? d.uploader[0] ?? null : d.uploader,
      })) as ContractorDocument[]
    },
    enabled: !!orgId,
  })

  // ── Recent shifts ─────────────────────────────────────────────────────────

  const { data: recentShifts = [] } = useQuery<RecentShift[]>({
    queryKey: ['crm_contractor_shifts', orgId],
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('roster_shifts') as any)
        .select(`
          id, shift_date, shift_type, start_time, end_time, status,
          guard_cost_rate, client_charge_rate,
          officer:user_profiles!officer_id(first_name, last_name),
          site:client_sites!client_site_id(name)
        `)
        .eq('contractor_org_id', orgId)
        .order('shift_date', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data || []).map((s: any) => ({
        ...s,
        officer: Array.isArray(s.officer) ? s.officer[0] ?? null : s.officer,
        site:    Array.isArray(s.site)    ? s.site[0]    ?? null : s.site,
      })) as RecentShift[]
    },
    enabled: !!orgId,
  })

  // ── Save profile mutation ─────────────────────────────────────────────────

  const saveProfileMutation = useMutation({
    mutationFn: async (updates: Partial<ContractorProfile>) => {
      const { error } = await ((supabase as any).from('contractor_profiles') as any)
        .update(updates)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm_contractor_profile', orgId] })
      queryClient.invalidateQueries({ queryKey: ['crm_accounts'] })
      setEditingContact(false)
      setEditingRates(false)
      toast.success('Profile saved')
    },
    onError: (e: any) => toast.error(e.message || 'Save failed'),
  })

  // ── Upload document mutation ──────────────────────────────────────────────

  async function handleUpload() {
    const file = fileRef.current?.files?.[0]
    if (!file) { toast.error('Please select a file'); return }
    if (!uploadName.trim()) { toast.error('Please enter a document name'); return }
    if (!orgId) return

    setUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `${orgId}/${uploadType}/${Date.now()}_${uploadName.replace(/\s+/g, '_')}.${ext}`

      const { url, error: uploadError } = await uploadFile({
        bucket: 'contractor-docs',
        path,
        file,
      })
      if (uploadError) throw new Error(uploadError)

      const { error: dbError } = await ((supabase as any).from('contractor_documents') as any).insert({
        organization_id: orgId,
        document_type:   uploadType,
        document_name:   uploadName.trim(),
        document_url:    url,
        expiry_date:     uploadExpiry || null,
        notes:           uploadNotes || null,
        is_current:      true,
        uploaded_by:     user?.id,
        file_size_bytes: file.size,
        mime_type:       file.type,
      })
      if (dbError) throw dbError

      queryClient.invalidateQueries({ queryKey: ['crm_contractor_docs', orgId] })
      toast.success('Document uploaded')
      setUploadOpen(false)
      setUploadName(''); setUploadExpiry(''); setUploadNotes('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // ── Archive document ──────────────────────────────────────────────────────

  const archiveDocMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await ((supabase as any).from('contractor_documents') as any)
        .update({ is_current: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm_contractor_docs', orgId] })
      setDeleteDocId(null)
      toast.success('Document archived')
    },
  })

  // ─────────────────────────────────────────────────────────────────────────

  function setContact(field: string, value: string) {
    setContactForm((f) => ({ ...f, [field]: value || null }))
  }
  function setRate(field: string, value: string) {
    setRatesForm((f) => ({ ...f, [field]: value ? parseFloat(value) : null }))
  }

  function startEditContact() {
    setContactForm({
      contact_name:  profile?.contact_name  ?? '',
      contact_role:  profile?.contact_role  ?? '',
      contact_phone: profile?.contact_phone ?? '',
      contact_email: profile?.contact_email ?? '',
      accounts_name: profile?.accounts_name ?? '',
      accounts_email:profile?.accounts_email?? '',
      accounts_phone:profile?.accounts_phone?? '',
      notes:         profile?.notes         ?? '',
    })
    setEditingContact(true)
  }

  function startEditRates() {
    setRatesForm({
      guard_rate_per_hour:        profile?.guard_rate_per_hour        ?? null,
      travel_rate_per_km:         profile?.travel_rate_per_km         ?? null,
      standby_rate_per_hour:      profile?.standby_rate_per_hour      ?? null,
      short_notice_rate_per_hour: profile?.short_notice_rate_per_hour ?? null,
      long_term_rate_per_hour:    profile?.long_term_rate_per_hour    ?? null,
      long_term_definition:       profile?.long_term_definition       ?? '',
      long_term_min_days:         profile?.long_term_min_days         ?? null,
    })
    setEditingRates(true)
  }

  const currentDocs = documents.filter((d) => d.is_current)
  const archivedDocs = documents.filter((d) => !d.is_current)

  // ── Margin summary across recent shifts ──────────────────────────────────
  const shiftsWithRates = recentShifts.filter(
    (s) => s.guard_cost_rate != null && s.client_charge_rate != null
  )
  const avgMargin = shiftsWithRates.length > 0
    ? shiftsWithRates.reduce((sum, s) => sum + (s.client_charge_rate! - s.guard_cost_rate!), 0) / shiftsWithRates.length
    : null

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout showBackButton>
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-amber-600" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{org?.name ?? '…'}</h1>
              <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50">
                Contractor
              </Badge>
              {org && (
                <Badge variant={org.is_active ? 'default' : 'secondary'}>
                  {org.is_active ? 'Active' : 'Inactive'}
                </Badge>
              )}
            </div>
            {org?.parent && (
              <p className="text-sm text-gray-500 mt-0.5">via {org.parent.name}</p>
            )}
          </div>
        </div>

        {/* Margin KPI */}
        {avgMargin != null && (
          <div className="text-right hidden sm:block">
            <p className="text-xs text-gray-400">Avg margin (last 10 shifts)</p>
            <p className={`text-xl font-bold ${avgMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${avgMargin.toFixed(2)}/hr
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">

        {/* ── 1. Account Information ──────────────────────────────────────── */}
        <Section
          title="Account Information"
          icon={Users}
          action={
            isServiceProvider ? (
              editingContact ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditingContact(false)}>
                    <X className="h-3 w-3" />
                  </Button>
                  <Button size="sm" onClick={() => saveProfileMutation.mutate(contactForm)}>
                    <Save className="h-3 w-3 mr-1" />Save
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={startEditContact}>
                  <Edit2 className="h-3 w-3 mr-1" />Edit
                </Button>
              )
            ) : null
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Primary contact */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Primary Contact</p>
              {editingContact ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input className="h-8 mt-0.5" value={contactForm.contact_name ?? ''} onChange={(e) => setContact('contact_name', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Role / Title</Label>
                      <Input className="h-8 mt-0.5" value={contactForm.contact_role ?? ''} onChange={(e) => setContact('contact_role', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input className="h-8 mt-0.5" value={contactForm.contact_phone ?? ''} onChange={(e) => setContact('contact_phone', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input className="h-8 mt-0.5" type="email" value={contactForm.contact_email ?? ''} onChange={(e) => setContact('contact_email', e.target.value)} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <p className="font-medium">{profile?.contact_name ?? <span className="text-gray-400">—</span>}</p>
                  {profile?.contact_role && <p className="text-gray-500">{profile.contact_role}</p>}
                  {profile?.contact_phone && <p className="flex items-center gap-1.5 text-gray-600"><Phone className="h-3.5 w-3.5" />{profile.contact_phone}</p>}
                  {profile?.contact_email && <p className="flex items-center gap-1.5 text-gray-600"><Mail className="h-3.5 w-3.5" />{profile.contact_email}</p>}
                </div>
              )}
            </div>

            {/* Accounts / invoicing */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Accounts / Invoicing</p>
              {editingContact ? (
                <>
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input className="h-8 mt-0.5" value={contactForm.accounts_name ?? ''} onChange={(e) => setContact('accounts_name', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input className="h-8 mt-0.5" value={contactForm.accounts_phone ?? ''} onChange={(e) => setContact('accounts_phone', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input className="h-8 mt-0.5" type="email" value={contactForm.accounts_email ?? ''} onChange={(e) => setContact('accounts_email', e.target.value)} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <p className="font-medium">{profile?.accounts_name ?? <span className="text-gray-400">—</span>}</p>
                  {profile?.accounts_phone && <p className="flex items-center gap-1.5 text-gray-600"><Phone className="h-3.5 w-3.5" />{profile.accounts_phone}</p>}
                  {profile?.accounts_email && <p className="flex items-center gap-1.5 text-gray-600"><Mail className="h-3.5 w-3.5" />{profile.accounts_email}</p>}
                </div>
              )}
            </div>

            {/* Notes */}
            {editingContact && (
              <div className="md:col-span-2">
                <Label className="text-xs">Notes</Label>
                <Textarea className="mt-0.5 text-sm" rows={3} value={contactForm.notes ?? ''} onChange={(e) => setContact('notes', e.target.value)} />
              </div>
            )}
            {!editingContact && profile?.notes && (
              <div className="md:col-span-2 text-sm text-gray-600 border-l-2 border-gray-200 pl-3">
                {profile.notes}
              </div>
            )}
          </div>
        </Section>

        {/* ── 2. Rate Card ─────────────────────────────────────────────────── */}
        <Section
          title="Rate Card (NZD ex-GST)"
          icon={DollarSign}
          action={
            isServiceProvider ? (
              editingRates ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditingRates(false)}>
                    <X className="h-3 w-3" />
                  </Button>
                  <Button size="sm" onClick={() => saveProfileMutation.mutate(ratesForm)}>
                    <Save className="h-3 w-3 mr-1" />Save
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={startEditRates}>
                  <Edit2 className="h-3 w-3 mr-1" />Edit
                </Button>
              )
            ) : null
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <RateField label="Guard Rate"       name="guard_rate_per_hour"        value={editingRates ? ratesForm.guard_rate_per_hour        ?? null : profile?.guard_rate_per_hour        ?? null} editing={editingRates} onChange={setRate} />
            <RateField label="Standby Rate"     name="standby_rate_per_hour"      value={editingRates ? ratesForm.standby_rate_per_hour      ?? null : profile?.standby_rate_per_hour      ?? null} editing={editingRates} onChange={setRate} />
            <RateField label="Short Notice Rate"name="short_notice_rate_per_hour" value={editingRates ? ratesForm.short_notice_rate_per_hour ?? null : profile?.short_notice_rate_per_hour ?? null} editing={editingRates} onChange={setRate} />
            <RateField label="Long Term Rate"   name="long_term_rate_per_hour"    value={editingRates ? ratesForm.long_term_rate_per_hour    ?? null : profile?.long_term_rate_per_hour    ?? null} editing={editingRates} onChange={setRate} />
            <RateField label="Travel (per km)"  name="travel_rate_per_km"         value={editingRates ? ratesForm.travel_rate_per_km         ?? null : profile?.travel_rate_per_km         ?? null} editing={editingRates} onChange={setRate} prefix="$" suffix="/km" />
          </div>

          {/* Long-term definition */}
          <Separator className="my-3" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
            <div>
              <p className="text-xs text-gray-500">Long-term definition</p>
              {editingRates ? (
                <Input
                  className="h-8 mt-0.5 text-sm"
                  placeholder="e.g. Minimum 2-week deployment"
                  value={ratesForm.long_term_definition ?? ''}
                  onChange={(e) => setRatesForm((f) => ({ ...f, long_term_definition: e.target.value || null }))}
                />
              ) : (
                <p className="text-sm font-medium mt-0.5">
                  {profile?.long_term_definition ?? <span className="text-gray-400">—</span>}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500">Minimum days for long-term rate</p>
              {editingRates ? (
                <Input
                  type="number"
                  min="1"
                  className="h-8 mt-0.5 text-sm w-24"
                  value={ratesForm.long_term_min_days ?? ''}
                  onChange={(e) => setRatesForm((f) => ({ ...f, long_term_min_days: e.target.value ? parseInt(e.target.value) : null }))}
                />
              ) : (
                <p className="text-sm font-medium mt-0.5">
                  {profile?.long_term_min_days
                    ? `${profile.long_term_min_days} days`
                    : <span className="text-gray-400">—</span>}
                </p>
              )}
            </div>
          </div>
        </Section>

        {/* ── 3. Compliance Documents ──────────────────────────────────────── */}
        <Section
          title="Compliance Documents"
          icon={FileText}
          action={
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="h-3 w-3 mr-1" />Upload
            </Button>
          }
        >
          {/* Compliance summary strip */}
          <div className="flex flex-wrap gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
            {[
              { label: 'Service Agreement', verified: profile?.service_agreement_signed, expiry: profile?.service_agreement_expiry },
              { label: 'Insurance',         verified: profile?.insurance_verified,        expiry: profile?.insurance_expiry },
              { label: 'H&S Policy',        verified: profile?.hs_policy_verified,        expiry: profile?.hs_policy_expiry },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                {item.verified
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                <div>
                  <p className="text-xs font-medium">{item.label}</p>
                  <ExpiryIndicator date={item.expiry ?? null} />
                </div>
              </div>
            ))}
          </div>

          {/* Current documents */}
          {currentDocs.length === 0 ? (
            <p className="text-sm text-gray-400 py-2 text-center">No documents on file. Click Upload to add one.</p>
          ) : (
            <div className="space-y-2">
              {currentDocs.map((doc) => {
                const Icon = DOC_TYPE_ICONS[doc.document_type] ?? FileText
                return (
                  <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-gray-500 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{doc.document_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-xs">
                            {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                          </Badge>
                          <ExpiryIndicator date={doc.expiry_date} />
                        </div>
                        {doc.uploader && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Uploaded by {doc.uploader.first_name} {doc.uploader.last_name} · {format(parseISO(doc.created_at), 'd MMM yyyy')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <a href={doc.document_url} target="_blank" rel="noopener noreferrer">
                          View
                        </a>
                      </Button>
                      {isServiceProvider && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-gray-400 hover:text-red-500"
                          onClick={() => setDeleteDocId(doc.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Archived */}
          {archivedDocs.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                {archivedDocs.length} archived document{archivedDocs.length !== 1 ? 's' : ''}
              </summary>
              <div className="space-y-1.5 mt-2">
                {archivedDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-2 border rounded opacity-60 text-sm">
                    <span>{doc.document_name}</span>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={doc.document_url} target="_blank" rel="noopener noreferrer">View</a>
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </Section>

        {/* ── 4. Recent Roster Shifts ───────────────────────────────────────── */}
        <Section title="Recent Roster Shifts" icon={Clock} defaultOpen={false}>
          {recentShifts.length === 0 ? (
            <p className="text-sm text-gray-400 py-2 text-center">No shifts recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left py-2 pr-4">Date</th>
                    <th className="text-left py-2 pr-4">Officer</th>
                    <th className="text-left py-2 pr-4">Site</th>
                    <th className="text-left py-2 pr-4">Type</th>
                    <th className="text-right py-2 pr-4">Cost</th>
                    <th className="text-right py-2 pr-4">Charge</th>
                    <th className="text-right py-2">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {recentShifts.map((shift) => {
                    const margin = (shift.client_charge_rate != null && shift.guard_cost_rate != null)
                      ? shift.client_charge_rate - shift.guard_cost_rate
                      : null
                    return (
                      <tr key={shift.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">{format(parseISO(shift.shift_date), 'd MMM')}</td>
                        <td className="py-2 pr-4">
                          {shift.officer
                            ? `${shift.officer.first_name} ${shift.officer.last_name}`
                            : '—'}
                        </td>
                        <td className="py-2 pr-4 text-gray-500">{shift.site?.name ?? '—'}</td>
                        <td className="py-2 pr-4 capitalize">{shift.shift_type}</td>
                        <td className="py-2 pr-4 text-right font-mono text-amber-700">
                          {shift.guard_cost_rate != null ? `$${Number(shift.guard_cost_rate).toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-blue-700">
                          {shift.client_charge_rate != null ? `$${Number(shift.client_charge_rate).toFixed(2)}` : '—'}
                        </td>
                        <td className={`py-2 text-right font-mono font-semibold ${
                          margin == null ? 'text-gray-400' :
                          margin >= 0    ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {margin != null ? `$${margin.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

      </div>

      {/* ── Upload document dialog ─────────────────────────────────────────── */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Add a compliance document for {org?.name}. Accepted: PDF, Word, JPG, PNG (max 20 MB).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Document Type</Label>
              <Select value={uploadType} onValueChange={setUploadType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Document Name *</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Public Liability Insurance 2026"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </div>
            <div>
              <Label>Expiry Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={uploadExpiry}
                onChange={(e) => setUploadExpiry(e.target.value)}
              />
            </div>
            <div>
              <Label>File *</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                className="mt-1 block text-sm text-gray-600"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1 text-sm"
                rows={2}
                placeholder="Optional notes"
                value={uploadNotes}
                onChange={(e) => setUploadNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading}>
              <Upload className="h-4 w-4 mr-1.5" />
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archive confirmation ───────────────────────────────────────────── */}
      <AlertDialog open={!!deleteDocId} onOpenChange={(v) => !v && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this document?</AlertDialogTitle>
            <AlertDialogDescription>
              The document will be marked as superseded and hidden from the active list, but not permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDocId && archiveDocMutation.mutate(deleteDocId)}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  )
}
