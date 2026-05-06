/**
 * TravelAllowances — B-55
 *
 * Travel allowance management with approve/reject workflow.
 * Deep-linkable from CalloutShifts via ?callout_shift_id=<id>.
 *
 * Features:
 *  - KPI cards: Pending / Approved / Rejected / Total Approved Pay
 *  - Approve / Reject actions with admin notes
 *  - Filter by status, officer, date range; deep-link pre-filter
 *  - Distance/time/total pay display
 *  - Link back to the callout shift
 *
 * Route: /travel-allowances  — admin/admin_officer/master
 * Note: travel_allowances not in database.ts snapshot — uses (supabase as any)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Car, CheckCircle, XCircle, Clock, AlertCircle,
  Loader2, RefreshCw, Filter, MapPin, Timer, DollarSign, Siren,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ───────────────────────────────────────────────────────────────────

interface OfficerOption {
  id: string
  full_name: string
}

interface TravelAllowance {
  id: string
  organization_id: string
  officer_id: string
  officer?: OfficerOption
  callout_shift_id: string | null
  roster_shift_id: string | null
  travel_date: string
  journey_type: string
  origin_address: string | null
  destination_address: string | null
  distance_km: number | null
  distance_in_jurisdiction_km: number | null
  distance_out_of_jurisdiction_km: number | null
  is_outside_jurisdiction: boolean
  travel_start_time: string | null
  travel_end_time: string | null
  travel_duration_minutes: number | null
  rate_per_km: number | null
  rate_per_hour: number | null
  distance_pay_amount: number | null
  time_pay_amount: number | null
  total_pay_amount: number | null
  status: string
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  admin_notes: string | null
  created_at: string
}

const STATUS_COLOURS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-blue-100 text-blue-800',
}

const JOURNEY_TYPE_LABELS: Record<string, string> = {
  outbound: 'Outbound',
  return: 'Return',
  round_trip: 'Round Trip',
  site_to_site: 'Site to Site',
}

function fmtMoney(n: number | null) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TravelAllowances() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const deepLinkCalloutId = searchParams.get('callout_shift_id')

  const [officerFilter, setOfficerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Approve/reject dialog
  const [actionDialog, setActionDialog] = useState<{ id: string; action: 'approved' | 'rejected' } | null>(null)
  const [adminNote, setAdminNote] = useState('')

  // ── Fetch officers ──────────────────────────────────────────────────────────
  const { data: officers = [] } = useQuery<OfficerOption[]>({
    queryKey: ['travel-officers', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('id, full_name')
        .eq('organization_id', orgId)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as OfficerOption[]
    },
    enabled: !!orgId,
  })

  // ── Fetch travel allowances ─────────────────────────────────────────────────
  const { data: allowances = [], isLoading, refetch } = useQuery<TravelAllowance[]>({
    queryKey: ['travel-allowances', orgId, officerFilter, statusFilter, dateFrom, dateTo, deepLinkCalloutId],
    queryFn: async () => {
      let q = (supabase as any)
        .from('travel_allowances')
        .select(`
          *,
          officer:user_profiles!travel_allowances_officer_id_fkey(id, full_name)
        `)
        .eq('organization_id', orgId)
        .order('travel_date', { ascending: false })
        .limit(200)

      if (deepLinkCalloutId) q = q.eq('callout_shift_id', deepLinkCalloutId)
      if (officerFilter !== 'all') q = q.eq('officer_id', officerFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom) q = q.gte('travel_date', dateFrom)
      if (dateTo) q = q.lte('travel_date', dateTo)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as TravelAllowance[]
    },
    enabled: !!orgId,
  })

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = {
    pending: allowances.filter((a) => a.status === 'pending').length,
    approved: allowances.filter((a) => a.status === 'approved').length,
    rejected: allowances.filter((a) => a.status === 'rejected').length,
    totalApproved: allowances
      .filter((a) => ['approved', 'paid'].includes(a.status))
      .reduce((s, a) => s + (a.total_pay_amount ?? 0), 0),
    totalDistanceKm: allowances.reduce((s, a) => s + (a.distance_km ?? 0), 0),
  }

  // ── Approve / Reject mutation ───────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note: string }) => {
      const update: Record<string, any> = {
        status,
        admin_notes: note || null,
      }
      if (status === 'approved') {
        update.approved_at = new Date().toISOString()
      }
      const { error } = await (supabase as any)
        .from('travel_allowances')
        .update(update)
        .eq('id', id)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(`Travel allowance ${vars.status}`)
      setActionDialog(null)
      setAdminNote('')
      queryClient.invalidateQueries({ queryKey: ['travel-allowances'] })
    },
    onError: (err: any) => toast.error(err.message ?? 'Update failed'),
  })

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Car className="h-6 w-6 text-primary" />
              Travel Allowances
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Review and approve officer travel claims
              {deepLinkCalloutId && (
                <span className="ml-2 text-primary font-medium">
                  — filtered by callout shift
                  <button
                    className="ml-1 underline text-xs"
                    onClick={() => navigate('/travel-allowances')}
                  >
                    Clear
                  </button>
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/callout-shifts')}>
              <Siren className="h-4 w-4 mr-1" /> Callout Shifts
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Pending', value: kpis.pending, icon: Clock, colour: 'text-yellow-600' },
            { label: 'Approved', value: kpis.approved, icon: CheckCircle, colour: 'text-green-600' },
            { label: 'Rejected', value: kpis.rejected, icon: XCircle, colour: 'text-red-600' },
            { label: 'Total Approved', value: fmtMoney(kpis.totalApproved), icon: DollarSign, colour: 'text-emerald-600' },
            { label: 'Total km', value: `${kpis.totalDistanceKm.toFixed(1)} km`, icon: MapPin, colour: 'text-blue-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold">{value}</p>
                  </div>
                  <Icon className={`h-7 w-7 ${colour} opacity-70`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">Officer</Label>
                <Select value={officerFilter} onValueChange={setOfficerFilter}>
                  <SelectTrigger className="h-8 text-sm w-44">
                    <SelectValue placeholder="All officers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Officers</SelectItem>
                    {officers.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Date From</Label>
                <Input type="date" className="h-8 text-sm w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Date To</Label>
                <Input type="date" className="h-8 text-sm w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setOfficerFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo('') }}>
                <Filter className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Travel Claims ({allowances.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : allowances.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>No travel claims found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Officer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Journey</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Total Pay</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Outside Jx</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allowances.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm font-medium">{a.officer?.full_name ?? '—'}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {a.travel_date ? format(parseISO(a.travel_date), 'dd MMM yyyy') : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{JOURNEY_TYPE_LABELS[a.journey_type] ?? a.journey_type}</TableCell>
                      <TableCell className="text-sm max-w-[160px] truncate">
                        {a.destination_address
                          ? <><MapPin className="h-3 w-3 inline mr-1 text-muted-foreground" />{a.destination_address}</>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {a.distance_km != null ? `${Number(a.distance_km).toFixed(1)} km` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {a.travel_duration_minutes != null
                          ? `${Math.floor(a.travel_duration_minutes / 60)}h ${a.travel_duration_minutes % 60}m`
                          : '—'
                        }
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">{fmtMoney(a.total_pay_amount)}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLOURS[a.status] ?? ''}>{a.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {a.is_outside_jurisdiction ? (
                          <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">Yes</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.status === 'pending' && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-green-700 border-green-300"
                              onClick={() => setActionDialog({ id: a.id, action: 'approved' })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-red-600 hover:text-red-700"
                              onClick={() => setActionDialog({ id: a.id, action: 'rejected' })}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                        {a.callout_shift_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => navigate(`/callout-shifts?on_call_period_id=${a.callout_shift_id}`)}
                          >
                            <Siren className="h-3 w-3 mr-1" /> Callout
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Approve/Reject Dialog */}
      {actionDialog && (
        <Dialog open onOpenChange={() => { setActionDialog(null); setAdminNote('') }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {actionDialog.action === 'approved' ? 'Approve' : 'Reject'} Travel Claim
              </DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-3">
              <div>
                <Label>Admin Notes (optional)</Label>
                <Textarea
                  placeholder={actionDialog.action === 'rejected' ? 'Reason for rejection...' : 'Optional notes...'}
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setActionDialog(null); setAdminNote('') }}>Cancel</Button>
              <Button
                variant={actionDialog.action === 'approved' ? 'default' : 'destructive'}
                onClick={() => statusMutation.mutate({ id: actionDialog.id, status: actionDialog.action, note: adminNote })}
                disabled={statusMutation.isPending}
              >
                {statusMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : actionDialog.action === 'approved' ? 'Approve' : 'Reject'
                }
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AppLayout>
  )
}
