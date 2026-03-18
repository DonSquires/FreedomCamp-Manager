/**
 * OfficerFollowUpQueue
 *
 * Shows breach_alerts that admin has assigned to the current officer, with
 * clear instructions on what action to take.
 *
 * Used inside FieldOfficerPortal below the scan action cards.
 *
 * Features:
 *  - Fetches breach_alerts WHERE assigned_to = user.id AND status not final
 *  - Displays: plate, breach type, zone, admin instructions, due date, action required
 *  - "Mark Complete" → sets status = 'resolved' + records completion
 *  - Badge count exposed via `count` prop callback for portal header badge
 *  - Welfare: any interaction resets man-down timer via onActivity()
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import {
  ClipboardList, CheckCircle, AlertTriangle, MapPin, Calendar,
  Clock, ChevronDown, ChevronUp, Loader2, FileWarning, Printer, ExternalLink, Search,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssignedFollow {
  id: string
  plate_number: string | null
  breach_type: string
  zone_id: string
  observation_id: string | null
  status: string
  admin_review_notes: string | null
  due_date: string | null
  assigned_at: string | null
  zone: { name: string } | null
}

interface OfficerFollowUpQueueProps {
  /** Called when count changes — lets portal show a badge */
  onCountChange?: (count: number) => void
  /** Called on any interaction to keep man-down timer alive */
  onActivity?: () => void
  /** Enforcement workflow for the org (admin_first | hybrid | officer_direct) */
  orgWorkflow?: string
  /** Trigger a warning or notice_to_vacate action */
  onIssueAction?: (p: { observationId: string; zoneId: string; plateNumber: string; actionType: string }) => void
  /** Whether an issue action is currently in-flight */
  isIssuingAction?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBreach(v: string) {
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function isDue(due: string | null): boolean {
  if (!due) return false
  return new Date(due) < new Date()
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OfficerFollowUpQueue({ onCountChange, onActivity, orgWorkflow, onIssueAction, isIssuingAction }: OfficerFollowUpQueueProps) {
  const { user }   = useAuthStore()
  const qc         = useQueryClient()
  const navigate   = useNavigate()

  const [expanded,         setExpanded]         = useState(true)
  const [completingId,     setCompletingId]      = useState<string | null>(null)
  const [completionNotes,  setCompletionNotes]   = useState('')

  // ── Fetch assigned follow-ups ─────────────────────────────────────────────
  const { data: followUps = [], isLoading } = useQuery({
    queryKey: ['officer-follow-ups', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await (supabase.from('breach_alerts') as any)
        .select(`
          id, plate_number, breach_type, zone_id, observation_id,
          status, admin_review_notes, due_date, assigned_at,
          zone:zones!zone_id(name)
        `)
        .eq('assigned_to', user.id)
        .not('status', 'in', '("resolved","dismissed")')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('assigned_at', { ascending: false })
        .limit(20)

      if (error) {
        console.warn('OfficerFollowUpQueue fetch error:', error.message)
        return []
      }

      const rows = (data || []) as AssignedFollow[]
      onCountChange?.(rows.length)
      return rows
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  })

  // ── Mark complete mutation ────────────────────────────────────────────────
  const completeMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await (supabase.from('breach_alerts') as any)
        .update({
          status:           'resolved',
          resolved_at:      new Date().toISOString(),
          resolution_notes: notes || 'Completed by officer',
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success('Follow-up marked as complete')
      qc.invalidateQueries({ queryKey: ['officer-follow-ups', user?.id] })
      qc.invalidateQueries({ queryKey: ['breach-alerts'] })
      setCompletingId(null)
      setCompletionNotes('')
      onActivity?.()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update'),
  })

  // ── Start/continue investigation from assigned follow-up ──────────────────
  const investigateMutation = useMutation({
    mutationFn: async (fu: AssignedFollow) => {
      if (!user?.id || !user.organization_id) {
        throw new Error('Session expired. Please sign in again.')
      }
      if (!fu.observation_id) {
        throw new Error('No linked observation found for this follow-up.')
      }

      // Reuse an active job for this observation if one already exists.
      const { data: existingJob, error: existingErr } = await (supabase.from('investigation_jobs') as any)
        .select('id')
        .eq('organization_id', user.organization_id)
        .eq('associated_observation_id', fu.observation_id)
        .in('status', ['pending', 'assigned', 'in_progress', 'overdue'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingErr) throw existingErr
      if (existingJob?.id) return { reused: true as const, id: existingJob.id as string }

      const referenceNumber = `BR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${(fu.plate_number || 'UNK').replace(/\s+/g, '').toUpperCase()}`
      const jobTitle = `Investigate breach follow-up: ${fu.plate_number || 'Unknown vehicle'}`
      const jobDescription = fu.admin_review_notes?.trim()
        ? `Assigned from breach alert ${fu.id}. Officer instructions: ${fu.admin_review_notes.trim()}`
        : `Assigned from breach alert ${fu.id}.`

      const { data: inserted, error: insertErr } = await (supabase.from('investigation_jobs') as any)
        .insert({
          organization_id: user.organization_id,
          created_by: user.id,
          assigned_to: user.id,
          associated_observation_id: fu.observation_id,
          associated_zone_id: fu.zone_id || null,
          zone_id: fu.zone_id || null,
          reference_number: referenceNumber,
          job_type: 'breach_follow_up',
          title: jobTitle,
          description: jobDescription,
          priority: isDue(fu.due_date) ? 'high' : 'normal',
          status: 'assigned',
          followup_notes: fu.admin_review_notes || null,
        })
        .select('id')
        .single()

      if (insertErr) throw insertErr
      return { reused: false as const, id: inserted.id as string }
    },
    onSuccess: (result) => {
      toast.success(result.reused ? 'Opened existing investigation job' : 'Investigation job created')
      onActivity?.()
      navigate(`/investigations?job_id=${encodeURIComponent(result.id)}`)
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to start investigation')
    },
  })

  if (isLoading || followUps.length === 0) return null

  const overdueCount = followUps.filter(f => isDue(f.due_date)).length

  return (
    <Card className={`mt-4 border-2 ${overdueCount > 0 ? 'border-red-400' : 'border-blue-300 dark:border-blue-800'}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-blue-600" />
            Admin-Assigned Follow-Ups
            <Badge
              className={`text-[10px] ${overdueCount > 0 ? 'bg-red-600 text-white animate-pulse' : 'bg-blue-600 text-white'}`}
            >
              {followUps.length}
              {overdueCount > 0 && ` · ${overdueCount} overdue`}
            </Badge>
          </CardTitle>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(p => !p)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="px-4 pb-4 space-y-3 pt-0">
          {followUps.map(fu => {
            const overdue = isDue(fu.due_date)
            const isCompleting = completingId === fu.id

            return (
              <div
                key={fu.id}
                className={`rounded-xl border p-3 space-y-2 ${
                  overdue
                    ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
                    : 'border-blue-200 bg-blue-50/50 dark:bg-blue-950/20'
                }`}
              >
                {/* Plate + breach type */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-base">
                    {fu.plate_number || 'Unknown'}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                    {fmtBreach(fu.breach_type)}
                  </Badge>
                  {overdue && (
                    <Badge className="text-[10px] bg-red-600 text-white animate-pulse">
                      ⏰ Overdue
                    </Badge>
                  )}
                </div>

                {/* Zone + assigned date */}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {fu.zone?.name && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{fu.zone.name}
                    </span>
                  )}
                  {fu.assigned_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />Assigned {formatDateTime(fu.assigned_at)}
                    </span>
                  )}
                  {fu.due_date && (
                    <span className={`flex items-center gap-1 font-medium ${overdue ? 'text-red-700' : 'text-orange-700'}`}>
                      <Calendar className="h-3 w-3" />
                      Due: {new Date(fu.due_date).toLocaleDateString('en-NZ')}
                    </span>
                  )}
                </div>

                {/* Admin instructions */}
                {fu.admin_review_notes && (
                  <div className="rounded-lg border border-blue-200 bg-white dark:bg-slate-900 p-2.5">
                    <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide mb-1">
                      Admin Instructions
                    </p>
                    <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
                      {fu.admin_review_notes}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                {!isCompleting && (
                  <div className="flex flex-wrap gap-1.5">
                    {/* Open in Breach Alerts */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                      onClick={() => { onActivity?.(); navigate('/breaches') }}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View Alert
                    </Button>

                    {/* Issue Warning — hybrid or officer_direct only, needs observation */}
                    {fu.observation_id && (orgWorkflow === 'officer_direct' || orgWorkflow === 'hybrid') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                        disabled={isIssuingAction}
                        onClick={() => {
                          onActivity?.()
                          onIssueAction?.({
                            observationId: fu.observation_id!,
                            zoneId: fu.zone_id,
                            plateNumber: fu.plate_number || '',
                            actionType: 'warning',
                          })
                        }}
                      >
                        <FileWarning className="h-3 w-3 mr-1" />
                        Warning
                      </Button>
                    )}

                    {/* Issue Infringement Ticket — needs observation */}
                    {fu.observation_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                        onClick={() => {
                          onActivity?.()
                          navigate(`/infringements?observation_id=${encodeURIComponent(fu.observation_id!)}&breach_alert_id=${encodeURIComponent(fu.id)}`)
                        }}
                      >
                        <Printer className="h-3 w-3 mr-1" />
                        Issue Ticket
                      </Button>
                    )}

                    {/* Start investigation from this follow-up */}
                    {fu.observation_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs border-purple-400 text-purple-700 hover:bg-purple-50"
                        disabled={investigateMutation.isPending}
                        onClick={() => investigateMutation.mutate(fu)}
                      >
                        <Search className="h-3 w-3 mr-1" />
                        Investigate
                      </Button>
                    )}

                    {/* Mark complete */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs border-green-400 text-green-700 hover:bg-green-50"
                      onClick={() => { setCompletingId(fu.id); setCompletionNotes(''); onActivity?.() }}
                    >
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Complete
                    </Button>
                  </div>
                )}

                {/* Complete confirmation flow */}
                {isCompleting && (
                  <div className="space-y-2">
                    <Textarea
                      value={completionNotes}
                      onChange={e => setCompletionNotes(e.target.value)}
                      rows={2}
                      className="text-sm resize-none"
                      placeholder="Optional: describe what action you took…"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={() => completeMutation.mutate({ id: fu.id, notes: completionNotes })}
                        disabled={completeMutation.isPending}
                      >
                        {completeMutation.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <><CheckCircle className="h-3 w-3 mr-1" />Confirm Complete</>}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => { setCompletingId(null); setCompletionNotes('') }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      )}
    </Card>
  )
}
