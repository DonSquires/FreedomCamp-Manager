/**
 * InfringementNotices — Admin page for issuing and managing FCA infringement notices
 * 
 * Modelled on ADR / TicketOr2 workflow:
 *   draft → issued → paid | reminder_sent → court_referred | withdrawn | cancelled
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  FileText, Plus, Search, RefreshCw, Printer, CheckCircle,
  AlertTriangle, Scale, XCircle, Clock, DollarSign, Eye, Gavel,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InfringementNotice {
  id: string
  notice_number: string
  plate_number: string
  offence_description: string
  legal_basis: string
  offence_date: string
  offence_location: string
  amount_cents: number
  due_date: string
  service_method: string
  status: string
  issued_at: string
  recipient_name: string | null
  zone: { name: string } | null
  issuer: { first_name: string; last_name: string } | null
}

interface BreachAlertOption {
  id: string
  plate_number: string
  breach_type: string
  zone: { name: string; id: string } | null
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
  draft:         { label: 'Draft',         variant: 'outline',     icon: Clock },
  issued:        { label: 'Issued',        variant: 'default',     icon: FileText },
  paid:          { label: 'Paid',          variant: 'default',     icon: CheckCircle },
  reminder_sent: { label: 'Reminder Sent', variant: 'secondary',   icon: AlertTriangle },
  court_referred:{ label: 'Court',         variant: 'destructive', icon: Gavel },
  withdrawn:     { label: 'Withdrawn',     variant: 'outline',     icon: XCircle },
  cancelled:     { label: 'Cancelled',     variant: 'outline',     icon: XCircle },
}

const BREACH_TYPE_LABELS: Record<string, string> = {
  consecutive_nights:    'Consecutive Nights Exceeded',
  monthly_limit:         'Monthly Limit Exceeded',
  self_contained:        'Vehicle Not Self-Contained',
  after_hours:           'After-Hours Camping',
  day_visit_violation:   'Day Visit Violation',
  allowed_days_violation:'Camping on Prohibited Day',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function InfringementNotices() {
  const { user } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showIssueDialog, setShowIssueDialog] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [prefillingFromObservation, setPrefillingFromObservation] = useState(false)
  const [reprintingNoticeId, setReprintingNoticeId] = useState<string | null>(null)

  // Issue form state
  const [form, setForm] = useState({
    breach_alert_id: '',
    plate_number: '',
    zone_id: '',
    offence_description: '',
    legal_basis: 'Freedom Camping Act 2011 s20(1)(a)',
    offence_location: '',
    amount_cents: 20000,
    service_method: 'hand' as 'hand' | 'post' | 'email',
    recipient_name: '',
    recipient_email: '',
    due_date: '',   // defaults to +28d if blank
    observation_id: '',
  })

  useEffect(() => {
    const observationId = searchParams.get('observation_id')
    if (!observationId || !effectiveOrganizationId) return

    let cancelled = false
    const loadObservation = async () => {
      setPrefillingFromObservation(true)
      try {
        const { data: obs, error: obsError } = await (supabase.from('observations') as any)
          .select('observation_id, plate_number, zone_id, breach_type, is_compliant, zones!zone_id(name)')
          .eq('observation_id', observationId)
          .eq('organization_id', effectiveOrganizationId)
          .single()

        if (obsError || !obs) throw new Error(obsError?.message || 'Observation not found')

        const { data: breach } = await (supabase.from('breach_alerts') as any)
          .select('id')
          .eq('observation_id', observationId)
          .eq('organization_id', effectiveOrganizationId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const offence = obs.breach_type
          ? (BREACH_TYPE_LABELS[obs.breach_type] || String(obs.breach_type).replace(/_/g, ' '))
          : (obs.is_compliant === false ? 'Historical non-compliance observation' : 'Historical observation follow-up')

        if (!cancelled) {
          setForm((f) => ({
            ...f,
            observation_id: obs.observation_id,
            breach_alert_id: breach?.id || '',
            plate_number: obs.plate_number || f.plate_number,
            zone_id: obs.zone_id || f.zone_id,
            offence_location: obs?.zones?.name || f.offence_location,
            offence_description: offence,
          }))
          setShowIssueDialog(true)
          toast.success('Historical observation loaded for ticket issuance')
        }
      } catch (err: any) {
        if (!cancelled) toast.error(err?.message || 'Could not load historical observation')
      } finally {
        if (!cancelled) {
          setPrefillingFromObservation(false)
          const next = new URLSearchParams(searchParams)
          next.delete('observation_id')
          setSearchParams(next, { replace: true })
        }
      }
    }

    void loadObservation()
    return () => {
      cancelled = true
    }
  }, [effectiveOrganizationId, searchParams, setSearchParams])

  // ── Fetch notices ──────────────────────────────────────────────────────────
  const { data: notices = [], isLoading, refetch } = useQuery({
    queryKey: ['infringement-notices', organizationId, zoneId, dateFrom, dateTo, user?.organization_id],
    queryFn: async () => {
      let q = supabase
        .from('infringement_notices')
        .select(`
          id, notice_number, plate_number, offence_description, legal_basis,
          offence_date, offence_location, amount_cents, due_date, service_method,
          status, created_at,
          zone:zones!zone_id(name),
          issuer:user_profiles!created_by(first_name, last_name)
        `)
        .order('created_at', { ascending: false })
        .limit(200)

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId)   q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate)   q = q.lte('created_at', endDate)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as InfringementNotice[]
    },
  })

  // ── Fetch breach alerts for the dropdown ─────────────────────────────────
  const { data: breachOptions = [] } = useQuery({
    queryKey: ['breach-options', effectiveOrganizationId],
    queryFn: async () => {
      let q = supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, zone:zones!zone_id(name, id)')
        .in('status', ['pending', 'acknowledged'])
        .order('created_at', { ascending: false })
        .limit(100)

      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)

      const { data } = await q
      return (data || []) as unknown as BreachAlertOption[]
    },
    enabled: !!effectiveOrganizationId,
  })

  // ── Zones for the form ────────────────────────────────────────────────────
  const { data: zones = [] } = useQuery({
    queryKey: ['zones-simple', effectiveOrganizationId],
    queryFn: async () => {
      let q = supabase
        .from('zones')
        .select('id, name')
        .eq('is_active', true)
        .order('name')

      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)

      const { data } = await q
      return data || []
    },
    enabled: !!effectiveOrganizationId,
  })

  // ── Status update mutation ────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (supabase.from('infringement_notices') as any)
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Notice status updated')
      queryClient.invalidateQueries({ queryKey: ['infringement-notices'] })
    },
    onError: (e: any) => toast.error(e.message || 'Update failed'),
  })

  // ── Issue new notice ──────────────────────────────────────────────────────
  const handleIssue = async () => {
    if (!form.plate_number || !form.zone_id || !form.offence_description || !form.legal_basis) {
      toast.error('Plate, zone, offence description and legal basis are required')
      return
    }
    setIssuing(true)
    try {
      const body: any = {
        plate_number: form.plate_number.toUpperCase().trim(),
        zone_id: form.zone_id,
        offence_description: form.offence_description,
        legal_basis: form.legal_basis,
        offence_location: form.offence_location,
        amount_cents: form.amount_cents,
        service_method: form.service_method,
        recipient_name: form.recipient_name || undefined,
        recipient_email: form.recipient_email || undefined,
        offence_date: new Date().toISOString(),
      }
      if (form.breach_alert_id) body.breach_alert_id = form.breach_alert_id
      if (form.observation_id)  body.observation_id = form.observation_id
      if (form.due_date)        body.due_date = form.due_date

      const { data, error } = await supabase.functions.invoke('generate-infringement', { body })
      if (error) throw new Error(error.message || 'Edge function error')
      if (!data?.success) throw new Error(data?.error || 'Failed to generate notice')

      toast.success(`Notice ${data.notice_number} issued successfully`)
      setPreviewHtml(data.html)
      setShowIssueDialog(false)
      queryClient.invalidateQueries({ queryKey: ['infringement-notices'] })

      // Reset form
      setForm({
        breach_alert_id: '', plate_number: '', zone_id: '',
        offence_description: '', legal_basis: 'Freedom Camping Act 2011 s20(1)(a)',
        offence_location: '', amount_cents: 20000, service_method: 'hand',
        recipient_name: '', recipient_email: '', due_date: '', observation_id: '',
      })
    } catch (err: any) {
      toast.error(err.message || 'Failed to issue notice')
    } finally {
      setIssuing(false)
    }
  }

  const handleReprint = async (noticeId: string) => {
    setReprintingNoticeId(noticeId)
    try {
      const { data, error } = await supabase.functions.invoke('render-infringement-notice', {
        body: { notice_id: noticeId },
      })
      if (error) throw new Error(error.message || 'Failed to load printable notice')
      if (!data?.success || !data?.html) throw new Error(data?.error || 'Printable notice unavailable')
      setPreviewHtml(data.html)
    } catch (err: any) {
      toast.error(err.message || 'Failed to reprint notice')
    } finally {
      setReprintingNoticeId(null)
    }
  }

  // ── Populate form from selected breach alert ──────────────────────────────
  const handleBreachSelect = (breachId: string) => {
    const breach = breachOptions.find(b => b.id === breachId)
    if (!breach) return
    setForm(f => ({
      ...f,
      breach_alert_id: breachId,
      plate_number: breach.plate_number,
      zone_id: (breach.zone as any)?.id ?? f.zone_id,
      offence_description: BREACH_TYPE_LABELS[breach.breach_type] || breach.breach_type,
    }))
  }

  // ── Filtered notices ──────────────────────────────────────────────────────
  const filtered = notices.filter(n => {
    if (statusFilter !== 'all' && n.status !== statusFilter) return false
    if (search) {
      const term = search.toUpperCase()
      return n.plate_number?.toUpperCase().includes(term) ||
             n.notice_number?.toUpperCase().includes(term)
    }
    return true
  })

  // ── Stats ─────────────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const stats = {
    issuedToday:   notices.filter(n => n.issued_at?.startsWith(today)).length,
    outstanding:   notices.filter(n => ['issued', 'reminder_sent'].includes(n.status)).length,
    paid:          notices.filter(n => n.status === 'paid').length,
    court:         notices.filter(n => n.status === 'court_referred').length,
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout
      title="Infringement Notices"
      description="Issue and track FCA infringement notices (fines)"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={FileText}  label="Issued Today"  value={stats.issuedToday}  color="blue" />
        <StatCard icon={Clock}     label="Outstanding"   value={stats.outstanding}   color="yellow" />
        <StatCard icon={CheckCircle} label="Paid"        value={stats.paid}          color="green" />
        <StatCard icon={Gavel}     label="Court Referred" value={stats.court}        color="red" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plate or notice #..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="issued">Issued</TabsTrigger>
            <TabsTrigger value="paid">Paid</TabsTrigger>
            <TabsTrigger value="court_referred">Court</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>

        {['admin', 'admin_officer', 'master', 'officer'].includes(user?.role ?? '') && (
          <Button onClick={() => setShowIssueDialog(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Issue Notice
          </Button>
        )}
      </div>

      {/* Notices list */}
      {isLoading ? (
        <PaperworkSearchAnimation size="sm" text="Loading infringements…" />
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No notices found</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(notice => {
            const meta = STATUS_META[notice.status] || STATUS_META.issued
            const StatusIcon = meta.icon
            const overdue = ['issued', 'reminder_sent'].includes(notice.status) &&
              notice.due_date && new Date(notice.due_date) < new Date()
            return (
              <Card
                key={notice.id}
                className={`border-l-4 ${
                  overdue ? 'border-l-red-500' :
                  notice.status === 'paid' ? 'border-l-green-500' :
                  notice.status === 'issued' ? 'border-l-blue-500' : 'border-l-gray-300'
                }`}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-lg">{notice.plate_number}</span>
                        <span className="text-xs text-muted-foreground font-mono">{notice.notice_number}</span>
                        <Badge variant={meta.variant} className="gap-1 text-[10px]">
                          <StatusIcon className="h-3 w-3" />
                          {meta.label}
                          {overdue && ' — OVERDUE'}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {notice.offence_description}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground mt-1">
                        <span>{notice.zone?.name || '—'}</span>
                        <span className="font-semibold text-red-600">
                          NZD ${((notice.amount_cents || 0) / 100).toFixed(2)}
                        </span>
                        {notice.due_date && (
                          <span>Due: {new Date(notice.due_date).toLocaleDateString('en-NZ')}</span>
                        )}
                        <span>Issued: {formatDateTime(notice.issued_at)}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-1.5 flex-wrap shrink-0">
                      <Button
                        size="sm" variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={reprintingNoticeId === notice.id}
                        onClick={() => handleReprint(notice.id)}
                      >
                        <Printer className="h-3 w-3" />
                        {reprintingNoticeId === notice.id ? 'Loading...' : 'Reprint'}
                      </Button>

                      {notice.status === 'issued' && (
                        <>
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-green-400 text-green-700"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'paid' })}
                          >
                            <DollarSign className="h-3 w-3" /> Paid
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-orange-400 text-orange-700"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'reminder_sent' })}
                          >
                            <AlertTriangle className="h-3 w-3" /> Reminder
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-red-400 text-red-700"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'court_referred' })}
                          >
                            <Scale className="h-3 w-3" /> Court
                          </Button>
                        </>
                      )}
                      {notice.status === 'reminder_sent' && (
                        <>
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-green-400 text-green-700"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'paid' })}
                          >
                            <DollarSign className="h-3 w-3" /> Paid
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-red-400 text-red-700"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'court_referred' })}
                          >
                            <Scale className="h-3 w-3" /> Court
                          </Button>
                        </>
                      )}
                      {['admin', 'admin_officer', 'master'].includes(user?.role ?? '') &&
                       ['issued', 'draft', 'reminder_sent'].includes(notice.status) && (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => updateStatus.mutate({ id: notice.id, status: 'withdrawn' })}
                        >
                          <XCircle className="h-3 w-3" /> Void
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Issue Notice Dialog ─────────────────────────────────────────── */}
      <Dialog open={showIssueDialog} onOpenChange={open => { if (!open) setShowIssueDialog(false) }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue Infringement Notice</DialogTitle>
            <DialogDescription>
              Creates a formal NZD fine under the Freedom Camping Act 2011.
              A printable notice will be generated on issue.
            </DialogDescription>
            {prefillingFromObservation && (
              <p className="text-xs text-muted-foreground">Loading historical observation details...</p>
            )}
            {!prefillingFromObservation && form.observation_id && (
              <p className="text-xs text-blue-700">Linked observation: {form.observation_id}</p>
            )}
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Pre-fill from breach */}
            {breachOptions.length > 0 && (
              <div className="space-y-1">
                <Label>Pre-fill from Breach Alert (optional)</Label>
                <Select
                  value={form.breach_alert_id}
                  onValueChange={handleBreachSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a breach alert..." />
                  </SelectTrigger>
                  <SelectContent>
                    {breachOptions.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.plate_number} — {BREACH_TYPE_LABELS[b.breach_type] || b.breach_type}
                        {b.zone ? ` (${(b.zone as any).name})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Plate Number <span className="text-red-500">*</span></Label>
                <Input
                  value={form.plate_number}
                  onChange={e => setForm(f => ({ ...f, plate_number: e.target.value.toUpperCase() }))}
                  placeholder="ABC123"
                  className="font-mono font-bold"
                />
              </div>
              <div className="space-y-1">
                <Label>Zone <span className="text-red-500">*</span></Label>
                <Select value={form.zone_id} onValueChange={v => setForm(f => ({ ...f, zone_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select zone..." /></SelectTrigger>
                  <SelectContent>
                    {zones.map((z: any) => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Offence Description <span className="text-red-500">*</span></Label>
              <Input
                value={form.offence_description}
                onChange={e => setForm(f => ({ ...f, offence_description: e.target.value }))}
                placeholder="e.g. Camping for 4 consecutive nights exceeding the 3-night limit"
              />
            </div>

            <div className="space-y-1">
              <Label>Legal Basis <span className="text-red-500">*</span></Label>
              <Input
                value={form.legal_basis}
                onChange={e => setForm(f => ({ ...f, legal_basis: e.target.value }))}
                placeholder="FCA 2011 s20(1)(a); Council Bylaw 2024/12 cl 7.2"
              />
            </div>

            <div className="space-y-1">
              <Label>Location Description</Label>
              <Input
                value={form.offence_location}
                onChange={e => setForm(f => ({ ...f, offence_location: e.target.value }))}
                placeholder="e.g. Freedom camping area — North Beach Reserve, Bay of Plenty"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Fine Amount (NZD)</Label>
                <Select
                  value={String(form.amount_cents)}
                  onValueChange={v => setForm(f => ({ ...f, amount_cents: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20000">$200.00 (standard FCA)</SelectItem>
                    <SelectItem value="40000">$400.00 (repeat offender)</SelectItem>
                    <SelectItem value="10000">$100.00 (warning notice)</SelectItem>
                    <SelectItem value="60000">$600.00 (commercial vehicle)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payment Due</Label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  placeholder="Defaults to +28 days"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Service Method</Label>
              <Select
                value={form.service_method}
                onValueChange={v => setForm(f => ({ ...f, service_method: v as any }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hand">Hand delivered (on-site)</SelectItem>
                  <SelectItem value="post">Posted</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Recipient Name (if known)</Label>
                <Input
                  value={form.recipient_name}
                  onChange={e => setForm(f => ({ ...f, recipient_name: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              {form.service_method === 'email' && (
                <div className="space-y-1">
                  <Label>Recipient Email</Label>
                  <Input
                    type="email"
                    value={form.recipient_email}
                    onChange={e => setForm(f => ({ ...f, recipient_email: e.target.value }))}
                    placeholder="owner@example.com"
                  />
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIssueDialog(false)}>Cancel</Button>
            <Button onClick={handleIssue} disabled={issuing} className="gap-1.5">
              <FileText className="h-4 w-4" />
              {issuing ? 'Generating...' : 'Issue Notice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Notice Preview / Print Dialog ──────────────────────────────── */}
      <Dialog open={!!previewHtml} onOpenChange={open => { if (!open) setPreviewHtml(null) }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" />
              Infringement Notice — Preview &amp; Print
            </DialogTitle>
          </DialogHeader>
          {previewHtml && (
            <div className="p-4">
              <iframe
                srcDoc={previewHtml}
                title="Infringement Notice"
                className="w-full border rounded"
                style={{ height: '70vh' }}
              />
            </div>
          )}
          <div className="p-4 pt-0 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewHtml(null)}>Close</Button>
            <Button
              onClick={() => {
                const w = window.open('', '_blank')
                if (w) { w.document.write(previewHtml!); w.document.close(); w.print() }
              }}
              className="gap-1.5"
            >
              <Printer className="h-4 w-4" /> Print Notice
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

// ─── Stat Card helper ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: {
  icon: any; label: string; value: number; color: 'blue' | 'yellow' | 'green' | 'red'
}) {
  const palette = {
    blue:   { bg: 'bg-blue-50',   text: 'text-blue-600',  border: 'border-blue-200' },
    yellow: { bg: 'bg-yellow-50', text: 'text-yellow-600', border: 'border-yellow-200' },
    green:  { bg: 'bg-green-50',  text: 'text-green-600', border: 'border-green-200' },
    red:    { bg: 'bg-red-50',    text: 'text-red-600',   border: 'border-red-200' },
  }[color]
  return (
    <Card className={`border ${palette.border}`}>
      <CardContent className={`pt-4 pb-4 ${palette.bg}`}>
        <div className="flex items-center gap-3">
          <Icon className={`h-5 w-5 shrink-0 ${palette.text}`} />
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${palette.text}`}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
