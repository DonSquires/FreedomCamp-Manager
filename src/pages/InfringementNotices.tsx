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
import { edgeFunctions } from '@/lib/edgeFunctions'
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
  AlertTriangle, Scale, XCircle, Clock, DollarSign, Eye, Gavel, Copy, Download,
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
  observation_id: string | null
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
    (user?.role === 'master' || user?.role === 'grand_master') ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showHelp, setShowHelp] = useState(false)
  const [showIssueDialog, setShowIssueDialog] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [prefillingFromObservation, setPrefillingFromObservation] = useState(false)
  const [reprintingNoticeId, setReprintingNoticeId] = useState<string | null>(null)
  const [issueErrorDetail, setIssueErrorDetail] = useState<string | null>(null)
  const computedDueDateLabel = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toLocaleDateString('en-NZ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Pacific/Auckland',
  })


  const copyIssueError = async () => {
    if (!issueErrorDetail) return
    try {
      await navigator.clipboard.writeText(issueErrorDetail)
      toast.success('Issue error copied to clipboard')
    } catch {
      toast.error('Could not copy automatically. Select and copy the error text manually.')
    }
  }

  const withTimeout = async <T,>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), ms)
      promise
        .then((value) => {
          window.clearTimeout(timer)
          resolve(value)
        })
        .catch((error) => {
          window.clearTimeout(timer)
          reject(error)
        })
    })
  }

  // Issue form state
  const [form, setForm] = useState({
    breach_alert_id: '',
    plate_number: '',
    vehicle_make: '',
    vehicle_model: '',
    zone_id: '',
    offence_description: '',
    legal_basis: 'Freedom Camping Act 2011 s20(1)(a)',
    offence_location: '',
    amount_cents: 40000,
    service_method: 'hand' as 'hand' | 'post' | 'email',
    recipient_name: '',
    recipient_email: '',
    recipient_address: '',
    observation_id: '',
  })

  useEffect(() => {
    const observationId = searchParams.get('observation_id')
    if (!observationId) return

    const requestedServiceMethod = searchParams.get('service_method')
    const requestedRecipientName = searchParams.get('recipient_name')
    const requestedRecipientEmail = searchParams.get('recipient_email')
    const requestedRecipientAddress = searchParams.get('recipient_address')
    const serviceMethodFromQuery = requestedServiceMethod === 'post' || requestedServiceMethod === 'email' || requestedServiceMethod === 'hand'
      ? requestedServiceMethod
      : null

    let cancelled = false
    const loadObservation = async () => {
      setPrefillingFromObservation(true)
      try {
        let obsQuery = (supabase.from('observations') as any)
          .select('observation_id, plate_number, zone_id, breach_type, is_compliant, organization_id, zones!zone_id(name)')
          .eq('observation_id', observationId)

        if (effectiveOrganizationId) {
          obsQuery = obsQuery.eq('organization_id', effectiveOrganizationId)
        }

        const { data: obs, error: obsError } = await obsQuery.single()

        if (obsError || !obs) throw new Error(obsError?.message || 'Observation not found')

        let breachQuery = (supabase.from('breach_alerts') as any)
          .select('id')
          .eq('observation_id', observationId)
          .order('created_at', { ascending: false })
          .limit(1)

        const orgScope = effectiveOrganizationId || obs.organization_id
        if (orgScope) breachQuery = breachQuery.eq('organization_id', orgScope)

        const { data: breach } = await breachQuery.maybeSingle()

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
            service_method: (serviceMethodFromQuery as 'hand' | 'post' | 'email') || f.service_method,
            recipient_name: requestedRecipientName || f.recipient_name,
            recipient_email: requestedRecipientEmail || f.recipient_email,
            recipient_address: requestedRecipientAddress || f.recipient_address,
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
          next.delete('service_method')
          next.delete('recipient_name')
          next.delete('recipient_email')
          next.delete('recipient_address')
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
          status, created_at, issued_at,
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
        .select('id, observation_id, plate_number, breach_type, zone:zones!zone_id(name, id)')
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
    if (!form.observation_id) {
      toast.error('Manual notices are disabled. Issue from a recorded observation or breach alert.')
      return
    }

    if (!form.plate_number || !form.zone_id || !form.offence_description || !form.legal_basis) {
      toast.error('Observation-linked plate, zone, offence description and legal basis are required')
      return
    }

    if (form.service_method === 'email' && !form.recipient_email?.trim()) {
      toast.error('Recipient email address is required when serving by email')
      return
    }
    if (form.service_method === 'post' && !form.recipient_address?.trim()) {
      toast.error('Recipient postal address is required when serving by post')
      return
    }
    setIssueErrorDetail(null)
    setIssuing(true)
    try {
      const body: any = {
        plate_number: form.plate_number.toUpperCase().trim(),
        vehicle_make: form.vehicle_make.trim() || undefined,
        vehicle_model: form.vehicle_model.trim() || undefined,
        zone_id: form.zone_id,
        offence_description: form.offence_description,
        legal_basis: form.legal_basis,
        offence_location: form.offence_location,
        amount_cents: form.amount_cents,
        service_method: form.service_method,
        recipient_name: form.recipient_name || undefined,
        recipient_email: form.recipient_email || undefined,
        recipient_address: form.recipient_address || undefined,
        offence_date: new Date().toISOString(),
      }
      if (form.breach_alert_id) body.breach_alert_id = form.breach_alert_id
      if (form.observation_id)  body.observation_id = form.observation_id

      const { data, error } = await withTimeout(
        edgeFunctions.generateInfringement(body),
        45000,
        'Notice generation timed out. Please retry.',
      )
      if (error) throw new Error(error)
      if (!data?.success) throw new Error(data?.error || 'Failed to generate notice')

      toast.success(`Notice ${data.notice_number} issued successfully`)
      setIssueErrorDetail(null)
      setPreviewHtml(data.html)
      setShowIssueDialog(false)
      queryClient.invalidateQueries({ queryKey: ['infringement-notices'] })

      // Store HTML artifact in the notice-artifacts bucket
      if (data.html && data.notice_id && user?.organization_id) {
        try {
          const htmlBlob = new Blob([data.html], { type: 'text/html' })
          const storagePath = `infringements/${user.organization_id}/${data.notice_id}.html`
          const { error: uploadErr } = await supabase.storage
            .from('notice-artifacts')
            .upload(storagePath, htmlBlob, { contentType: 'text/html', upsert: true })
          if (!uploadErr) {
            await (supabase.from('infringement_notices') as any)
              .update({ notice_html_path: storagePath })
              .eq('id', data.notice_id)
          }
        } catch {
          // Non-fatal — artifact upload failure should not block the workflow
        }
      }

      // Reset form
      setForm({
        breach_alert_id: '', plate_number: '', vehicle_make: '', vehicle_model: '', zone_id: '',
        offence_description: '', legal_basis: 'Freedom Camping Act 2011 s20(1)(a)',
        offence_location: '', amount_cents: 40000, service_method: 'hand',
        recipient_name: '', recipient_email: '', recipient_address: '', observation_id: '',
      })
    } catch (err: any) {
      const message = err?.message || 'Failed to issue notice'
      const lowerMessage = message.toLowerCase()
      const isIssuanceAuthorizationError =
        lowerMessage.includes('warrant number') ||
        lowerMessage.includes('warrant has expired') ||
        lowerMessage.includes('insufficient permissions')

      if (isIssuanceAuthorizationError) {
        const friendlyMessage = lowerMessage.includes('expired')
          ? 'You are not authorized to issue infringements because your warrant has expired. Please contact an administrator.'
          : 'You are not authorized to issue infringements. Please contact an administrator.'

        setIssueErrorDetail(friendlyMessage)
        toast.warning(friendlyMessage)
        return
      }

      setIssueErrorDetail(message)
      try {
        await navigator.clipboard.writeText(message)
        toast.error(`${message} (copied to clipboard)`)
      } catch {
        toast.error(message)
      }
    } finally {
      setIssuing(false)
    }
  }

  const handleReprint = async (noticeId: string) => {
    setReprintingNoticeId(noticeId)
    try {
      const { data, error } = await withTimeout(
        edgeFunctions.renderInfringementNotice({ notice_id: noticeId }),
        45000,
        'Ticket render timed out. Please try again.',
      )
      if (error) throw new Error(error)
      if (!data?.success || !data?.html) throw new Error(data?.error || 'Printable notice unavailable')
      setPreviewHtml(data.html)
    } catch (err: any) {
      toast.error(err.message || 'Failed to reprint notice')
    } finally {
      setReprintingNoticeId(null)
    }
  }

  const openPreviewWindow = (mode: 'open' | 'print') => {
    if (!previewHtml) {
      toast.error('Printable notice unavailable')
      return
    }

    const previewWindow = window.open('', '_blank')
    if (!previewWindow) {
      toast.error('Chrome blocked the print window. Allow popups for this site and try again.')
      return
    }

    previewWindow.document.open()
    previewWindow.document.write(previewHtml)
    previewWindow.document.close()

    const finishOpen = () => {
      previewWindow.focus()
      if (mode === 'print') {
        window.setTimeout(() => {
          previewWindow.focus()
          previewWindow.print()
        }, 250)
      }
    }

    if (previewWindow.document.readyState === 'complete') {
      finishOpen()
      return
    }

    previewWindow.onload = finishOpen
  }

  // ── Populate form from selected breach alert ──────────────────────────────
  const handleBreachSelect = (breachId: string) => {
    const breach = breachOptions.find(b => b.id === breachId)
    if (!breach) return
    setForm(f => ({
      ...f,
      breach_alert_id: breachId,
      observation_id: breach.observation_id || f.observation_id,
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
      {/* When to use this — contextual help panel */}
      <div className="mb-3">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowHelp(h => !h)}
          aria-expanded={showHelp}
        >
          <Scale className="h-3.5 w-3.5" />
          {showHelp ? 'Hide guidance' : 'When to issue an Infringement Notice'}
        </button>
        {showHelp && (
          <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm space-y-2">
            <p className="font-semibold text-blue-800">Infringement Notice — when and how</p>
            <ul className="space-y-1.5 text-blue-900 list-disc list-inside">
              <li>Confirmed Freedom Camping Act breach (vehicle exceeded zone's stay limit or lacks self-contained certification).</li>
              <li>Issue after a Warning Notice has been ignored, or for serious first breaches at your discretion.</li>
              <li>Default fine: <span className="font-semibold">NZD $200</span> (FCA 2011 s.20). Amounts must match the bylaw schedule for your zone.</li>
              <li>Service methods: <span className="font-medium">Hand</span> (immediate), <span className="font-medium">Post</span> (allow 7 working days for service), <span className="font-medium">Email</span> (requires recipient consent).</li>
              <li>The notice is legally enforceable from the date of service. Always print and retain a copy.</li>
              <li>If not paid within 28 days, remind the system status should progress to <code>reminder_sent</code>, then <code>court_referred</code>.</li>
            </ul>
            <p className="text-blue-700 text-xs mt-1">Full guide: <code>docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md</code> · Legal reference: <code>docs/LEGAL_BASIS_REFERENCE.md</code></p>
          </div>
        )}
      </div>
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
          <Button
            variant="outline"
            onClick={() => toast.info('Manual notices are disabled. Open a historical observation or select a breach alert to issue a notice.')}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> Issue From Evidence Only
          </Button>
        )}
      </div>

      {issueErrorDetail && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-red-800">Latest Issue Notice Error</CardTitle>
            <CardDescription className="text-red-700">
              Copy and paste this exact error so we can diagnose the backend response.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-end mb-2">
              <Button type="button" variant="outline" size="sm" onClick={copyIssueError} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                Copy Error
              </Button>
            </div>
            <Textarea readOnly value={issueErrorDetail} className="min-h-[80px] bg-white font-mono text-xs" />
          </CardContent>
        </Card>
      )}

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
      <Dialog open={showIssueDialog} onOpenChange={setShowIssueDialog}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue Infringement Notice</DialogTitle>
            <DialogDescription>
              Creates a formal NZD fine under the Freedom Camping Act 2011 from a recorded observation only.
              Manual notices are disabled.
            </DialogDescription>
            {prefillingFromObservation && (
              <p className="text-xs text-muted-foreground">Loading historical observation details...</p>
            )}
            {!prefillingFromObservation && form.observation_id && (
              <p className="text-xs text-blue-700">Linked observation: {form.observation_id}</p>
            )}
            {!prefillingFromObservation && !form.observation_id && (
              <p className="text-xs text-amber-700">Select a breach alert with recorded evidence or open this page from a historical observation link.</p>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Vehicle Make</Label>
                <Input
                  value={form.vehicle_make}
                  onChange={e => setForm(f => ({ ...f, vehicle_make: e.target.value }))}
                  placeholder="e.g. Toyota"
                />
              </div>
              <div className="space-y-1">
                <Label>Vehicle Model</Label>
                <Input
                  value={form.vehicle_model}
                  onChange={e => setForm(f => ({ ...f, vehicle_model: e.target.value }))}
                  placeholder="e.g. Hiace"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Offence Type <span className="text-red-500">*</span></Label>
              <Select
                value={form.offence_description}
                onValueChange={v => {
                  const presets: Record<string, { desc: string; basis: string; fee: number }> = {
                    'Freedom camping in a prohibited area': { desc: 'Freedom camping in a prohibited area', basis: 'Freedom Camping Act 2011 s20(1)(a)', fee: 40000 },
                    'Camping in breach of restrictions': { desc: 'Camping in breach of restrictions (nights/conditions)', basis: 'Freedom Camping Act 2011 s20(1)(b)', fee: 40000 },
                    'Failing to display a valid self-containment warrant': { desc: 'Failing to display a valid self-containment warrant (NZS 5465)', basis: 'Freedom Camping Act 2011 s20(1)(c)', fee: 20000 },
                    'Failing to leave when required by an officer': { desc: 'Failing to leave an area when directed by an enforcement officer', basis: 'Freedom Camping Act 2011 s20(1)(d)', fee: 40000 },
                    'Damaging land, flora or fauna while camping': { desc: 'Interfering with, or damaging, the land, flora, or fauna while freedom camping', basis: 'Freedom Camping Act 2011 s20(1)(e)', fee: 80000 },
                    'Improper disposal of waste while freedom camping': { desc: 'Improper disposal of waste while freedom camping', basis: 'Freedom Camping Act 2011 s20(1)(f)', fee: 40000 },
                    'custom': { desc: '', basis: form.legal_basis, fee: form.amount_cents },
                  }
                  const p = presets[v]
                  if (p && v !== 'custom') {
                    setForm(f => ({ ...f, offence_description: p.desc, legal_basis: p.basis, amount_cents: p.fee }))
                  } else {
                    setForm(f => ({ ...f, offence_description: '' }))
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select common offence or enter custom below..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Freedom camping in a prohibited area">$400 — Camping in prohibited area (s20(1)(a))</SelectItem>
                  <SelectItem value="Camping in breach of restrictions">$400 — Camping in breach of restrictions (s20(1)(b))</SelectItem>
                  <SelectItem value="Failing to display a valid self-containment warrant">$200 — No self-containment warrant displayed (s20(1)(c))</SelectItem>
                  <SelectItem value="Failing to leave when required by an officer">$400 — Failed to leave when directed (s20(1)(d))</SelectItem>
                  <SelectItem value="Damaging land, flora or fauna while camping">$800 — Damaging land/flora/fauna (s20(1)(e))</SelectItem>
                  <SelectItem value="Improper disposal of waste while freedom camping">$400 — Improper waste disposal (s20(1)(f))</SelectItem>
                  <SelectItem value="custom">Custom / enter manually below</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Offence Description <span className="text-red-500">*</span></Label>
              <Input
                value={form.offence_description}
                onChange={e => setForm(f => ({ ...f, offence_description: e.target.value }))}
                placeholder="Describe the alleged offence in detail"
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
                disabled={!form.observation_id}
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
                    <SelectItem value="20000">$200 — No warrant card displayed (s20(1)(c))</SelectItem>
                    <SelectItem value="40000">$400 — Prohibited area / breach of restrictions</SelectItem>
                    <SelectItem value="80000">$800 — Damaging land, flora or fauna</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payment Due</Label>
                <Input value={computedDueDateLabel} readOnly />
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
              {form.service_method === 'post' && (
                <div className="space-y-1 col-span-2">
                  <Label>Postal Address</Label>
                  <Textarea
                    value={form.recipient_address}
                    onChange={e => setForm(f => ({ ...f, recipient_address: e.target.value }))}
                    placeholder="Recipient postal address for service by post"
                    rows={2}
                  />
                </div>
              )}
            </div>
          </div>

          {issueErrorDetail && (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-red-800">Issue Notice Error</p>
                <Button type="button" variant="outline" size="sm" onClick={copyIssueError} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" />
                  Copy Error
                </Button>
              </div>
              <Textarea
                readOnly
                value={issueErrorDetail}
                className="min-h-[90px] bg-white font-mono text-xs"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIssueDialog(false)}>Cancel</Button>
            <Button onClick={handleIssue} disabled={issuing || !form.observation_id} className="gap-1.5">
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
            <DialogDescription>
              Chrome works best when this opens from a direct click. If the print tab does not open, allow popups for this site and try again.
            </DialogDescription>
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
            <Button variant="outline" onClick={() => openPreviewWindow('open')} className="gap-1.5">
              <Eye className="h-4 w-4" /> Open in Tab
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                if (!previewHtml) return
                const blob = new Blob([previewHtml], { type: 'text/html' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'infringement-notice.html'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download className="h-4 w-4" /> Download
            </Button>
            <Button
              onClick={() => openPreviewWindow('print')}
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
