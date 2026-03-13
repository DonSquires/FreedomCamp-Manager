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
  Clock, ChevronDown, ChevronUp, Loader2,
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

export function OfficerFollowUpQueue({ onCountChange, onActivity }: OfficerFollowUpQueueProps) {
  const { user } = useAuthStore()
  const qc       = useQueryClient()

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

                {/* Complete flow */}
                {isCompleting ? (
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
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                    onClick={() => { setCompletingId(fu.id); setCompletionNotes(''); onActivity?.() }}
                  >
                    <CheckCircle className="h-3 w-3 mr-1.5" />
                    Mark as Completed
                  </Button>
                )}
              </div>
            )
          })}
        </CardContent>
      )}
    </Card>
  )
}
