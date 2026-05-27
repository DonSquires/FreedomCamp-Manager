/**
 * PatrolScheduleManagement — Admin page for creating, viewing, and managing
 * patrol schedules sent to field officers. Tracks assigned zones, times,
 * officer acceptance, and provides an overview of upcoming / active / completed patrols.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { buildPreferredMapUrlForCoordinates } from '@/lib/inhouseMapping'
import { useAuthStore } from '@/stores/authStore'
import {
  usePatrols,
  useCreatePatrolSchedule,
  useStartPatrol,
  useCompletePatrol,
  useCancelPatrol,
} from '@/hooks/usePatrols'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Calendar,
  Plus,
  Clock,
  User,
  MapPin,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  Square,
  Send,
  Radio,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, formatDistanceToNow, parseISO } from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ScheduleForm {
  zone_id: string
  patrol_date: string
  shift: string
  assigned_to: string
  scheduled_start_time: string
  scheduled_end_time: string
  description: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  recurrence: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
  notes: string
  patrol_route_id: string
}

const emptyForm = (): ScheduleForm => ({
  zone_id: '',
  patrol_date: new Date().toISOString().split('T')[0],
  shift: 'day',
  assigned_to: '',
  scheduled_start_time: '',
  scheduled_end_time: '',
  description: '',
  priority: 'normal',
  recurrence: 'none',
  notes: '',
  patrol_route_id: '',
})

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'text-blue-700 border-blue-300' },
  in_progress: { label: 'In Progress', className: 'text-orange-700 border-orange-300' },
  active: { label: 'Active', className: 'text-orange-700 border-orange-300' },
  completed: { label: 'Completed', className: 'text-green-700 border-green-300' },
  cancelled: { label: 'Cancelled', className: 'text-gray-500 border-gray-300' },
}

const PRIORITY_BADGE: Record<string, { label: string; className: string }> = {
  low: { label: 'Low', className: 'text-gray-600 border-gray-300' },
  normal: { label: 'Normal', className: 'text-blue-600 border-blue-300' },
  high: { label: 'High', className: 'text-orange-600 border-orange-300' },
  urgent: { label: 'Urgent', className: 'text-red-600 border-red-300' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PatrolScheduleManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<ScheduleForm>(emptyForm())
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // ─── Data ─────────────────────────────────────────────────────────────────

  const { data: patrols = [], isLoading, isFetching } = usePatrols({
    organizationId: user?.organization_id,
    status: statusFilter === 'all' ? 'all' : statusFilter as any,
  })

  const { data: zones = [] } = useQuery({
    queryKey: ['zones_list_schedule', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name, location_lat, location_lng')
        .eq('organization_id', user!.organization_id!)
        .order('name')
      if (error) throw error
      return data as { id: string; name: string; location_lat: number | null; location_lng: number | null }[]
    },
    enabled: !!user?.organization_id,
  })

  const zoneCoordsById = Object.fromEntries(
    zones.map((zone) => [zone.id, { lat: zone.location_lat, lng: zone.location_lng }]),
  )

  const { data: officers = [] } = useQuery({
    queryKey: ['officers_list', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, role')
        .eq('organization_id', user!.organization_id!)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return data as { id: string; first_name: string; last_name: string; role: string }[]
    },
    enabled: !!user?.organization_id,
  })

  const { data: patrolRoutes = [] } = useQuery({
    queryKey: ['patrol_routes_list', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('patrol_routes')
        .select('id, route_name, default_shift')
        .eq('organization_id', user!.organization_id!)
        .eq('is_active', true)
        .order('route_name')
      if (error) throw error
      return data as { id: string; route_name: string; default_shift: string | null }[]
    },
    enabled: !!user?.organization_id,
  })

  // ─── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useCreatePatrolSchedule()
  const cancelMutation = useCancelPatrol()

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!form.zone_id) {
      toast.error('Please select a zone')
      return
    }
    if (!form.patrol_date) {
      toast.error('Please select a date')
      return
    }

    toast.success('Patrol scheduled')

    let zoneId = form.zone_id

    if (zoneId === '__auto_zone__') {
      if (!user?.organization_id) {
        toast.error('Organization context is still loading. Please retry.')
        return
      }

      const autoName = `Default Zone ${new Date().toLocaleDateString('en-NZ')}`
      const { data: createdZone, error } = await supabase
        .from('zones')
        .insert({ organization_id: user.organization_id, name: autoName, is_active: true })
        .select('id')
        .single()

      if (error || !createdZone?.id) {
        toast.error(error?.message || 'Failed to create a default zone')
        return
      }

      zoneId = createdZone.id
      await queryClient.invalidateQueries({ queryKey: ['zones_list_schedule', user.organization_id] })
    }

    createMutation.mutate({
      zone_id: zoneId,
      patrol_date: form.patrol_date,
      shift: form.shift,
      assigned_to: form.assigned_to || null,
      scheduled_start_time: form.scheduled_start_time
        ? `${form.patrol_date}T${form.scheduled_start_time}:00`
        : null,
      scheduled_end_time: form.scheduled_end_time
        ? `${form.patrol_date}T${form.scheduled_end_time}:00`
        : null,
      description: form.description || null,
      priority: form.priority,
      recurrence: form.recurrence,
      notes: form.notes || null,
      patrol_route_id: form.patrol_route_id || null,
    }, {
      onSuccess: () => {
        toast.success('Patrol scheduled')
        setShowCreate(false)
        setForm(emptyForm())
      },
    })
  }

  // Stats
  const totalScheduled = patrols.filter((p: any) => p.status === 'scheduled').length
  const totalActive = patrols.filter((p: any) => ['in_progress', 'active'].includes(p.status)).length
  const totalCompleted = patrols.filter((p: any) => p.status === 'completed').length
  const totalCancelled = patrols.filter((p: any) => p.status === 'cancelled').length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Patrol Schedule"
      description="Create and manage patrol schedules for field officers"
    >
      <div className="space-y-6">
        {isFetching && !isLoading && (
          <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            Refreshing patrol schedules in the background
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Scheduled</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">{totalScheduled}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">{totalActive}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{totalCompleted}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Cancelled</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-gray-400">{totalCancelled}</p>
            </CardContent>
          </Card>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => { setForm(emptyForm()); setShowCreate(true) }} className="ml-auto gap-2">
            <Plus className="h-4 w-4" />
            Create Patrol Schedule
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Acceptance</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      Loading patrol schedule grid…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && patrols.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No patrol schedules found. Click &quot;Create Patrol Schedule&quot; to get started.
                    </TableCell>
                  </TableRow>
                )}
                {patrols.map((patrol: any) => {
                  const statusInfo = STATUS_BADGE[patrol.status] ?? STATUS_BADGE.scheduled
                  const priorityInfo = PRIORITY_BADGE[patrol.priority] ?? PRIORITY_BADGE.normal
                  const routeName = patrol.patrol_route?.route_name
                  return (
                    <TableRow key={patrol.id}>
                      <TableCell>
                        {routeName ? (
                          <Badge variant="outline" className="text-blue-700 border-blue-400 gap-1">
                            <Radio className="h-3 w-3" />{routeName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-gray-500" />
                          {patrol.patrol_date}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{patrol.shift}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {patrol.zone?.name ?? '—'}
                          </span>
                          {(() => {
                            const coords = patrol.zone_id ? zoneCoordsById[patrol.zone_id] : null
                            if (coords?.lat == null || coords?.lng == null) return null
                            return (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2"
                                onClick={() => window.open(buildPreferredMapUrlForCoordinates(coords.lat, coords.lng), '_blank', 'noopener,noreferrer')}
                              >
                                <MapPin className="h-3 w-3" />
                              </Button>
                            )
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        {patrol.officer ? (
                          <span className="flex items-center gap-1 text-sm">
                            <User className="h-3 w-3" />
                            {patrol.officer.first_name} {patrol.officer.last_name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {patrol.scheduled_start_time && patrol.scheduled_end_time ? (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-gray-500" />
                            {format(parseISO(patrol.scheduled_start_time), 'HH:mm')}
                            {' – '}
                            {format(parseISO(patrol.scheduled_end_time), 'HH:mm')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={priorityInfo.className}>
                          {priorityInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusInfo.className}>
                          {statusInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {patrol.officer_accepted === true && (
                          <Badge variant="outline" className="text-green-700 border-green-300 gap-1">
                            <CheckCircle className="h-3 w-3" /> Accepted
                          </Badge>
                        )}
                        {patrol.officer_declined === true && (
                          <Badge variant="outline" className="text-red-700 border-red-300 gap-1">
                            <XCircle className="h-3 w-3" /> Declined
                          </Badge>
                        )}
                        {patrol.officer_accepted === null && !patrol.officer_declined && patrol.assigned_to && (
                          <Badge variant="outline" className="text-yellow-700 border-yellow-300 gap-1">
                            <AlertTriangle className="h-3 w-3" /> Pending
                          </Badge>
                        )}
                        {!patrol.assigned_to && (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {patrol.duration_minutes != null
                          ? `${patrol.duration_minutes} min`
                          : patrol.actual_start_time && !patrol.actual_end_time
                          ? 'In progress…'
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {patrol.status === 'scheduled' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => cancelMutation.mutate(patrol.id)}
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
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Create Patrol Schedule
            </DialogTitle>
            <DialogDescription>
              Schedule a patrol and assign it to an officer. They will receive a notification.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {/* Patrol Route / Call Sign */}
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-blue-600" />Patrol Route</Label>
              <Select value={form.patrol_route_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, patrol_route_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select patrol route (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No route</SelectItem>
                  {patrolRoutes.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.route_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Zone */}
            <div className="grid gap-2">
              <Label>Primary Zone *</Label>
              <Select value={form.zone_id} onValueChange={v => setForm(f => ({ ...f, zone_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.length === 0 && (
                    <SelectItem value="__auto_zone__">Auto-create default zone</SelectItem>
                  )}
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date & Shift */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.patrol_date}
                  onChange={e => setForm(f => ({ ...f, patrol_date: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Shift</Label>
                <Select value={form.shift} onValueChange={v => setForm(f => ({ ...f, shift: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="night">Night</SelectItem>
                    <SelectItem value="morning">Morning</SelectItem>
                    <SelectItem value="afternoon">Afternoon</SelectItem>
                    <SelectItem value="evening">Evening</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Scheduled Times */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={form.scheduled_start_time}
                  onChange={e => setForm(f => ({ ...f, scheduled_start_time: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={form.scheduled_end_time}
                  onChange={e => setForm(f => ({ ...f, scheduled_end_time: e.target.value }))}
                />
              </div>
            </div>

            {/* Officer */}
            <div className="grid gap-2">
              <Label>Assign Officer</Label>
              <Select value={form.assigned_to} onValueChange={v => setForm(f => ({ ...f, assigned_to: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.first_name} {o.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority & Recurrence */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as any }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Recurrence</Label>
                <Select value={form.recurrence} onValueChange={v => setForm(f => ({ ...f, recurrence: v as any }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (one-off)</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="fortnightly">Fortnightly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label>Description / Instructions</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Special instructions for the officer…"
                rows={2}
              />
            </div>

            {/* Notes */}
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Internal notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {createMutation.isPending ? 'Creating…' : 'Create & Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
