import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import {
  FileText,
  Plus,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Printer,
  Mail,
  Car,
  MapPin,
  Calendar,
  AlertTriangle,
  Eye,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface NoticeToVacateRecord {
  id: string
  reference_number: string
  plate_number: string
  breach_reason: string
  nights_stayed: number | null
  status: string
  delivery_method: string
  issued_at: string
  vacate_deadline: string
  notice_html: string | null
  zone: { name: string } | null
  issued_by_user: { first_name: string; last_name: string } | null
  breach_alert: { id: string; breach_type: string; status: string } | null
}

interface Zone {
  id: string
  name: string
}

interface BreachAlert {
  id: string
  plate_number: string
  breach_type: string
  zone_id: string | null
  zone: { name: string } | null
}

interface ZoneNoticeContactConfig {
  objections_email: string | null
  objections_postal_address: string | null
  org_phone: string | null
  org_email: string | null
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  issued:    { label: 'Issued',    variant: 'default' },
  complied:  { label: 'Complied', variant: 'secondary' },
  expired:   { label: 'Expired',  variant: 'outline' },
  escalated: { label: 'Escalated', variant: 'destructive' },
  voided:    { label: 'Voided',   variant: 'outline' },
}

const DELIVERY_OPTIONS = [
  { value: 'printed_onsite',    label: 'Printed / Left on vehicle' },
  { value: 'handed_in_person',  label: 'Handed in person' },
  { value: 'email',             label: 'Email' },
  { value: 'officer_delivery',  label: 'Via officer' },
]

export default function NoticeToVacate() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showHelp, setShowHelp] = useState(false)
  const [isIssueOpen, setIsIssueOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  // Issue form state
  const [form, setForm] = useState({
    zoneId: '',
    plateNumber: '',
    nightsStayed: '',
    breachDetails: '',
    deliveryMethod: 'printed_onsite',
    deliverToEmail: '',
    breachAlertId: '',
  })
  const [issuing, setIssuing] = useState(false)
  const [issueFeedback, setIssueFeedback] = useState<null | { type: 'loading' | 'success' | 'error'; message: string }>(null)

  // Auto-fill form and open issue dialog when arriving from BreachAlerts page via
  // /notice-to-vacate?breach_alert_id=X&plate_number=Y&zone_id=Z
  useEffect(() => {
    const breachAlertId = searchParams.get('breach_alert_id')
    const plateNumber = searchParams.get('plate_number')
    const paramZoneId = searchParams.get('zone_id')

    if (breachAlertId || plateNumber || paramZoneId) {
      setForm(prev => ({
        ...prev,
        breachAlertId: breachAlertId ?? prev.breachAlertId,
        plateNumber: plateNumber ?? prev.plateNumber,
        zoneId: paramZoneId ?? prev.zoneId,
      }))
      setIsIssueOpen(true)
      // Clean up URL params so a refresh doesn't re-open the dialog
      setSearchParams(new URLSearchParams(), { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Grandmaster and master can pick org; others use their primary org
  const isGrandmaster = user?.role === 'grand_master'
  const isMaster = user?.role === 'master'
  const effectiveOrgId = (isGrandmaster || isMaster) ? (organizationId || user?.organization_id) : user?.organization_id

  // Fetch notices
  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['notices-to-vacate', effectiveOrgId, zoneId, dateFrom, dateTo, statusFilter],
    queryFn: async () => {
      // Fail-safe: ensure orgId is always defined before query
      if (!effectiveOrgId) return []

      let q = supabase
        .from('notices_to_vacate')
        .select(`
          id, reference_number, plate_number, breach_reason, nights_stayed,
          status, delivery_method, issued_at, vacate_deadline, notice_html,
          zone:zones!zone_id(name),
          issued_by_user:user_profiles!issued_by(first_name, last_name),
          breach_alert:breach_alerts!breach_alert_id(id, breach_type, status)
        `)
        .order('issued_at', { ascending: false })
        .limit(200)
        .eq('organization_id', effectiveOrgId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (dateFrom) q = q.gte('issued_at', dateFrom)
      if (dateTo) q = q.lte('issued_at', dateTo + 'T23:59:59')
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as NoticeToVacateRecord[]
    },
    enabled: !!user,
    staleTime: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    refetchInterval: 60000,
  })

  // Fetch zones for the issue form
  const { data: zones = [] } = useQuery({
    queryKey: ['zones-ntv', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', effectiveOrgId!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data || []) as Zone[]
    },
    enabled: !!effectiveOrgId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  // Fetch pending breach alerts for pre-filling
  const { data: pendingBreaches = [] } = useQuery({
    queryKey: ['breaches-for-ntv', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, zone_id, zone:zones!zone_id(name)')
        .eq('organization_id', effectiveOrgId!)
        .in('status', ['pending', 'acknowledged'])
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data || []) as unknown as BreachAlert[]
    },
    enabled: !!effectiveOrgId,
    staleTime: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  const { data: zoneNoticeContact } = useQuery({
    queryKey: ['zone-notice-contact', form.zoneId],
    queryFn: async () => {
      if (!form.zoneId) return null
      const { data, error } = await supabase
        .from('zone_legal_config')
        .select('objections_email, objections_postal_address, org_phone, org_email')
        .eq('zone_id', form.zoneId)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as ZoneNoticeContactConfig | null
    },
    enabled: !!form.zoneId && isIssueOpen,
    refetchOnWindowFocus: true,
    staleTime: 30000,
  })

  // Issue notice mutation
  const issueNotice = async () => {
    if (!form.zoneId || !form.plateNumber.trim()) {
      setIssueFeedback({ type: 'error', message: 'Zone and plate number are required.' })
      toast.error('Zone and plate number are required')
      return
    }
    if (form.deliveryMethod === 'email' && !form.deliverToEmail?.trim()) {
      setIssueFeedback({ type: 'error', message: 'Recipient email address is required for email delivery.' })
      toast.error('Recipient email address is required when delivering by email')
      return
    }
    if (!user?.id) {
      setIssueFeedback({ type: 'error', message: 'Your session is missing user details. Please sign in again.' })
      toast.error('Session issue detected. Please sign in again.')
      return
    }

    setIssueFeedback({ type: 'loading', message: 'Generating notice, please wait…' })
    setIssuing(true)
    try {
      const { data, error } = await edgeFunctions.generateNoticeToVacate({
        zoneId: form.zoneId,
        plateNumber: form.plateNumber.toUpperCase().trim(),
        nightsStayed: form.nightsStayed ? parseInt(form.nightsStayed) : undefined,
        breachDetails: form.breachDetails ? { notes: form.breachDetails } : undefined,
        issuedBy: user.id,
        deliveryMethod: form.deliveryMethod,
        deliverToEmail: form.deliverToEmail || undefined,
        breachAlertId: form.breachAlertId || undefined,
      })

      if (error) {
        throw new Error(typeof error === 'object' && error && 'message' in error ? (error as any).message : String(error) || 'Failed to issue notice')
      }

      const referenceNumber = data.notice?.reference_number || 'generated'
      setIssueFeedback({ type: 'success', message: `Notice ${referenceNumber} issued successfully.` })
      toast.success(`✅ Notice ${referenceNumber} issued`)
      if (data.notice?.html) {
        setPreviewHtml(data.notice.html)
      }
      setIsIssueOpen(false)
      setIssueFeedback(null)
      setForm({ zoneId: '', plateNumber: '', nightsStayed: '', breachDetails: '', deliveryMethod: 'printed_onsite', deliverToEmail: '', breachAlertId: '' })
      queryClient.invalidateQueries({ queryKey: ['notices-to-vacate'] })
    } catch (err: any) {
      setIssueFeedback({ type: 'error', message: err.message || 'Failed to issue notice' })
      toast.error(err.message || 'Failed to issue notice')
    } finally {
      setIssuing(false)
    }
  }

  // Update status mutation
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (supabase.from('notices_to_vacate') as any)
        .update({ status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['notices-to-vacate'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const filtered = notices.filter(n => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      n.plate_number?.toLowerCase().includes(q) ||
      n.reference_number?.toLowerCase().includes(q) ||
      n.zone?.name?.toLowerCase().includes(q)
    )
  })

  // Pre-fill form from breach alert selection
  const handleBreachSelect = (breachId: string) => {
    const breach = pendingBreaches.find(b => b.id === breachId)
    if (breach) {
      setForm(f => ({
        ...f,
        breachAlertId: breach.id,
        plateNumber: breach.plate_number || '',
        zoneId: breach.zone_id || f.zoneId,
      }))
    }
  }

  const stats = {
    total: notices.length,
    issued: notices.filter(n => n.status === 'issued').length,
    complied: notices.filter(n => n.status === 'complied').length,
    escalated: notices.filter(n => n.status === 'escalated').length,
  }

  const isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role || '')

  return (
    <AppLayout title="Notices to Vacate" description="Issue and track legal notices to vacate">
      <GlobalFilterRibbon showDateFilter showZoneFilter />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: stats.total, icon: <FileText className="h-5 w-5 text-blue-600" /> },
          { label: 'Issued', value: stats.issued, icon: <Clock className="h-5 w-5 text-orange-500" /> },
          { label: 'Complied', value: stats.complied, icon: <CheckCircle className="h-5 w-5 text-green-600" /> },
          { label: 'Escalated', value: stats.escalated, icon: <AlertTriangle className="h-5 w-5 text-red-600" /> },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* When to use this — contextual help panel */}
      <div className="mb-3">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowHelp(h => !h)}
          aria-expanded={showHelp}
        >
          <Info className="h-3.5 w-3.5" />
          {showHelp ? 'Hide guidance' : 'When to issue a Notice to Vacate'}
        </button>
        {showHelp && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm space-y-2">
            <p className="font-semibold text-amber-800">Notice to Vacate — when and how</p>
            <ul className="space-y-1.5 text-amber-900 list-disc list-inside">
              <li>The vehicle has exceeded the zone's maximum consecutive nights or total monthly nights — a confirmed breach.</li>
              <li>Issued to formally require the vehicle to leave the zone by a specified deadline (typically <span className="font-semibold">24–48 hours</span> from issue).</li>
              <li>Delivery methods: <span className="font-medium">Printed on-site</span> (place on vehicle), <span className="font-medium">Email</span>, or <span className="font-medium">Hand-delivered</span>. Always record the method used.</li>
              <li>If the vehicle has not moved by the deadline, escalate: update status to <code>escalated</code> and proceed to Infringement Notice or tow request as directed by your supervisor.</li>
              <li>A homeless-flagged vehicle requires supervisor approval before escalation — do not tow without explicit authorisation.</li>
            </ul>
            <p className="text-amber-700 text-xs mt-1">Full guide: <code>docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md</code> · Escalation flowchart: <code>docs/ENFORCEMENT_ESCALATION_DECISION_TREE.md</code></p>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by plate, reference or zone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <Button onClick={() => setIsIssueOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Issue Notice
          </Button>
        )}
      </div>

      {/* Notices list */}
      {isLoading ? (
        <PaperworkSearchAnimation size="sm" text="Loading notices…" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold text-muted-foreground">No notices found</p>
            <p className="text-sm text-muted-foreground">Issue a new notice using the button above</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(notice => {
            const meta = STATUS_META[notice.status] || STATUS_META.issued
            const overdue = notice.status === 'issued' && new Date(notice.vacate_deadline) < new Date()
            return (
              <Card key={notice.id} className={overdue ? 'border-red-300 bg-red-50' : ''}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Car className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono font-bold text-lg">{notice.plate_number}</span>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {overdue && <Badge variant="destructive">DEADLINE PASSED</Badge>}
                        <span className="text-xs text-muted-foreground font-mono">{notice.reference_number}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        {notice.zone && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {notice.zone.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          Issued {formatDateTime(notice.issued_at)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Vacate by {formatDateTime(notice.vacate_deadline)}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-2">{notice.breach_reason}</p>
                      <div className="text-xs text-muted-foreground">
                        Delivery: {DELIVERY_OPTIONS.find(d => d.value === notice.delivery_method)?.label || notice.delivery_method}
                        {notice.issued_by_user && ` · By ${notice.issued_by_user.first_name} ${notice.issued_by_user.last_name}`}
                        {notice.nights_stayed != null && ` · ${notice.nights_stayed} nights`}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      {notice.notice_html && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewHtml(notice.notice_html!)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Preview
                        </Button>
                      )}
                      {isAdmin && notice.status === 'issued' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'complied' })}
                          >
                            <CheckCircle className="h-3.5 w-3.5 mr-1" />
                            Complied
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'escalated' })}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                            Escalate
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Issue Notice Dialog */}
      <Dialog
        open={isIssueOpen}
        onOpenChange={(open) => {
          setIsIssueOpen(open)
          if (!open) setIssueFeedback(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Issue Notice to Vacate
            </DialogTitle>
            <DialogDescription>
              A legal notice will be generated using the zone's legal configuration. The zone must have an authorized signatory configured.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Pre-fill from breach */}
            {pendingBreaches.length > 0 && (
              <div className="space-y-1.5">
                <Label>Pre-fill from breach alert (optional)</Label>
                <Select onValueChange={handleBreachSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a breach alert…" />
                  </SelectTrigger>
                  <SelectContent>
                    {pendingBreaches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.plate_number} — {b.breach_type} at {b.zone?.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Zone *</Label>
              <Select value={form.zoneId} onValueChange={v => setForm(f => ({ ...f, zoneId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select zone…" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.zoneId && (
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
                <p className="text-sm font-medium">Dispute / review contacts shown on notice</p>
                {zoneNoticeContact?.objections_email && (
                  <p className="text-xs text-muted-foreground">Email: {zoneNoticeContact.objections_email}</p>
                )}
                {zoneNoticeContact?.org_phone && (
                  <p className="text-xs text-muted-foreground">Phone: {zoneNoticeContact.org_phone}</p>
                )}
                {(zoneNoticeContact?.objections_postal_address || zoneNoticeContact?.org_email) && (
                  <p className="text-xs text-muted-foreground">
                    Postal / fallback contact: {zoneNoticeContact.objections_postal_address || zoneNoticeContact.org_email}
                  </p>
                )}
                {!zoneNoticeContact?.objections_email &&
                  !zoneNoticeContact?.org_phone &&
                  !zoneNoticeContact?.objections_postal_address &&
                  !zoneNoticeContact?.org_email && (
                    <p className="text-xs text-amber-700">
                      No dispute contact channels are configured for this zone yet. Add objections email/postal or org phone/email in zone legal config.
                    </p>
                  )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Plate Number *</Label>
                <Input
                  value={form.plateNumber}
                  onChange={e => setForm(f => ({ ...f, plateNumber: e.target.value.toUpperCase() }))}
                  placeholder="ABC123"
                  className="font-mono uppercase"
                  maxLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nights Stayed</Label>
                <Input
                  type="number"
                  min="1"
                  max="999"
                  value={form.nightsStayed}
                  onChange={e => setForm(f => ({ ...f, nightsStayed: e.target.value }))}
                  placeholder="e.g. 5"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Additional Breach Details</Label>
              <Textarea
                value={form.breachDetails}
                onChange={e => setForm(f => ({ ...f, breachDetails: e.target.value }))}
                placeholder="Optional notes about the breach…"
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Delivery Method</Label>
              <Select
                value={form.deliveryMethod}
                onValueChange={v => setForm(f => ({ ...f, deliveryMethod: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_OPTIONS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.deliveryMethod === 'email' && (
              <div className="space-y-1.5">
                <Label>Recipient Email</Label>
                <Input
                  type="email"
                  value={form.deliverToEmail}
                  onChange={e => setForm(f => ({ ...f, deliverToEmail: e.target.value }))}
                  placeholder="recipient@example.com"
                />
              </div>
            )}

            {issueFeedback && (
              <div
                className={`rounded-md border px-3 py-2 text-sm ${
                  issueFeedback.type === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : issueFeedback.type === 'success'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-blue-200 bg-blue-50 text-blue-700'
                }`}
              >
                {issueFeedback.message}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsIssueOpen(false)}>Cancel</Button>
            <Button onClick={issueNotice} disabled={issuing}>
              {issuing ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Issue Notice
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notice Preview Dialog */}
      <Dialog open={!!previewHtml} onOpenChange={() => setPreviewHtml(null)}>
        <DialogContent className="max-w-4xl h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" />
              Notice Preview
            </DialogTitle>
            <DialogDescription>
              Chrome works best when this opens from a direct click. If the print tab does not open, allow popups for this site and try again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden h-full">
            <iframe
              srcDoc={previewHtml || ''}
              className="w-full h-[70vh] border rounded-lg"
              title="Notice to Vacate Preview"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewHtml(null)}>Close</Button>
            <Button variant="outline" onClick={() => openPreviewWindow('open')}>
              <Eye className="h-4 w-4 mr-2" />
              Open in Tab
            </Button>
            <Button
              onClick={() => openPreviewWindow('print')}
            >
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
