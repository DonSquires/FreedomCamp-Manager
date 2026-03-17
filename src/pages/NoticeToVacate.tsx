import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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
  zone: { name: string } | null
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

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
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

  const orgId = user?.role === 'master' ? (organizationId || undefined) : user?.organization_id

  // Fetch notices
  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['notices-to-vacate', orgId, zoneId, dateFrom, dateTo, statusFilter],
    queryFn: async () => {
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

      if (orgId) q = q.eq('organization_id', orgId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (dateFrom) q = q.gte('issued_at', dateFrom)
      if (dateTo) q = q.lte('issued_at', dateTo + 'T23:59:59')
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as NoticeToVacateRecord[]
    },
    enabled: !!user,
    refetchInterval: 60000,
  })

  // Fetch zones for the issue form
  const { data: zones = [] } = useQuery({
    queryKey: ['zones-ntv', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', orgId!)
        .eq('is_active', true)
        .order('name')
      return (data || []) as Zone[]
    },
    enabled: !!orgId,
  })

  // Fetch pending breach alerts for pre-filling
  const { data: pendingBreaches = [] } = useQuery({
    queryKey: ['breaches-for-ntv', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, zone:zones!zone_id(name)')
        .eq('organization_id', orgId!)
        .in('status', ['pending', 'acknowledged'])
        .order('created_at', { ascending: false })
        .limit(50)
      return (data || []) as unknown as BreachAlert[]
    },
    enabled: !!orgId,
  })

  // Issue notice mutation
  const issueNotice = async () => {
    if (!form.zoneId || !form.plateNumber.trim()) {
      toast.error('Zone and plate number are required')
      return
    }
    setIssuing(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-notice-to-vacate', {
        body: {
          zoneId: form.zoneId,
          plateNumber: form.plateNumber.toUpperCase().trim(),
          nightsStayed: form.nightsStayed ? parseInt(form.nightsStayed) : undefined,
          breachDetails: form.breachDetails ? { notes: form.breachDetails } : undefined,
          issuedBy: user!.id,
          deliveryMethod: form.deliveryMethod,
          deliverToEmail: form.deliverToEmail || undefined,
          breachAlertId: form.breachAlertId || undefined,
        },
      })

      if (error) throw new Error(error.message)
      if (!data?.success) throw new Error(data?.error || 'Failed to issue notice')

      toast.success(`✅ Notice ${data.notice.reference_number} issued`)
      setPreviewHtml(data.notice.html)
      setIsIssueOpen(false)
      setForm({ zoneId: '', plateNumber: '', nightsStayed: '', breachDetails: '', deliveryMethod: 'printed_onsite', deliverToEmail: '', breachAlertId: '' })
      queryClient.invalidateQueries({ queryKey: ['notices-to-vacate'] })
    } catch (err: any) {
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
        zoneId: zones.find(z => z.name === breach.zone?.name)?.id || f.zoneId,
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
      <Dialog open={isIssueOpen} onOpenChange={setIsIssueOpen}>
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
