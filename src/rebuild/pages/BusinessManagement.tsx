/**
 * BusinessManagement — Clean Rebuild surface
 *
 * Canonical provider-side internal surface
 *   Staff       — user_profiles (officers, staff) with skills and availability
 *   Roster      — open_shifts + roster_shifts with scheduling status
 *   Fleet       — vehicle fleet (from canon org vehicles or dedicated fleet table)
 *   Audit       — audit_log scoped to own org
 *
 * Hierarchy: staff -> roster -> fleet/assets -> checks -> audit
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Users, Calendar, Truck, ClipboardList, Search, CheckCircle2, Clock, XCircle,
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────

type StaffRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
  is_active: boolean
  phone: string | null
  job_title: string | null
}

type SkillRow = {
  id: string
  officer_id: string
  skill_name: string
  skill_level: string | null
  verified: boolean | null
}

type AvailabilityRow = {
  id: string
  officer_id: string
  day_of_week: number | null
  start_time: string | null
  end_time: string | null
  is_available: boolean
}

type OpenShiftRow = {
  id: string
  title: string | null
  shift_date: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  zone: { name: string } | null
}

type RosterShiftRow = {
  id: string
  officer_id: string
  shift_date: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  officer: { first_name: string; last_name: string } | null
}

type AuditRow = {
  id: string
  action: string
  entity_type: string | null
  entity_id: string | null
  created_at: string | null
  performer: { first_name: string; last_name: string } | null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Staff tab ─────────────────────────────────────────────────────────────

function StaffTab({ orgId }: { orgId: string }) {
  const [search, setSearch] = useState('')

  const { data: staff = [], isLoading } = useQuery<StaffRow[]>({
    queryKey: ['bm-staff', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, role, is_active, phone, job_title')
        .eq('organization_id', orgId)
        .order('last_name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  const filtered = staff.filter((s) => {
    const full = `${s.first_name} ${s.last_name} ${s.email}`.toLowerCase()
    return !search || full.includes(search.toLowerCase())
  })

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search staff..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading staff…</p>}

      <div className="space-y-2">
        {filtered.map((s) => (
          <Card key={s.id}>
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm">{s.first_name} {s.last_name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.job_title ?? s.role} {s.phone ? `· ${s.phone}` : ''} · {s.email}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs capitalize">{s.role}</Badge>
                {s.is_active
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <XCircle className="h-4 w-4 text-slate-400" />}
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No staff found.</p>
        )}
      </div>
    </div>
  )
}

// ─── Roster tab ────────────────────────────────────────────────────────────

function RosterTab({ orgId }: { orgId: string }) {
  const { data: openShifts = [], isLoading: loadingOpen } = useQuery<OpenShiftRow[]>({
    queryKey: ['bm-open-shifts', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('open_shifts')
        .select(`
          id, title, shift_date, start_time, end_time, status,
          zone:zones(name)
        `)
        .eq('organization_id', orgId)
        .order('shift_date', { ascending: true })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as OpenShiftRow[]
    },
    enabled: !!orgId,
  })

  const { data: scheduled = [], isLoading: loadingScheduled } = useQuery<RosterShiftRow[]>({
    queryKey: ['bm-roster-shifts', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roster_shifts')
        .select(`
          id, officer_id, shift_date, start_time, end_time, status,
          officer:user_profiles!roster_shifts_officer_id_fkey(first_name, last_name)
        `)
        .eq('organization_id', orgId)
        .order('shift_date', { ascending: true })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as RosterShiftRow[]
    },
    enabled: !!orgId,
  })

  const statusBg: Record<string, string> = {
    open:      'bg-blue-50 text-blue-700 border-blue-200',
    filled:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-red-50 text-red-700 border-red-200',
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending:   'bg-amber-50 text-amber-700 border-amber-200',
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3">Open Shifts</h3>
        {loadingOpen && <p className="text-sm text-muted-foreground">Loading open shifts…</p>}
        {!loadingOpen && openShifts.length === 0 && (
          <p className="text-sm text-muted-foreground">No open shifts.</p>
        )}
        <div className="space-y-2">
          {openShifts.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{s.title ?? 'Shift'}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.shift_date ?? '—'} {s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : ''}
                    {s.zone?.name ? ` · ${s.zone.name}` : ''}
                  </div>
                </div>
                {s.status && (
                  <Badge className={`text-xs border shrink-0 ${statusBg[s.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {s.status}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">Scheduled Roster</h3>
        {loadingScheduled && <p className="text-sm text-muted-foreground">Loading roster…</p>}
        {!loadingScheduled && scheduled.length === 0 && (
          <p className="text-sm text-muted-foreground">No scheduled shifts.</p>
        )}
        <div className="space-y-2">
          {scheduled.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">
                    {s.officer ? `${s.officer.first_name} ${s.officer.last_name}` : 'Officer'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.shift_date ?? '—'} {s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : ''}
                  </div>
                </div>
                {s.status && (
                  <Badge className={`text-xs border shrink-0 ${statusBg[s.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {s.status}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Audit tab ─────────────────────────────────────────────────────────────

function AuditTab({ orgId }: { orgId: string }) {
  const { data: entries = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: ['bm-audit', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select(`
          id, action, entity_type, entity_id, created_at,
          performer:user_profiles!audit_log_performed_by_fkey(first_name, last_name)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as AuditRow[]
    },
    enabled: !!orgId,
  })

  return (
    <div className="space-y-2">
      {isLoading && <p className="text-sm text-muted-foreground">Loading audit log…</p>}
      {!isLoading && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">No audit events found.</p>
      )}
      {entries.map((e) => (
        <Card key={e.id}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{e.action}</div>
                <div className="text-xs text-muted-foreground">
                  {e.entity_type ?? '—'} {e.entity_id ? `· ${e.entity_id.slice(0, 8)}…` : ''}
                  {e.performer ? ` · ${e.performer.first_name} ${e.performer.last_name}` : ''}
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {e.created_at ? new Date(e.created_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }) : '—'}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function RebuildBusinessManagementPage() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Business Management</h1>
        <p className="text-sm text-muted-foreground">
          Staff · Roster · Fleet · Audit
        </p>
      </div>

      <Tabs defaultValue="staff">
        <TabsList className="mb-4">
          <TabsTrigger value="staff">
            <Users className="h-4 w-4 mr-1.5" />Staff
          </TabsTrigger>
          <TabsTrigger value="roster">
            <Calendar className="h-4 w-4 mr-1.5" />Roster
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ClipboardList className="h-4 w-4 mr-1.5" />Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="staff"><StaffTab orgId={orgId} /></TabsContent>
        <TabsContent value="roster"><RosterTab orgId={orgId} /></TabsContent>
        <TabsContent value="audit"><AuditTab orgId={orgId} /></TabsContent>
      </Tabs>
    </div>
  )
}
