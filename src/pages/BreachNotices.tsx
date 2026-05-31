import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import {
  Bell,
  Search,
  CheckCircle,
  Clock,
  AlertTriangle,
  Car,
  MapPin,
  Calendar,
  FileText,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'

interface BreachNotice {
  id: string
  plate_number: string | null
  breach_type: string
  status: string
  created_at: string
  resolved_at: string | null
  notified_at: string | null
  breach_details: any
  zone: { name: string } | null
  enforcement_actions: { id: string; action_type: string; status: string }[]
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending:              { label: 'Pending',            variant: 'secondary' },
  acknowledged:         { label: 'Acknowledged',       variant: 'default' },
  enforcement_started:  { label: 'Enforcement Started', variant: 'default' },
  resolved:             { label: 'Resolved',           variant: 'secondary' },
  dismissed:            { label: 'Dismissed',          variant: 'outline' },
}

const toTitleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function BreachNotices() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [breachTypeFilter, setBreachTypeFilter] = useState('all')
  const [selectedBreach, setSelectedBreach] = useState<BreachNotice | null>(null)
  const [resolveNotes, setResolveNotes] = useState('')
  const [resolveStatus, setResolveStatus] = useState<'resolved' | 'dismissed'>('resolved')
  const [isResolveOpen, setIsResolveOpen] = useState(false)

  const orgId = (user?.role === 'master' || user?.role === 'grand_master') ? (organizationId || undefined) : user?.organization_id

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['breach-notices', orgId, zoneId, startDate, endDate, statusFilter, breachTypeFilter],
    queryFn: async () => {
      const applyFilters = (baseQuery: any) => {
        let q = baseQuery.order('created_at', { ascending: false }).limit(200)

        if (orgId) q = q.eq('organization_id', orgId)
        if (zoneId) q = q.eq('zone_id', zoneId)
        if (startDate) q = q.gte('created_at', startDate)
        if (endDate) q = q.lte('created_at', endDate)

        if (statusFilter === 'active') {
          q = q.in('status', ['pending', 'acknowledged', 'enforcement_started'])
        } else if (statusFilter !== 'all') {
          q = q.eq('status', statusFilter)
        }

        if (breachTypeFilter !== 'all') q = q.eq('breach_type', breachTypeFilter)
        return q
      }

      const richSelect = `
        id, plate_number, breach_type, status, created_at, resolved_at, notified_at, breach_details,
        zone:zones!zone_id(name),
        enforcement_actions(id, action_type, status)
      `

      const baseSelect = `
        id, plate_number, breach_type, status, created_at, resolved_at, notified_at, breach_details
      `

      let { data, error } = await applyFilters(
        supabase.from('breach_alerts').select(richSelect),
      )

      if (error) {
        const fallback = await applyFilters(
          supabase.from('breach_alerts').select(baseSelect),
        )
        data = (fallback.data || []).map((row: any) => ({
          ...row,
          zone: null,
          enforcement_actions: [],
        }))
        error = fallback.error
      }
      if (error) throw error
      return (data || []) as unknown as BreachNotice[]
    },
    enabled: !!user,
    refetchInterval: 30000,
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const updates: any = { status }
      if (['resolved', 'dismissed'].includes(status)) {
        updates.resolved_at = new Date().toISOString()
      }
      if (notes) updates.breach_details = { ...(selectedBreach?.breach_details || {}), resolution_notes: notes }
      const { error } = await (supabase.from('breach_alerts') as any).update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Breach notice updated')
      setIsResolveOpen(false)
      setResolveNotes('')
      queryClient.invalidateQueries({ queryKey: ['breach-notices'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const filtered = notices.filter(n => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      n.plate_number?.toLowerCase().includes(q) ||
      n.zone?.name?.toLowerCase().includes(q) ||
      n.breach_type?.toLowerCase().includes(q)
    )
  })

  const stats = {
    total: notices.length,
    pending: notices.filter(n => n.status === 'pending').length,
    enforcement: notices.filter(n => n.status === 'enforcement_started').length,
    resolved: notices.filter(n => ['resolved', 'dismissed'].includes(n.status)).length,
  }

  const isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role || '')

  return (
    <AppLayout title="Breach Notices" description="All breach alerts with enforcement status">
      <GlobalFilterRibbon showZoneFilter showDateFilter />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',       value: stats.total,      icon: <Bell className="h-5 w-5 text-blue-500" /> },
          { label: 'Pending',     value: stats.pending,    icon: <Clock className="h-5 w-5 text-orange-500" /> },
          { label: 'Enforcement', value: stats.enforcement, icon: <AlertTriangle className="h-5 w-5 text-red-500" /> },
          { label: 'Resolved',    value: stats.resolved,   icon: <CheckCircle className="h-5 w-5 text-green-500" /> },
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
            placeholder="Search plate, zone or breach type…"
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
            <SelectItem value="active">Active</SelectItem>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={breachTypeFilter} onValueChange={setBreachTypeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Breach type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="consecutive_nights">Consecutive Nights</SelectItem>
            <SelectItem value="monthly_limit">Monthly Limit</SelectItem>
            <SelectItem value="self_contained">Self Contained</SelectItem>
            <SelectItem value="after_hours">After Hours</SelectItem>
            <SelectItem value="day_visit_violation">Day Visit</SelectItem>
            <SelectItem value="allowed_days_violation">Allowed Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <PaperworkSearchAnimation size="sm" text="Loading breach notices…" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Bell className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold text-muted-foreground">No breach notices found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(notice => {
            const meta = STATUS_META[notice.status] || STATUS_META.pending
            const isActive = ['pending', 'acknowledged', 'enforcement_started'].includes(notice.status)
            const hasEnforcement = notice.enforcement_actions?.length > 0

            return (
              <Card key={notice.id} className={isActive ? 'border-orange-200' : ''}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {notice.plate_number && (
                          <span className="font-mono font-bold">{notice.plate_number}</span>
                        )}
                        <Badge variant="outline" className="text-xs">{toTitleCase(notice.breach_type)}</Badge>
                        <Badge variant={meta.variant} className="text-xs">{meta.label}</Badge>
                        {hasEnforcement && (
                          <Badge variant="secondary" className="text-xs">
                            {notice.enforcement_actions.length} action{notice.enforcement_actions.length > 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {notice.zone && (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{notice.zone.name}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />{formatDateTime(notice.created_at)}
                        </span>
                        {notice.notified_at && (
                          <span className="flex items-center gap-1">
                            <Bell className="h-3 w-3" />Notified {formatDateTime(notice.notified_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    {isAdmin && isActive && (
                      <div className="flex gap-2 shrink-0">
                        {notice.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus.mutate({ id: notice.id, status: 'acknowledged' })}
                          >
                            Acknowledge
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedBreach(notice)
                            setIsResolveOpen(true)
                          }}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Resolve
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Resolve dialog */}
      <Dialog open={isResolveOpen} onOpenChange={setIsResolveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resolve Breach</DialogTitle>
            <DialogDescription>
              {selectedBreach?.plate_number} — {selectedBreach && toTitleCase(selectedBreach.breach_type)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Resolution</Label>
              <Select value={resolveStatus} onValueChange={v => setResolveStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolved">✅ Resolved</SelectItem>
                  <SelectItem value="dismissed">🚫 Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                value={resolveNotes}
                onChange={e => setResolveNotes(e.target.value)}
                placeholder="Resolution notes…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResolveOpen(false)}>Cancel</Button>
            <Button
              onClick={() =>
                updateStatus.mutate({
                  id: selectedBreach!.id,
                  status: resolveStatus,
                  notes: resolveNotes,
                })
              }
              disabled={updateStatus.isPending}
            >
              {updateStatus.isPending ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
