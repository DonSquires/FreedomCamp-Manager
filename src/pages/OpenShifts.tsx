/**
 * OpenShifts — Deputy-style open-shift marketplace.
 * Admins post shifts that need coverage; officers claim them from the
 * FieldOfficerPortal.  Admins see the full board here with create / cancel
 * controls and a live claim status for each shift.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useZones } from '@/hooks/useZones'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  CalendarPlus,
  Plus,
  MapPin,
  Clock,
  User,
  XCircle,
  CheckCircle,
  AlertTriangle,
  Calendar,
} from 'lucide-react'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpenShift {
  id: string
  organization_id: string
  zone_id: string | null
  shift_date: string
  shift_type: 'day' | 'night' | 'custom'
  start_time: string | null
  end_time: string | null
  title: string
  description: string | null
  requirements: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'open' | 'filled' | 'cancelled'
  claimed_by: string | null
  claimed_at: string | null
  zone: { name: string } | null
  claimed_by_user: { first_name: string; last_name: string } | null
  created_by_user: { first_name: string; last_name: string } | null
}

interface ShiftForm {
  zone_id: string
  shift_date: string
  shift_type: 'day' | 'night' | 'custom'
  start_time: string
  end_time: string
  title: string
  description: string
  requirements: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
}

const emptyForm = (): ShiftForm => ({
  zone_id: '',
  shift_date: new Date().toISOString().split('T')[0],
  shift_type: 'day',
  start_time: '',
  end_time: '',
  title: '',
  description: '',
  requirements: '',
  priority: 'normal',
})

// ── Badge helpers ─────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; className: string }> = {
  open:      { label: 'Open',      className: 'border-blue-300   text-blue-700   bg-blue-50'   },
  filled:    { label: 'Filled',    className: 'border-green-300  text-green-700  bg-green-50'  },
  cancelled: { label: 'Cancelled', className: 'border-gray-300   text-gray-500   bg-gray-50'   },
}

const PRIORITY_META: Record<string, { label: string; className: string }> = {
  low:    { label: 'Low',    className: 'border-gray-300  text-gray-500  bg-gray-50'   },
  normal: { label: 'Normal', className: 'border-blue-300  text-blue-700  bg-blue-50'   },
  high:   { label: 'High',   className: 'border-orange-300 text-orange-700 bg-orange-50' },
  urgent: { label: 'Urgent', className: 'border-red-300   text-red-700   bg-red-50'    },
}

function formatShiftTime(dateStr: string, timeStr: string | null): string {
  if (!timeStr) return dateStr
  return new Date(timeStr).toLocaleString('en-NZ', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
    timeZone: 'Pacific/Auckland',
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OpenShifts() {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'filled' | 'cancelled'>('all')
  const [form, setForm] = useState<ShiftForm>(emptyForm())

  const { data: zones = [] } = useZones({ organizationId: operationalOrganizationId ?? undefined })

  // ── Fetch open shifts ──────────────────────────────────────────────────────
  const { data: shifts = [], isLoading } = useQuery<OpenShift[]>({
    queryKey: ['open-shifts', operationalOrganizationId, statusFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('open_shifts')
        .select(`
          id, organization_id, zone_id, shift_date, shift_type,
          start_time, end_time, title, description, requirements,
          priority, status, claimed_by, claimed_at,
          zone:zones!zone_id(name),
          claimed_by_user:user_profiles!claimed_by(first_name, last_name),
          created_by_user:user_profiles!created_by(first_name, last_name)
        `)
        .eq('organization_id', operationalOrganizationId ?? '')
        .order('shift_date', { ascending: true })

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as OpenShift[]
    },
    enabled: !!operationalOrganizationId,
  })

  // ── Summary ────────────────────────────────────────────────────────────────
  const openCount   = shifts.filter(s => s.status === 'open').length
  const filledCount = shifts.filter(s => s.status === 'filled').length
  const urgentCount = shifts.filter(s => s.status === 'open' && s.priority === 'urgent').length

  // ── Create mutation ────────────────────────────────────────────────────────
  const createShift = useMutation({
    mutationFn: async (f: ShiftForm) => {
      const payload: any = {
        organization_id: operationalOrganizationId,
        created_by:      user?.id,
        title:           f.title,
        shift_date:      f.shift_date,
        shift_type:      f.shift_type,
        priority:        f.priority,
        description:     f.description || null,
        requirements:    f.requirements || null,
        zone_id:         f.zone_id || null,
        start_time:      f.start_time ? new Date(`${f.shift_date}T${f.start_time}`).toISOString() : null,
        end_time:        f.end_time   ? new Date(`${f.shift_date}T${f.end_time}`).toISOString()   : null,
      }
      const { error } = await (supabase as any).from('open_shifts').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Open shift posted')
      qc.invalidateQueries({ queryKey: ['open-shifts'] })
      setShowCreate(false)
      setForm(emptyForm())
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to create open shift'),
  })

  // ── Cancel mutation ────────────────────────────────────────────────────────
  const cancelShift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('open_shifts').update({ status: 'cancelled' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Shift cancelled')
      qc.invalidateQueries({ queryKey: ['open-shifts'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to cancel shift'),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (!form.shift_date)   { toast.error('Date is required');  return }
    createShift.mutate(form)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarPlus className="h-6 w-6 text-primary" />
              Open Shifts
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Post uncovered shifts so officers can claim them directly from the field portal
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" /> Post Open Shift
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Needs Coverage', value: openCount,   icon: Clock,         colour: 'text-blue-600'   },
            { label: 'Filled',         value: filledCount, icon: CheckCircle,   colour: 'text-green-600'  },
            { label: 'Urgent Open',    value: urgentCount, icon: AlertTriangle, colour: 'text-red-600'    },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${colour}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-2 flex-wrap">
          {(['all', 'open', 'filled', 'cancelled'] as const).map(s => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? 'default' : 'outline'}
              className="capitalize"
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All Shifts' : s}
            </Button>
          ))}
        </div>

        {/* Shifts table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shift</TableHead>
                  <TableHead><MapPin className="inline h-3.5 w-3.5 mr-1" />Zone</TableHead>
                  <TableHead><Calendar className="inline h-3.5 w-3.5 mr-1" />Date</TableHead>
                  <TableHead><Clock className="inline h-3.5 w-3.5 mr-1" />Time</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><User className="inline h-3.5 w-3.5 mr-1" />Claimed By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Loading open shifts…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && shifts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No open shifts found. Post a shift to get started.
                    </TableCell>
                  </TableRow>
                )}
                {shifts.map(s => {
                  const sm = STATUS_META[s.status]
                  const pm = PRIORITY_META[s.priority]
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{s.title}</div>
                        {s.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[180px]">{s.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{s.zone?.name ?? <span className="text-muted-foreground">Any</span>}</TableCell>
                      <TableCell className="text-sm">{new Date(s.shift_date).toLocaleDateString('en-NZ', { weekday: 'short', month: 'short', day: 'numeric' })}</TableCell>
                      <TableCell className="text-sm">
                        {s.start_time ? (
                          <span>
                            {formatShiftTime(s.shift_date, s.start_time)}
                            {s.end_time && ` – ${new Date(s.end_time).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Pacific/Auckland' })}`}
                          </span>
                        ) : (
                          <span className="capitalize text-muted-foreground">{s.shift_type}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={pm.className}>{pm.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={sm.className}>{sm.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.claimed_by_user
                          ? `${s.claimed_by_user.first_name} ${s.claimed_by_user.last_name}`
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.status === 'open' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => cancelShift.mutate(s.id)}
                            disabled={cancelShift.isPending}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) setForm(emptyForm()) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Post Open Shift</DialogTitle>
            <DialogDescription>
              Officers will see this shift in the field portal and can claim it.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Freedom camping patrol – Kairākau Beach"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={form.shift_date} onChange={e => setForm(f => ({ ...f, shift_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Shift Type</Label>
                <Select value={form.shift_type} onValueChange={v => setForm(f => ({ ...f, shift_type: v as ShiftForm['shift_type'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="night">Night</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Zone</Label>
                <Select value={form.zone_id} onValueChange={v => setForm(f => ({ ...f, zone_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Any zone" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any zone</SelectItem>
                    {zones.map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as ShiftForm['priority'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="Brief description of what the officer will be doing…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Requirements</Label>
              <Textarea
                placeholder="Special skills, equipment, or certifications required…"
                value={form.requirements}
                onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))}
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createShift.isPending}>
                Post Shift
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
