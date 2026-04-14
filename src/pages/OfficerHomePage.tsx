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

import { useState } from 'react'
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
import { toast } from 'sonner'
import { format } from 'date-fns'
import { nzNow } from '@/lib/timezone'

export default function OfficerHomePage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { rosteredShift } = useRosteredShift()
  const { geofenceViolation, isRostered, hasActiveShift } = useShiftGate()
  const { operationalOrganizationId } = useOperationalOrganization()
  const queryClient = useQueryClient()

  const [showAdhocDialog, setShowAdhocDialog] = useState(false)
  const [adhocDate, setAdhocDate] = useState(format(nzNow(), 'yyyy-MM-dd'))
  const [adhocStartTime, setAdhocStartTime] = useState('08:00')
  const [adhocEndTime, setAdhocEndTime] = useState('16:00')
  const [adhocNotes, setAdhocNotes] = useState('')
  const [adhocServiceType, setAdhocServiceType] = useState('freedom_camping')

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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50 to-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/iron-eagle-security-logo.jpg"
            className="h-8 w-8 rounded object-cover"
            alt="Logo"
          />
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {user?.first_name ? `Hi, ${user.first_name}` : 'FieldOps Manager'}
            </p>
            <p className="text-xs text-gray-400">{today}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-500 hover:text-red-600"
          onClick={() => navigate('/login')}
        >
          <LogOut className="h-4 w-4 mr-1" />
          Sign out
        </Button>
      </header>

      {/* PTT bar — available regardless of shift/geofence state */}
      <PTTBar compact className="border-b" />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6 max-w-md mx-auto w-full">

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
          <div className="w-full rounded-xl border border-blue-200 bg-blue-50 p-4 flex gap-3">
            <CalendarDays className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-800">You are not rostered today</p>
              <p className="text-xs text-blue-600 mt-0.5">
                You can view available open shifts, request an ad-hoc shift, or use team chat below.
              </p>
            </div>
          </div>
        ) : hasActiveShift ? (
          <div className="w-full rounded-xl border border-green-200 bg-green-50 p-4 flex gap-3">
            <MapPin className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800">Shift active – waiting for geofence</p>
              <p className="text-xs text-green-600 mt-0.5">
                Move into your assigned zone to unlock the full portal.
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full rounded-xl border border-yellow-200 bg-yellow-50 p-4 flex gap-3">
            <Clock className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-yellow-800">Your shift has not started yet</p>
              <p className="text-xs text-yellow-600 mt-0.5">
                You are rostered today. Start your shift in the portal once you are on-site.
              </p>
              {rosteredShift && (
                <p className="text-xs text-yellow-500 mt-1">
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
            className="w-full flex items-center justify-between bg-white rounded-xl border shadow-sm p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900">Team Chat</p>
                <p className="text-xs text-gray-500">Message your team and supervisors</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </button>

          {/* Open Shifts */}
          <button
            onClick={() => navigate('/open-shifts')}
            className="w-full flex items-center justify-between bg-white rounded-xl border shadow-sm p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-green-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900">Browse Open Shifts</p>
                <p className="text-xs text-gray-500">Browse and claim open shifts</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </button>

          {/* Request Ad-hoc Shift */}
          <button
            onClick={() => setShowAdhocDialog(true)}
            className="w-full flex items-center justify-between bg-white rounded-xl border shadow-sm p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <ClipboardPlus className="h-5 w-5 text-amber-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900">Request Ad-hoc Shift</p>
                <p className="text-xs text-gray-500">Submit an availability request for supervisor review</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </main>

      {/* ── Ad-hoc request dialog ─────────────────────────────────────────── */}
      <Dialog open={showAdhocDialog} onOpenChange={setShowAdhocDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request Ad-hoc Shift</DialogTitle>
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
              Cancel
            </Button>
            <Button
              onClick={() => requestAdhocMutation.mutate()}
              disabled={requestAdhocMutation.isPending}
            >
              {requestAdhocMutation.isPending ? 'Submitting…' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
