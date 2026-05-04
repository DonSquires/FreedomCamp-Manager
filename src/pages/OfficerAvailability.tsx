import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { ListCardRow } from '@/components/features/ListCardRow'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import {
  CalendarDays, Clock, Plus, Trash2, AlertTriangle, CheckCircle,
  XCircle, User, ChevronRight, Calendar, Shield
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type UnavailabilityReason = 'annual_leave' | 'sick_leave' | 'training' | 'personal' | 'public_holiday' | 'lieu_day' | 'other'

interface OfficerAvailabilityRow {
  id: string
  officer_id: string
  organization_id: string
  day_of_week: number | null
  specific_date: string | null
  available_from: string | null
  available_to: string | null
  is_available: boolean
  unavailability_reason: UnavailabilityReason | null
  notes: string | null
  created_at: string
}

interface DayPattern {
  day_of_week: number
  is_available: boolean
  available_from: string
  available_to: string
  all_day: boolean
  existing_id?: string
}

interface RosterShift {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  officer_response: string | null
  officer_response_at: string | null
  officer_notes: string | null
  status: string
  site_id: string
  client_site?: { name: string } | null
}

interface OfficerProfile {
  id: string
  full_name: string
  organization_id: string
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const REASON_LABELS: Record<UnavailabilityReason, string> = {
  annual_leave: 'Annual Leave',
  sick_leave: 'Sick Leave',
  training: 'Training',
  personal: 'Personal',
  public_holiday: 'Public Holiday',
  lieu_day: 'Lieu Day',
  other: 'Other',
}
const REASON_COLORS: Record<UnavailabilityReason, string> = {
  annual_leave: 'bg-blue-100 text-blue-800',
  sick_leave: 'bg-red-100 text-red-800',
  training: 'bg-purple-100 text-purple-800',
  personal: 'bg-yellow-100 text-yellow-800',
  public_holiday: 'bg-green-100 text-green-800',
  lieu_day: 'bg-orange-100 text-orange-800',
  other: 'bg-gray-100 text-gray-800',
}

const DEFAULT_PATTERNS: DayPattern[] = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
  day_of_week: d,
  is_available: d !== 0 && d !== 6,
  available_from: '08:00',
  available_to: '17:00',
  all_day: false,
}))

// ─── Officer View ─────────────────────────────────────────────────────────────

function OfficerView() {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const qc = useQueryClient()
  const [patterns, setPatterns] = useState<DayPattern[]>(DEFAULT_PATTERNS)
  const [patternsLoaded, setPatternsLoaded] = useState(false)
  const [showBlockDialog, setShowBlockDialog] = useState(false)
  const [showDeclineDialog, setShowDeclineDialog] = useState(false)
  const [decliningShiftId, setDecliningShiftId] = useState<string | null>(null)
  const [declineNotes, setDeclineNotes] = useState('')
  const [blockForm, setBlockForm] = useState({
    specific_date: '',
    reason: 'annual_leave' as UnavailabilityReason,
    available_from: '',
    available_to: '',
    notes: '',
    is_available: false,
  })

  // Load weekly patterns
  const { data: weeklyRows } = useQuery({
    queryKey: ['officer_availability_weekly', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('officer_availability')
        .select('*')
        .eq('officer_id', user!.id)
        .is('specific_date', null)
      if (error) throw error
      return data as OfficerAvailabilityRow[]
    },
    enabled: !!user?.id,
    onSuccess: (rows) => {
      if (patternsLoaded) return
      if (rows && rows.length > 0) {
        setPatterns(DEFAULT_PATTERNS.map((p) => {
          const row = rows.find((r) => r.day_of_week === p.day_of_week)
          if (!row) return p
          return {
            ...p,
            is_available: row.is_available,
            available_from: row.available_from ?? '08:00',
            available_to: row.available_to ?? '17:00',
            all_day: !row.available_from,
            existing_id: row.id,
          }
        }))
      }
      setPatternsLoaded(true)
    },
  } as any)

  // Load date blocks
  const { data: dateBlocks } = useQuery({
    queryKey: ['officer_availability_blocks', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('officer_availability')
        .select('*')
        .eq('officer_id', user!.id)
        .not('specific_date', 'is', null)
        .order('specific_date', { ascending: true })
      if (error) throw error
      return data as OfficerAvailabilityRow[]
    },
    enabled: !!user?.id,
  })

  // Load upcoming shifts
  const today = new Date().toISOString().split('T')[0]
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  const { data: shifts } = useQuery({
    queryKey: ['my_shifts', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('roster_shifts')
        .select('*, client_site:client_sites!client_site_id(name)')
        .eq('officer_id', user!.id)
        .gte('shift_date', today)
        .lte('shift_date', in14)
        .in('status', ['published', 'confirmed'])
        .order('shift_date', { ascending: true })
      if (error) throw error
      return data as RosterShift[]
    },
    enabled: !!user?.id,
  })

  const savePatternsMutation = useMutation({
    mutationFn: async () => {
      const ops = patterns.map((p) => ({
        id: p.existing_id,
        officer_id: user!.id,
        organization_id: operationalOrganizationId,
        day_of_week: p.day_of_week,
        specific_date: null,
        is_available: p.is_available,
        available_from: p.all_day ? null : p.available_from || null,
        available_to: p.all_day ? null : p.available_to || null,
        unavailability_reason: null,
        notes: null,
      }))
      const { error } = await (supabase as any).from('officer_availability').upsert(ops, { onConflict: 'id' })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Weekly pattern saved')
      qc.invalidateQueries({ queryKey: ['officer_availability_weekly', user?.id] })
    },
    onError: () => toast.error('Failed to save pattern'),
  })

  const addBlockMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from('officer_availability').insert({
        officer_id: user!.id,
        organization_id: operationalOrganizationId,
        day_of_week: null,
        specific_date: blockForm.specific_date,
        is_available: false,
        available_from: blockForm.available_from || null,
        available_to: blockForm.available_to || null,
        unavailability_reason: blockForm.reason,
        notes: blockForm.notes || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Date block added')
      setShowBlockDialog(false)
      setBlockForm({ specific_date: '', reason: 'annual_leave', available_from: '', available_to: '', notes: '', is_available: false })
      qc.invalidateQueries({ queryKey: ['officer_availability_blocks', user?.id] })
    },
    onError: () => toast.error('Failed to add date block'),
  })

  const deleteBlockMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('officer_availability').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Date block removed')
      qc.invalidateQueries({ queryKey: ['officer_availability_blocks', user?.id] })
    },
    onError: () => toast.error('Failed to remove block'),
  })

  const respondShiftMutation = useMutation({
    mutationFn: async ({ id, response, notes }: { id: string; response: string; notes?: string }) => {
      const { error } = await (supabase as any)
        .from('roster_shifts')
        .update({ officer_response: response, officer_response_at: new Date().toISOString(), officer_notes: notes ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(vars.response === 'accepted' ? 'Shift accepted' : 'Shift declined')
      qc.invalidateQueries({ queryKey: ['my_shifts', user?.id] })
    },
    onError: () => toast.error('Failed to update shift response'),
  })

  const updatePattern = (idx: number, field: keyof DayPattern, value: any) => {
    setPatterns((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)))
  }

  // Reorder Mon–Sun
  const orderedPatterns = [...patterns].sort((a, b) => {
    const order = [1, 2, 3, 4, 5, 6, 0]
    return order.indexOf(a.day_of_week) - order.indexOf(b.day_of_week)
  })

  return (
    <div className="space-y-6">
      {/* Weekly Availability Grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Weekly Availability</CardTitle>
          <Button size="sm" onClick={() => savePatternsMutation.mutate()} disabled={savePatternsMutation.isPending}>
            {savePatternsMutation.isPending ? 'Saving…' : 'Save Weekly Pattern'}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {orderedPatterns.map((p, idx) => {
              const realIdx = patterns.findIndex((x) => x.day_of_week === p.day_of_week)
              return (
                <div key={p.day_of_week} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-white">
                  <div className="w-24 font-medium text-sm">{DAY_NAMES_FULL[p.day_of_week]}</div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={p.is_available}
                      onCheckedChange={(v) => updatePattern(realIdx, 'is_available', v)}
                    />
                    <span className={`text-sm font-medium ${p.is_available ? 'text-green-600' : 'text-gray-400'}`}>
                      {p.is_available ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                  {p.is_available && (
                    <>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={p.all_day}
                          onCheckedChange={(v) => updatePattern(realIdx, 'all_day', v)}
                        />
                        <span className="text-sm text-gray-600">All day</span>
                      </div>
                      {!p.all_day && (
                        <div className="flex items-center gap-2">
                          <Input type="time" value={p.available_from} onChange={(e) => updatePattern(realIdx, 'available_from', e.target.value)} className="w-32 text-sm" />
                          <span className="text-gray-400">–</span>
                          <Input type="time" value={p.available_to} onChange={(e) => updatePattern(realIdx, 'available_to', e.target.value)} className="w-32 text-sm" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Date Blocks */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Date Blocks</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowBlockDialog(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Date Block
          </Button>
        </CardHeader>
        <CardContent>
          {!dateBlocks || dateBlocks.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No date blocks added yet.</p>
          ) : (
            <div className="space-y-2">
              {dateBlocks.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border bg-white">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium text-sm">{b.specific_date}</span>
                    {b.unavailability_reason && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REASON_COLORS[b.unavailability_reason]}`}>
                        {REASON_LABELS[b.unavailability_reason]}
                      </span>
                    )}
                    {b.available_from && b.available_to && (
                      <span className="text-xs text-gray-500">{b.available_from} – {b.available_to}</span>
                    )}
                    {b.notes && <span className="text-xs text-gray-400 italic">{b.notes}</span>}
                  </div>
                  <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => deleteBlockMutation.mutate(b.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Shifts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> My Upcoming Shifts (Next 14 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {!shifts || shifts.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No upcoming shifts.</p>
          ) : (
            <div className="space-y-2">
              {shifts.map((s) => (
                <div key={s.id} className="space-y-2 rounded-lg border bg-white p-3">
                  <ListCardRow
                    className="bg-transparent p-0"
                    left={(
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-medium text-sm">{s.shift_date}</span>
                        <span className="text-sm text-gray-600">{s.start_time} – {s.end_time}</span>
                        {s.client_site && <span className="text-sm font-medium text-gray-700">{s.client_site.name}</span>}
                      </div>
                    )}
                    right={(
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={s.status === 'confirmed' ? 'default' : 'secondary'} className="text-xs">{s.status}</Badge>
                        {s.officer_response && (
                          <Badge variant={s.officer_response === 'accepted' ? 'default' : 'destructive'} className="text-xs">
                            {s.officer_response}
                          </Badge>
                        )}
                      </div>
                    )}
                  />
                  {s.status === 'published' && !s.officer_response && (
                    <ListCardRow
                      className="bg-transparent p-0"
                      left={<span className="text-xs text-muted-foreground">Action required</span>}
                      right={(
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => respondShiftMutation.mutate({ id: s.id, response: 'accepted' })}>
                            <CheckCircle className="mr-1 h-3 w-3" /> Accept
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => { setDecliningShiftId(s.id); setShowDeclineDialog(true) }}>
                            <XCircle className="mr-1 h-3 w-3" /> Decline
                          </Button>
                        </div>
                      )}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Block Dialog */}
      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Add Date Block</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date</Label>
              <Input type="date" value={blockForm.specific_date} onChange={(e) => setBlockForm({ ...blockForm, specific_date: e.target.value })} />
            </div>
            <div>
              <Label>Reason</Label>
              <Select value={blockForm.reason} onValueChange={(v) => setBlockForm({ ...blockForm, reason: v as UnavailabilityReason })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(REASON_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From (optional)</Label>
                <Input type="time" value={blockForm.available_from} onChange={(e) => setBlockForm({ ...blockForm, available_from: e.target.value })} />
              </div>
              <div>
                <Label>To (optional)</Label>
                <Input type="time" value={blockForm.available_to} onChange={(e) => setBlockForm({ ...blockForm, available_to: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={blockForm.notes} onChange={(e) => setBlockForm({ ...blockForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBlockDialog(false)}>Cancel</Button>
            <Button onClick={() => addBlockMutation.mutate()} disabled={!blockForm.specific_date || addBlockMutation.isPending}>
              {addBlockMutation.isPending ? 'Adding…' : 'Add Block'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline Dialog */}
      <Dialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Decline Shift</DialogTitle></DialogHeader>
          <div>
            <Label>Reason (optional)</Label>
            <Textarea value={declineNotes} onChange={(e) => setDeclineNotes(e.target.value)} rows={3} placeholder="Enter reason for declining…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeclineDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (decliningShiftId) {
                respondShiftMutation.mutate({ id: decliningShiftId, response: 'declined', notes: declineNotes })
                setShowDeclineDialog(false)
                setDecliningShiftId(null)
                setDeclineNotes('')
              }
            }}>Confirm Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Admin View ───────────────────────────────────────────────────────────────

function AdminView() {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const [selectedOfficer, setSelectedOfficer] = useState<OfficerProfile | null>(null)

  // Load all officers in org
  const { data: officers } = useQuery({
    queryKey: ['officers_list', operationalOrganizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, organization_id')
        .eq('organization_id', operationalOrganizationId!)
        .eq('role', 'officer')
        .order('first_name')
      if (error) throw error
      return (data ?? []).map((p: any) => ({ ...p, full_name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() })) as OfficerProfile[]
    },
    enabled: !!operationalOrganizationId,
  })

  // Load all weekly availability for org
  const { data: allWeekly } = useQuery({
    queryKey: ['all_weekly_availability', operationalOrganizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('officer_availability')
        .select('*')
        .eq('organization_id', operationalOrganizationId!)
        .is('specific_date', null)
      if (error) throw error
      return data as OfficerAvailabilityRow[]
    },
    enabled: !!operationalOrganizationId,
  })

  // Load all date blocks for org (next 90 days)
  const today = new Date().toISOString().split('T')[0]
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0]
  const { data: allBlocks } = useQuery({
    queryKey: ['all_blocks', operationalOrganizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('officer_availability')
        .select('*')
        .eq('organization_id', operationalOrganizationId!)
        .not('specific_date', 'is', null)
        .gte('specific_date', today)
        .lte('specific_date', in90)
        .eq('is_available', false)
        .order('specific_date', { ascending: true })
      if (error) throw error
      return data as OfficerAvailabilityRow[]
    },
    enabled: !!operationalOrganizationId,
  })

  // Load upcoming shifts for conflict detection
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  const { data: upcomingShifts } = useQuery({
    queryKey: ['upcoming_shifts_admin', operationalOrganizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('roster_shifts')
        .select('id, shift_date, start_time, end_time, officer_id, status, client_site:client_sites!client_site_id(name)')
        .gte('shift_date', today)
        .lte('shift_date', in14)
        .in('status', ['published', 'confirmed'])
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.organization_id,
  })

  const officerMap = new Map((officers ?? []).map((o) => [o.id, o]))

  // Build conflict list
  const conflicts = (upcomingShifts ?? []).filter((shift) => {
    const block = (allBlocks ?? []).find((b) => b.officer_id === shift.officer_id && b.specific_date === shift.shift_date)
    return !!block
  })

  // Helper: get availability cell color for officer + day
  const getCellColor = (officerId: string, day: number) => {
    const row = (allWeekly ?? []).find((r) => r.officer_id === officerId && r.day_of_week === day)
    if (!row) return 'bg-gray-100'
    if (!row.is_available) return 'bg-red-200'
    if (!row.available_from) return 'bg-green-200'
    return 'bg-orange-200'
  }

  const getCellLabel = (officerId: string, day: number) => {
    const row = (allWeekly ?? []).find((r) => r.officer_id === officerId && r.day_of_week === day)
    if (!row) return '–'
    if (!row.is_available) return 'Off'
    if (!row.available_from) return 'All'
    return `${row.available_from?.slice(0, 5)}`
  }

  // Leave summary grouped by officer
  const leaveByOfficer = new Map<string, OfficerAvailabilityRow[]>()
  for (const b of (allBlocks ?? [])) {
    if (!leaveByOfficer.has(b.officer_id)) leaveByOfficer.set(b.officer_id, [])
    leaveByOfficer.get(b.officer_id)!.push(b)
  }

  if (selectedOfficer) {
    return (
      <OfficerDetailDrilldown
        officer={selectedOfficer}
        onBack={() => setSelectedOfficer(null)}
        organizationId={operationalOrganizationId!}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Weekly Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Officer Availability Overview</CardTitle>
          <div className="flex gap-4 text-xs mt-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> All day</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 inline-block" /> Partial</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> Unavailable</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 inline-block" /> No data</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-gray-600 min-w-[140px]">Officer</th>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <th key={d} className="text-center py-2 px-2 font-medium text-gray-600 min-w-[60px]">{DAY_NAMES[d]}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {(officers ?? []).map((o) => (
                  <tr key={o.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 pr-4 font-medium text-sm">
                      <button className="flex items-center gap-1 text-left hover:text-blue-600 transition-colors" onClick={() => setSelectedOfficer(o)}>
                        <User className="h-3 w-3" />
                        {o.full_name}
                      </button>
                    </td>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <td key={d} className="py-2 px-2 text-center">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getCellColor(o.id, d)}`}>
                          {getCellLabel(o.id, d)}
                        </span>
                      </td>
                    ))}
                    <td className="py-2 pl-2">
                      <Button size="icon" variant="ghost" onClick={() => setSelectedOfficer(o)} className="h-7 w-7">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {(officers ?? []).length === 0 && (
                  <tr><td colSpan={9} className="text-center text-gray-500 py-8">No officers found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Conflict Alerts */}
      {conflicts.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-5 w-5" /> Conflict Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {conflicts.map((s) => {
                const officer = officerMap.get(s.officer_id)
                return (
                  <div key={s.id} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-red-200">
                    <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                    <span className="text-sm">
                      <span className="font-medium">{officer?.full_name ?? s.officer_id}</span>
                      {' '}is rostered on{' '}
                      <span className="font-medium">{s.shift_date}</span>
                      {' '}but has marked unavailability.
                      {s.client_site && <span className="text-gray-500"> ({s.client_site.name})</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leave Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Upcoming Leave Summary (Next 90 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {leaveByOfficer.size === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No upcoming leave blocks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-gray-600">Officer</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-600">Dates</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-600">Reason</th>
                    <th className="text-left py-2 font-medium text-gray-600">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(leaveByOfficer.entries()).flatMap(([oid, blocks]) =>
                    blocks.map((b) => {
                      const officer = officerMap.get(oid)
                      return (
                        <tr key={b.id} className="border-b hover:bg-gray-50">
                          <td className="py-2 pr-4 font-medium">{officer?.full_name ?? oid}</td>
                          <td className="py-2 pr-4">{b.specific_date}</td>
                          <td className="py-2 pr-4">
                            {b.unavailability_reason && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REASON_COLORS[b.unavailability_reason]}`}>
                                {REASON_LABELS[b.unavailability_reason]}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-gray-600">
                            {b.available_from && b.available_to ? `${b.available_from?.slice(0,5)} – ${b.available_to?.slice(0,5)}` : 'All day'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Officer Detail Drilldown ─────────────────────────────────────────────────

function OfficerDetailDrilldown({ officer, onBack, organizationId }: { officer: OfficerProfile; onBack: () => void; organizationId: string }) {
  const { data: weekly } = useQuery({
    queryKey: ['officer_detail_weekly', officer.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('officer_availability')
        .select('*')
        .eq('officer_id', officer.id)
        .is('specific_date', null)
      if (error) throw error
      return data as OfficerAvailabilityRow[]
    },
  })

  const { data: blocks } = useQuery({
    queryKey: ['officer_detail_blocks', officer.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('officer_availability')
        .select('*')
        .eq('officer_id', officer.id)
        .not('specific_date', 'is', null)
        .order('specific_date', { ascending: true })
      if (error) throw error
      return data as OfficerAvailabilityRow[]
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>← Back</Button>
        <h2 className="text-lg font-semibold flex items-center gap-2"><User className="h-5 w-5" />{officer.full_name}</h2>
      </div>

      <Card>
        <CardHeader><CardTitle>Weekly Pattern</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const row = (weekly ?? []).find((r) => r.day_of_week === d)
              return (
                <div key={d} className="flex items-center gap-4 p-3 rounded-lg border bg-white">
                  <span className="w-24 font-medium text-sm">{DAY_NAMES_FULL[d]}</span>
                  {!row ? (
                    <span className="text-gray-400 text-sm">No data</span>
                  ) : row.is_available ? (
                    <>
                      <Badge className="bg-green-100 text-green-800 border-green-200">Available</Badge>
                      <span className="text-sm text-gray-600">
                        {row.available_from ? `${row.available_from.slice(0,5)} – ${row.available_to?.slice(0,5)}` : 'All day'}
                      </span>
                    </>
                  ) : (
                    <Badge variant="destructive">Unavailable</Badge>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Date Blocks</CardTitle></CardHeader>
        <CardContent>
          {!blocks || blocks.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No date blocks.</p>
          ) : (
            <div className="space-y-2">
              {blocks.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-white">
                  <span className="font-medium text-sm">{b.specific_date}</span>
                  {b.unavailability_reason && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${REASON_COLORS[b.unavailability_reason]}`}>
                      {REASON_LABELS[b.unavailability_reason]}
                    </span>
                  )}
                  {b.notes && <span className="text-xs text-gray-500 italic">{b.notes}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OfficerAvailability() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master'

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-blue-600" />
            {isAdmin ? 'Officer Availability Overview' : 'My Availability'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isAdmin
              ? 'View all officer availability, leave blocks, and shift conflicts.'
              : 'Set your weekly availability pattern and block specific dates.'}
          </p>
        </div>
        <Separator className="mb-6" />
        {isAdmin ? <AdminView /> : <OfficerView />}
      </div>
    </AppLayout>
  )
}
