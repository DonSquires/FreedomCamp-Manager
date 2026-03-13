/**
 * AdminFollowUpDrawer
 *
 * Opened from the BreachAlerts Decision Dock when admin wants to assign a
 * breach follow-up to a field officer.
 *
 * What it does:
 *  - Shows full breach + observation context (plate, zone, type, photo)
 *  - Admin selects the action the officer must take on-site
 *  - Admin writes instructions that the officer will see in their portal
 *  - Optionally sets a due date
 *  - Assigns breach_alert to the selected officer
 *  - Records admin review fields (admin_reviewed_by, admin_reviewed_at, admin_review_notes)
 *  - Creates an enforcement_action record when a formal action is chosen
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import {
  UserCheck, MapPin, AlertTriangle, Calendar, FileWarning,
  Megaphone, Shield, CheckCircle, ClipboardList, Loader2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BreachSummary {
  id: string
  organization_id: string
  plate_number: string | null
  breach_type: string
  zone_id: string
  observation_id: string | null
  status: string
  admin_review_notes: string | null
  assigned_to: string | null
  due_date: string | null
}

interface AdminFollowUpDrawerProps {
  open: boolean
  onClose: () => void
  breach: BreachSummary | null
}

// ─── Action options ───────────────────────────────────────────────────────────

const ACTION_OPTIONS = [
  { value: 'no_action',           label: 'Monitor only — no action required',   icon: Shield },
  { value: 'verbal_warning',      label: 'Issue verbal warning on-site',         icon: FileWarning },
  { value: 'written_warning',     label: 'Deliver written warning notice',       icon: FileWarning },
  { value: 'notice_to_vacate',    label: 'Issue Notice to Vacate',               icon: Megaphone },
  { value: 'infringement_notice', label: 'Issue Infringement Notice (fine)',     icon: AlertTriangle },
  { value: 'evidence_gather',     label: 'Attend and gather further evidence',   icon: ClipboardList },
  { value: 'refer_to_council',    label: 'Refer to council / third party',       icon: Shield },
] as const

type ActionValue = typeof ACTION_OPTIONS[number]['value']

function fmtBreach(v: string) {
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminFollowUpDrawer({ open, onClose, breach }: AdminFollowUpDrawerProps) {
  const { user }   = useAuthStore()
  const qc         = useQueryClient()

  const [assignTo,      setAssignTo]      = useState<string>('')
  const [actionType,    setActionType]    = useState<ActionValue>('verbal_warning')
  const [instructions,  setInstructions]  = useState('')
  const [dueDate,       setDueDate]       = useState('')

  // Reset form when a new breach is opened
  const resetForm = () => {
    setAssignTo(breach?.assigned_to ?? '')
    setActionType('verbal_warning')
    setInstructions(breach?.admin_review_notes ?? '')
    setDueDate(breach?.due_date ? breach.due_date.slice(0, 10) : '')
  }

  // ── Fetch org officers ────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery({
    queryKey: ['org-officers', breach?.organization_id],
    queryFn: async () => {
      if (!breach?.organization_id) return []
      const { data } = await (supabase.from('user_profiles') as any)
        .select('id, first_name, last_name, role')
        .eq('organization_id', breach.organization_id)
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)
        .order('first_name')
      return (data || []) as Array<{ id: string; first_name: string; last_name: string; role: string }>
    },
    enabled: !!breach?.organization_id && open,
  })

  // ── Assign follow-up mutation ─────────────────────────────────────────────
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!breach || !user) throw new Error('No breach or user')
      if (!assignTo) throw new Error('Please select an officer to assign to')
      if (!instructions.trim()) throw new Error('Please add instructions for the officer')

      const nowIso = new Date().toISOString()

      // 1. Update breach_alert
      const { error: baErr } = await (supabase.from('breach_alerts') as any)
        .update({
          assigned_to:          assignTo,
          assigned_by:          user.id,
          assigned_at:          nowIso,
          admin_reviewed_by:    user.id,
          admin_reviewed_at:    nowIso,
          admin_review_notes:   instructions.trim(),
          status:               'acknowledged',
          due_date:             dueDate ? new Date(dueDate).toISOString() : null,
        })
        .eq('id', breach.id)
      if (baErr) throw baErr

      // 2. Create enforcement_action record for formal actions
      const formalActions = ['written_warning', 'notice_to_vacate', 'infringement_notice']
      if (formalActions.includes(actionType)) {
        const { error: eaErr } = await (supabase.from('enforcement_actions') as any)
          .insert({
            organization_id:  breach.organization_id,
            zone_id:          breach.zone_id,
            observation_id:   breach.observation_id,
            plate_number:     breach.plate_number,
            action_type:      actionType,
            status:           'pending',
            notes:            instructions.trim(),
            created_by:       user.id,
            assigned_to:      assignTo,
            assigned_at:      nowIso,
            assigned_by:      user.id,
            breach_status:    'active',
          })
        if (eaErr) throw eaErr
      }
    },
    onSuccess: () => {
      toast.success('Follow-up assigned to officer')
      qc.invalidateQueries({ queryKey: ['breach-alerts'] })
      qc.invalidateQueries({ queryKey: ['officer-follow-ups'] })
      qc.invalidateQueries({ queryKey: ['enforcement-actions'] })
      onClose()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to assign follow-up'),
  })

  if (!breach) return null

  const selectedAction = ACTION_OPTIONS.find(a => a.value === actionType)
  const ActionIcon = selectedAction?.icon ?? Shield

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto flex flex-col gap-0 p-0">

        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-blue-600" />
            Assign Field Follow-Up
          </SheetTitle>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="outline" className="font-mono font-bold">
              {breach.plate_number || 'Unknown'}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              <AlertTriangle className="h-2.5 w-2.5 mr-1" />
              {fmtBreach(breach.breach_type)}
            </Badge>
            <Badge variant="outline" className="text-xs capitalize">
              {breach.status.replace(/_/g, ' ')}
            </Badge>
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Context block */}
          <div className="rounded-xl border bg-orange-50 dark:bg-orange-950/30 border-orange-200 p-3 space-y-1 text-sm">
            <p className="font-semibold text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" />
              Breach Requiring Field Action
            </p>
            <p className="text-xs text-orange-700 dark:text-orange-400">
              This breach needs an officer to attend on-site. Assign it to an officer with clear instructions
              so they can complete the required follow-up action.
            </p>
          </div>

          {/* 1. Action type */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <ActionIcon className="h-4 w-4 text-blue-600 shrink-0" />
              Action Required
            </Label>
            <Select value={actionType} onValueChange={v => setActionType(v as ActionValue)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select action type…" />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map(opt => {
                  const Icon = opt.icon
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {opt.label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* 2. Assign to officer */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1.5">
              <UserCheck className="h-4 w-4 text-blue-600 shrink-0" />
              Assign to Officer
            </Label>
            {officers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading officers…</p>
            ) : (
              <Select value={assignTo} onValueChange={setAssignTo}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select officer…" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.first_name} {o.last_name}
                      <span className="ml-2 text-xs text-muted-foreground capitalize">({o.role.replace(/_/g, ' ')})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 3. Instructions */}
          <div className="space-y-2">
            <Label htmlFor="af-instructions" className="text-sm font-semibold flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4 text-blue-600 shrink-0" />
              Instructions for Officer
            </Label>
            <Textarea
              id="af-instructions"
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={4}
              className="resize-none text-sm"
              placeholder={
                actionType === 'verbal_warning'
                  ? 'e.g. Vehicle has exceeded the 3-night limit. Issue a verbal warning and advise they must leave by tomorrow.'
                  : actionType === 'notice_to_vacate'
                  ? 'e.g. Third repeat breach. Serve NTV immediately. Vehicle must vacate within 24 hours.'
                  : 'Provide clear, specific instructions for the attending officer…'
              }
            />
            <p className="text-xs text-muted-foreground">
              These instructions will be visible to the assigned officer in their Field Portal.
            </p>
          </div>

          {/* 4. Due date */}
          <div className="space-y-2">
            <Label htmlFor="af-due" className="text-sm font-semibold flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-blue-600 shrink-0" />
              Due Date <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="af-due"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="h-10"
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>

          {/* Warning for formal actions */}
          {['written_warning', 'notice_to_vacate', 'infringement_notice'].includes(actionType) && (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 p-3 text-xs text-yellow-800 dark:text-yellow-400 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                A formal <strong>{fmtBreach(actionType)}</strong> enforcement action record will be
                created and assigned to this officer.
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <SheetFooter className="px-5 py-4 border-t shrink-0 flex flex-col gap-2">
          <Button
            className="w-full h-10"
            onClick={() => assignMutation.mutate()}
            disabled={assignMutation.isPending || !assignTo || !instructions.trim()}
          >
            {assignMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Assigning…</>
              : <><CheckCircle className="h-4 w-4 mr-2" />Assign Follow-Up to Officer</>}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
