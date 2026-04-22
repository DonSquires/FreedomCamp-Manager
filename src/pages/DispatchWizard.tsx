/**
 * DispatchWizard — 4-step guided job creation
 *
 * Step 1 — Select client/site (searchable, shows client_code + address)
 * Step 2 — Select job type + alarm type
 * Step 3 — Assign call sign / officer (shows availability)
 * Step 4 — Confirm + dispatch
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { insertDispatchJobWithAlarmTypeFallback } from '@/lib/dispatchJobs'
import { useAuthStore } from '@/stores/authStore'
import { useClientOrgIds } from '@/hooks/useClientOrgIds'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Building2, Radio, User, CheckCircle, ChevronRight, ChevronLeft,
  Zap, MapPin, Phone, Key, Search, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_TYPE_OPTIONS: { value: string; label: string; group: string }[] = [
  { value: 'alarm_response',       label: 'Alarm Response',         group: 'Alarm' },
  { value: 'alarm_reset',          label: 'Alarm Reset',            group: 'Alarm' },
  { value: 'first_line_one_guard', label: 'First Line One Guard',   group: 'Alarm' },
  { value: 'first_line_two_guard', label: 'First Line Two Guard',   group: 'Alarm' },
  { value: 'second_line_response', label: 'Second Line Response',   group: 'Alarm' },
  { value: 'permanent_patrol',     label: 'Permanent Patrol',       group: 'Patrol' },
  { value: 'casual_patrol',        label: 'Casual Patrol',          group: 'Patrol' },
  { value: 'key_collection',       label: 'Key Collection',         group: 'Keys' },
  { value: 'key_return',           label: 'Key Return',             group: 'Keys' },
  { value: 'let_in',               label: 'Let In',                 group: 'Access' },
  { value: 'let_out',              label: 'Let Out',                group: 'Access' },
  { value: 'lockup',               label: 'Lockup',                 group: 'Access' },
  { value: 'open',                 label: 'Open',                   group: 'Access' },
  { value: 'escort',               label: 'Escort',                 group: 'Security' },
  { value: 'cash_in_transit',      label: 'Cash In Transit',        group: 'Security' },
  { value: 'welfare_check',        label: 'Welfare Check',          group: 'FieldOps' },
  { value: 'noise_complaint',      label: 'Noise Complaint',        group: 'FieldOps' },
  { value: 'freedom_camping',      label: 'Freedom Camping',        group: 'FieldOps' },
  { value: 'parking',              label: 'Parking',                group: 'FieldOps' },
  { value: 'general',              label: 'General',                group: 'FieldOps' },
]

const ALARM_TYPE_OPTIONS = [
  { value: 'intruder_alarm',  label: 'Intruder Alarm' },
  { value: 'duress_hold_up',  label: 'Duress / Hold Up' },
  { value: 'animal_control',  label: 'Animal Control' },
  { value: 'cardreader_fault',label: 'Cardreader Fault' },
  { value: 'late_to_close',   label: 'Late to Close' },
  { value: 'lock_broken',     label: 'Lock Broken' },
  { value: 'noise',           label: 'Noise' },
  { value: 'parking',         label: 'Parking' },
  { value: 'traffic',         label: 'Traffic' },
  { value: 'vandalism',       label: 'Vandalism' },
  { value: 'alarm_reset',     label: 'Alarm Reset' },
  { value: 'other',           label: 'Other' },
]

const ALARM_JOB_TYPES = ['alarm_response', 'first_line_one_guard', 'first_line_two_guard', 'second_line_response']

const STEPS = ['Select Site', 'Job Type', 'Assign Officer', 'Confirm & Dispatch']

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1
  client_site_id: string
  client_site_name: string
  client_site_code: string
  client_site_address: string
  // Step 2
  job_type: string
  alarm_type: string
  priority: string
  title: string
  description: string
  caller_name: string
  caller_phone: string
  // Step 3
  assigned_to: string
  officer_name: string
  call_sign: string
}

function emptyState(): WizardState {
  return {
    client_site_id: '', client_site_name: '', client_site_code: '', client_site_address: '',
    job_type: '', alarm_type: '', priority: 'normal', title: '', description: '',
    caller_name: '', caller_phone: '',
    assigned_to: '', officer_name: '', call_sign: '',
  }
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center flex-1">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 z-10 ${
            i < current ? 'bg-green-600 text-white' :
            i === current ? 'bg-blue-700 text-white' :
            'bg-gray-200 text-gray-500'
          }`}>
            {i < current ? <CheckCircle className="h-4 w-4" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 flex-1 ${i < current ? 'bg-green-600' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DispatchWizard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const orgId = user?.organization_id
  const { orgIds: clientOrgIds, isLoading: clientOrgIdsLoading } = useClientOrgIds()

  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>(emptyState())
  const [siteSearch, setSiteSearch] = useState('')

  // ── Data queries ───────────────────────────────────────────────────────────

  const { data: clientSites = [] } = useQuery({
    queryKey: ['wizard-client-sites', orgId, clientOrgIds],
    queryFn: async () => {
      let query = (supabase as any)
        .from('client_sites')
        .select('id, name, address, city, contact_phone')
        .eq('is_active', true)
        .order('name')

      if (clientOrgIds !== null) query = query.in('organization_id', clientOrgIds)

      const { data, error } = await query
      if (error) throw error
      return data as any[]
    },
    enabled: !!orgId && !clientOrgIdsLoading,
  })

  const { data: officers = [] } = useQuery({
    queryKey: ['wizard-officers', orgId],
    queryFn: async () => {
      // Officers currently on shift
      const { data: shiftData } = await (supabase as any)
        .from('officer_shifts')
        .select('officer_id')
        .eq('organization_id', orgId ?? '')
        .is('ended_at', null)
      const onShiftIds = (shiftData ?? []).map((s: any) => s.officer_id)

      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select(`
          id, first_name, last_name, phone, role,
          current_patrol:patrols!assigned_to(id, status, patrol_route:patrol_routes!patrol_route_id(route_name))
        `)
        .eq('organization_id', orgId ?? '')
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return (data ?? []).map((o: any) => ({
        ...o,
        is_on_shift: onShiftIds.includes(o.id),
        call_sign: o.current_patrol?.[0]?.patrol_route?.route_name ?? null,
        active_patrol_count: (o.current_patrol ?? []).filter((p: any) => p.status === 'in_progress').length,
      }))
    },
    enabled: !!orgId,
  })

  // ── Dispatch mutation ──────────────────────────────────────────────────────

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const { data: job, error } = await insertDispatchJobWithAlarmTypeFallback<{ id: string; job_number: string }>({
          organization_id:  orgId,
          created_by:       user?.id,
          job_type:         state.job_type,
          alarm_type:       state.alarm_type || null,
          priority:         state.priority,
          title:            state.title || `${JOB_TYPE_OPTIONS.find(t => t.value === state.job_type)?.label ?? state.job_type} - ${state.client_site_name}`,
          description:      state.description || null,
          address:          state.client_site_address || null,
          caller_name:      state.caller_name || null,
          caller_phone:     state.caller_phone || null,
          client_site_id:   state.client_site_id || null,
          assigned_to:      state.assigned_to || null,
          status:           state.assigned_to ? 'dispatched' : 'pending',
          dispatched_at:    state.assigned_to ? new Date().toISOString() : null,
          dispatched_by:    state.assigned_to ? user?.id : null,
          response_sla_minutes: 60,
        }, 'id, job_number')
      if (error) throw error
      return job
    },
    onSuccess: (job: any) => {
      toast.success(`Job ${job.job_number} dispatched successfully`)
      navigate('/dispatch')
    },
    onError: (e: any) => toast.error(e.message ?? 'Dispatch failed'),
  })

  // ── Step helpers ───────────────────────────────────────────────────────────

  const filteredSites = clientSites.filter((s: any) => {
    const q = siteSearch.toLowerCase()
    return !q || s.name.toLowerCase().includes(q) || (s.city ?? '').toLowerCase().includes(q)
  })

  const canProceed = (() => {
    if (step === 0) return !!state.client_site_id
    if (step === 1) return !!state.job_type
    if (step === 2) return true // officer optional
    return true
  })()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Dispatch Wizard" description="4-step guided job creation and dispatch">
      <div className="max-w-2xl mx-auto space-y-4">
        <StepIndicator current={step} total={4} labels={STEPS} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-700 text-white text-sm font-bold">{step + 1}</span>
              {STEPS[step]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* ── Step 1: Select Site ─────────────────────────────────────── */}
            {step === 0 && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search by site name or client ID…"
                    value={siteSearch}
                    onChange={e => setSiteSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1.5 rounded-md border p-1">
                  {filteredSites.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">No client sites found</p>
                  )}
                  {filteredSites.map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => setState(st => ({
                        ...st,
                        client_site_id: s.id,
                        client_site_name: s.name,
                        client_site_code: '',
                        client_site_address: [s.address, s.city].filter(Boolean).join(', '),
                        caller_phone: s.contact_phone ?? st.caller_phone,
                      }))}
                      className={`w-full text-left p-3 rounded-md border transition-all ${
                        state.client_site_id === s.id
                          ? 'bg-blue-50 border-blue-400 dark:bg-blue-950/30'
                          : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-100 dark:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{s.name}</span>
                      </div>
                      {s.address && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />{[s.address, s.city].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
                {state.client_site_id && (
                  <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/20 border border-green-200 rounded-md px-3 py-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                    <span><strong>{state.client_site_code && `${state.client_site_code} – `}{state.client_site_name}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* ── Step 2: Job Type ────────────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Job Type <span className="text-destructive">*</span></Label>
                  <Select value={state.job_type} onValueChange={v => setState(s => ({ ...s, job_type: v, alarm_type: '' }))}>
                    <SelectTrigger><SelectValue placeholder="Select job type…" /></SelectTrigger>
                    <SelectContent>
                      {(['Alarm', 'Patrol', 'Keys', 'Access', 'Security', 'FieldOps'] as const).map(grp => {
                        const items = JOB_TYPE_OPTIONS.filter(o => o.group === grp)
                        if (!items.length) return null
                        return (
                          <div key={grp}>
                            <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{grp}</div>
                            {items.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </div>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {ALARM_JOB_TYPES.includes(state.job_type) && (
                  <div className="space-y-1.5">
                    <Label>Alarm Type</Label>
                    <Select value={state.alarm_type} onValueChange={v => setState(s => ({ ...s, alarm_type: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select alarm type…" /></SelectTrigger>
                      <SelectContent>
                        {ALARM_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Priority</Label>
                    <Select value={state.priority} onValueChange={v => setState(s => ({ ...s, priority: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['low','normal','high','urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Caller Phone</Label>
                    <Input type="tel" value={state.caller_phone} onChange={e => setState(s => ({ ...s, caller_phone: e.target.value }))} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Caller Name</Label>
                  <Input value={state.caller_name} onChange={e => setState(s => ({ ...s, caller_name: e.target.value }))} />
                </div>

                <div className="space-y-1.5">
                  <Label>Additional Details</Label>
                  <Textarea rows={2} value={state.description} onChange={e => setState(s => ({ ...s, description: e.target.value }))} />
                </div>
              </div>
            )}

            {/* ── Step 3: Assign Officer ──────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Select an available officer. You can dispatch without assigning — the job will sit as Pending.</p>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  <button
                    onClick={() => setState(s => ({ ...s, assigned_to: '', officer_name: '', call_sign: '' }))}
                    className={`w-full text-left p-3 rounded-md border transition-all ${
                      !state.assigned_to ? 'bg-blue-50 border-blue-400 dark:bg-blue-950/30' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-sm text-muted-foreground italic">No assignment (Pending)</span>
                  </button>
                  {officers.map((o: any) => (
                    <button
                      key={o.id}
                      onClick={() => setState(s => ({ ...s, assigned_to: o.id, officer_name: `${o.first_name} ${o.last_name}`, call_sign: o.call_sign ?? '' }))}
                      className={`w-full text-left p-3 rounded-md border transition-all ${
                        state.assigned_to === o.id
                          ? 'bg-blue-50 border-blue-400 dark:bg-blue-950/30'
                          : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {o.call_sign && (
                          <Badge variant="outline" className="font-mono font-bold text-blue-700 border-blue-400 gap-0.5 text-xs">
                            <Radio className="h-3 w-3" />{o.call_sign}
                          </Badge>
                        )}
                        <span className="font-medium text-sm">{o.first_name} {o.last_name}</span>
                        <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                          o.is_on_shift && o.active_patrol_count === 0
                            ? 'bg-green-100 text-green-700'
                            : o.is_on_shift
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {o.is_on_shift ? (o.active_patrol_count > 0 ? `${o.active_patrol_count} active` : 'Available') : 'Off shift'}
                        </span>
                      </div>
                      {o.phone && (
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Phone className="h-3 w-3" />{o.phone}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 4: Confirm ─────────────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Client Site</span>
                    <span className="font-medium">{state.client_site_code ? `${state.client_site_code} – ` : ''}{state.client_site_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Job Type</span>
                    <span className="font-medium">{JOB_TYPE_OPTIONS.find(t => t.value === state.job_type)?.label ?? state.job_type}</span>
                  </div>
                  {state.alarm_type && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Alarm Type</span>
                      <span className="font-medium">{ALARM_TYPE_OPTIONS.find(t => t.value === state.alarm_type)?.label ?? state.alarm_type}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Priority</span>
                    <span className={`font-bold capitalize ${state.priority === 'urgent' ? 'text-red-600' : state.priority === 'high' ? 'text-orange-600' : ''}`}>{state.priority}</span>
                  </div>
                  {state.client_site_address && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Address</span>
                      <span className="font-medium">{state.client_site_address}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Assigned To</span>
                    <span className="font-medium">
                      {state.officer_name
                        ? <span className="flex items-center gap-1">{state.call_sign && <Badge variant="outline" className="font-mono text-xs">{state.call_sign}</Badge>}{state.officer_name}</span>
                        : <span className="text-muted-foreground italic">Unassigned (Pending)</span>}
                    </span>
                  </div>
                  {state.caller_name && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Caller</span>
                      <span className="font-medium">{state.caller_name} {state.caller_phone && `(${state.caller_phone})`}</span>
                    </div>
                  )}
                  {state.description && (
                    <div className="pt-2 border-t">
                      <p className="text-muted-foreground text-xs mb-1">Notes</p>
                      <p>{state.description}</p>
                    </div>
                  )}
                </div>
                {state.priority === 'urgent' && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-sm text-red-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Urgent priority — this job will be flagged for immediate response.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Navigation ──────────────────────────────────────────────────── */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => step === 0 ? navigate('/dispatch') : setStep(s => s - 1)}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>

          {step < 3 ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed}
              className="gap-1.5 bg-blue-700 hover:bg-blue-800"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={() => dispatchMutation.mutate()}
              disabled={dispatchMutation.isPending}
              className="gap-1.5 bg-blue-700 hover:bg-blue-800"
            >
              <Zap className="h-4 w-4" />
              {dispatchMutation.isPending ? 'Dispatching…' : state.assigned_to ? 'Dispatch Now' : 'Create Job (Pending)'}
            </Button>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
