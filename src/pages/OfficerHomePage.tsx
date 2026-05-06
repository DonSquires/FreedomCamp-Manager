/**
 * OfficerHomePage
 *
 * Shown when an officer has no active roster shift for today.
 * The only actions available are:
 *   - Team Chat
 *   - View / claim Open Shifts
 *   - Request an Ad-hoc Shift
 *
 * If they are rostered but outside a geofence (non-patrol service) a warning
 * is shown instead and they are prompted to return to their assigned location.
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useRosteredShift } from '@/hooks/useRosteredShift'
import { useShiftGate } from '@/hooks/useShiftGate'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  MessageSquare,
  CalendarDays,
  ClipboardPlus,
  MapPin,
  AlertTriangle,
  Clock,
  LogOut,
  ChevronRight,
} from 'lucide-react'
import { PTTBar } from '@/components/features/PTTBar'
import { OfficerShell } from '@/components/features/OfficerShell'
import { OfficerLanguageSelector } from '@/components/features/OfficerLanguageSelector'
import { useOfficerLocale } from '@/hooks/useOfficerLocale'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { nzNow } from '@/lib/timezone'

export default function OfficerHomePage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { rosteredShift } = useRosteredShift()
  const { geofenceViolation, isRostered, hasActiveShift, activeShiftId } = useShiftGate()
  const { operationalOrganizationId } = useOperationalOrganization()
  const queryClient = useQueryClient()
  const { t } = useOfficerLocale()

  const [showAdhocDialog, setShowAdhocDialog] = useState(false)
  const [adhocDate, setAdhocDate] = useState(format(nzNow(), 'yyyy-MM-dd'))
  const [adhocStartTime, setAdhocStartTime] = useState('08:00')
  const [adhocEndTime, setAdhocEndTime] = useState('16:00')
  const [adhocNotes, setAdhocNotes] = useState('')
  const [adhocServiceType, setAdhocServiceType] = useState('freedom_camping')
  const [isEndingShift, setIsEndingShift] = useState(false)

  // ── End active shift from home page (e.g. stale/geofence-locked shift) ─────
  const handleEndShift = useCallback(async () => {
    if (!activeShiftId) return
    setIsEndingShift(true)
    try {
      const { error } = await (supabase.from('officer_shifts') as any)
        .update({ ended_at: new Date().toISOString() })
        .eq('id', activeShiftId)
      if (error) throw error

      // Deactivate welfare push schedule
      if (user?.id) {
        await supabase
          .from('welfare_push_schedule' as any)
          .update({ is_active: false })
          .eq('officer_id', user.id)
          .eq('is_active', true)
      }

      // Notify service worker to dismiss welfare notifications
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'WELFARE_SHIFT_END' })
      }

      toast.success('Shift ended — welfare monitoring stopped')
      queryClient.invalidateQueries({ queryKey: ['officer-active-shift-gate'] })
      queryClient.invalidateQueries({ queryKey: ['officer-active-shift'] })
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to end shift')
    } finally {
      setIsEndingShift(false)
    }
  }, [activeShiftId, user, queryClient])

  // ── Ad-hoc shift request ──────────────────────────────────────────────────
  const requestAdhocMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id || !operationalOrganizationId) {
        throw new Error('Missing user or organisation context')
      }
      const { error } = await (supabase.from('roster_shifts') as any).insert({
        officer_id:      user.id,
        organization_id: operationalOrganizationId,
        shift_date:      adhocDate,
        start_time:      `${adhocDate}T${adhocStartTime}:00`,
        end_time:        `${adhocDate}T${adhocEndTime}:00`,
        shift_type:      'custom',
        service_type:    adhocServiceType,
        status:          'draft',
        notes:           adhocNotes || null,
        internal_notes:  'Ad-hoc request submitted by officer via OfficerHomePage',
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Ad-hoc shift request submitted — your supervisor will review it')
      setShowAdhocDialog(false)
      setAdhocNotes('')
      queryClient.invalidateQueries({ queryKey: ['rostered_shift_today', user?.id] })
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to submit shift request')
    },
  })

  const today = format(nzNow(), 'EEEE d MMMM yyyy')

  return (
    <OfficerShell
      title={user?.first_name ? `Hi, ${user.first_name}` : 'Officer Home'}
      description={today}
    >

      <div className="mb-3 flex w-full items-center justify-between">
        <OfficerLanguageSelector />
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-500 hover:text-red-600"
          onClick={() => navigate('/login')}
        >
          <LogOut className="h-4 w-4 mr-1" />
          Sign out
        </Button>
      </div>

      {/* PTT radio — navigate to /radio page from the sidebar nav */}
      <div className="border-b px-4 py-2">
        <PTTBar />
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-0 py-8 gap-6 max-w-md mx-auto w-full">

        {/* ── Status banner ──────────────────────────────────────────────── */}
        {geofenceViolation && isRostered ? (
          <div className="w-full rounded-xl border border-orange-300 bg-orange-50 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">You are outside your assigned zone</p>
              <p className="text-xs text-orange-600 mt-0.5">
                Your supervisor has been notified. Return to your assigned location to regain portal access.
              </p>
              {rosteredShift && (
                <p className="text-xs text-orange-500 mt-1">
                  Rostered zone: {rosteredShift.client_site_name || rosteredShift.zone_id || 'assigned area'}
                </p>
              )}
            </div>
          </div>
        ) : !isRostered ? (
          <div className="w-full rounded-xl border border-blue-200 bg-blue-50 p-4 flex gap-3 dark:border-blue-800 dark:bg-blue-950/50">
            <CalendarDays className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">You are not rostered today</p>
              <p className="text-xs text-blue-600 mt-0.5 dark:text-blue-300">
                You can view available open shifts, request an ad-hoc shift, or use team chat below.
              </p>
            </div>
          </div>
        ) : hasActiveShift ? (
          <div className="w-full rounded-xl border border-green-200 bg-green-50 p-4 flex gap-3 dark:border-green-800 dark:bg-green-950/50">
            <MapPin className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800 dark:text-green-200">Shift active – waiting for geofence</p>
              <p className="text-xs text-green-600 mt-0.5 dark:text-green-300">
                Move into your assigned zone to unlock the full portal.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleEndShift}
                disabled={isEndingShift}
                className="mt-2 min-h-11 text-xs border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                {isEndingShift ? t.officer.endingShift : t.officer.endShift}
              </Button>
            </div>
          </div>
        ) : (
          <div className="w-full rounded-xl border border-yellow-200 bg-yellow-50 p-4 flex gap-3 dark:border-yellow-800 dark:bg-yellow-950/40">
            <Clock className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">Your shift has not started yet</p>
              <p className="text-xs text-yellow-600 mt-0.5 dark:text-yellow-300">
                You are rostered today. Start your shift in the portal once you are on-site.
              </p>
              {rosteredShift && (
                <p className="text-xs text-yellow-500 mt-1 dark:text-yellow-300">
                  {rosteredShift.start_time
                    ? `Scheduled start: ${rosteredShift.start_time.substring(11, 16)}`
                    : null}
                  {rosteredShift.client_site_name ? ` · ${rosteredShift.client_site_name}` : ''}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Today's shift card (if rostered) */}
        {rosteredShift && (
          <div className="w-full rounded-xl border bg-white shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Today's Shift</p>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {rosteredShift.position_title || rosteredShift.service_type?.replace(/_/g, ' ') || 'Shift'}
                </p>
                {rosteredShift.client_site_name && (
                  <p className="text-xs text-gray-500">{rosteredShift.client_org_name ? `${rosteredShift.client_org_name} · ` : ''}{rosteredShift.client_site_name}</p>
                )}
                {(rosteredShift.start_time || rosteredShift.end_time) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {rosteredShift.start_time?.substring(11, 16)} – {rosteredShift.end_time?.substring(11, 16)}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="capitalize text-xs shrink-0">
                {rosteredShift.status}
              </Badge>
            </div>
          </div>
        )}

        {/* ── Action tiles ─────────────────────────────────────────────────── */}
        <div className="w-full grid gap-3">
          {/* Team Chat — always available */}
          <button
            onClick={() => navigate('/team-chat')}
            className="w-full min-h-14 flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.officer.teamChat}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Message your team and supervisors</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
          </button>

          {/* Open Shifts */}
          <button
            onClick={() => navigate('/open-shifts')}
            className="w-full min-h-14 flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-950/50 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-green-600 dark:text-green-300" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.officer.viewOpenShifts}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Browse and claim open shifts</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
          </button>

          {/* Request Ad-hoc Shift */}
          <button
            onClick={() => setShowAdhocDialog(true)}
            className="w-full min-h-14 flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-700 dark:hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center">
                <ClipboardPlus className="h-5 w-5 text-amber-600 dark:text-amber-300" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.officer.requestAdHocShift}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Submit an availability request for supervisor review</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
          </button>
        </div>
      </main>

      {/* ── Ad-hoc request dialog ─────────────────────────────────────────── */}
      <Dialog open={showAdhocDialog} onOpenChange={setShowAdhocDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.officer.requestAdHocShift}</DialogTitle>
            <DialogDescription>
              Your supervisor will review and approve or decline this request.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={adhocDate}
                onChange={(e) => setAdhocDate(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Time</Label>
                <Input
                  type="time"
                  className="mt-1"
                  value={adhocStartTime}
                  onChange={(e) => setAdhocStartTime(e.target.value)}
                />
              </div>
              <div>
                <Label>End Time</Label>
                <Input
                  type="time"
                  className="mt-1"
                  value={adhocEndTime}
                  onChange={(e) => setAdhocEndTime(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Service Type</Label>
              <Select value={adhocServiceType} onValueChange={setAdhocServiceType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {([
                    ['freedom_camping', 'Freedom Camping Patrol'],
                    ['guarding',        'Site Guarding'],
                    ['parking',         'Parking Enforcement'],
                    ['noise',           'Noise Control'],
                    ['patrol',          'General Patrol'],
                    ['alarm_response',  'Alarm Response'],
                    ['ems',             'EMS (Electronic Monitoring)'],
                  ] as const).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="Reason for request, site preference, etc."
                value={adhocNotes}
                onChange={(e) => setAdhocNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdhocDialog(false)}>
              {t.officer.cancel}
            </Button>
            <Button
              onClick={() => requestAdhocMutation.mutate()}
              disabled={requestAdhocMutation.isPending}
            >
              {requestAdhocMutation.isPending ? t.officer.submitting : t.officer.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OfficerShell>
  )
}
