import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { CalendarDays, CheckCircle, Clock, Filter, Plus, User, XCircle } from 'lucide-react'

type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

interface LeaveRequest {
  id: string
  officer_id: string | null
  organization_id: string
  leave_type_name: string
  leave_export_code: string | null
  is_paid: boolean
  date_start: string
  date_end: string
  time_start: string | null
  time_end: string | null
  total_hours: number | null
  status: LeaveStatus
  leave_comment: string | null
  manager_comment: string | null
  approved_by: string | null
  approved_at: string | null
  officer: {
    first_name: string | null
    last_name: string | null
    email: string
  } | null
  approved_by_user: {
    first_name: string | null
    last_name: string | null
  } | null
}

interface OfficerOption {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
}

const STATUS_META: Record<LeaveStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'border-yellow-300 text-yellow-700 bg-yellow-50' },
  approved: { label: 'Approved', className: 'border-green-300 text-green-700 bg-green-50' },
  rejected: { label: 'Rejected', className: 'border-red-300 text-red-700 bg-red-50' },
  cancelled: { label: 'Cancelled', className: 'border-gray-300 text-gray-700 bg-gray-50' },
}

function formatHours(hours: number | null): string {
  if (hours == null) return '—'
  return `${hours.toFixed(1)}h`
}

export default function LeaveManagement() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const isManager = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master'
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today)
  const [statusFilter, setStatusFilter] = useState<'all' | LeaveStatus>('all')
  const [officerFilter, setOfficerFilter] = useState('')
  const [reviewing, setReviewing] = useState<LeaveRequest | null>(null)
  const [managerComment, setManagerComment] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createDraft, setCreateDraft] = useState({
    officer_id: '',
    leave_type_name: 'Annual Leave',
    date_start: today,
    date_end: today,
    total_hours: '8',
    leave_comment: '',
    is_paid: 'true',
  })

  const { data: officers = [] } = useQuery<OfficerOption[]>({
    queryKey: ['leave_management_officers', user?.organization_id],
    enabled: !!user?.organization_id && isManager,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('user_profiles')
        .select('id, first_name, last_name, email')
        .eq('organization_id', user!.organization_id!)
        .eq('is_active', true)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return data as OfficerOption[]
    },
  })

  const { data: leaveRequests = [], isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ['leave_requests', user?.organization_id, dateFrom, dateTo],
    enabled: !!user?.organization_id,
    queryFn: async () => {
      let query = ((supabase as any).from('leave_requests') as any)
        .select(`
          id,
          officer_id,
          organization_id,
          leave_type_name,
          leave_export_code,
          is_paid,
          date_start,
          date_end,
          time_start,
          time_end,
          total_hours,
          status,
          leave_comment,
          manager_comment,
          approved_by,
          approved_at,
          officer:user_profiles!officer_id(first_name, last_name, email),
          approved_by_user:user_profiles!approved_by(first_name, last_name)
        `)
        .eq('organization_id', user!.organization_id!)
        .lte('date_start', dateTo)
        .gte('date_end', dateFrom)
        .order('date_start', { ascending: false })
      if (!isManager) query = query.eq('officer_id', user!.id)
      const { data, error } = await query
      if (error) throw error
      return data as LeaveRequest[]
    },
  })

  const filtered = useMemo(() => {
    return leaveRequests.filter((request) => {
      if (statusFilter !== 'all' && request.status !== statusFilter) return false
      if (!officerFilter.trim()) return true
      const q = officerFilter.toLowerCase()
      const name = `${request.officer?.first_name ?? ''} ${request.officer?.last_name ?? ''}`.trim().toLowerCase()
      return name.includes(q) || request.officer?.email?.toLowerCase().includes(q)
    })
  }, [leaveRequests, officerFilter, statusFilter])

  const summary = useMemo(() => ({
    pending: leaveRequests.filter((row) => row.status === 'pending').length,
    approved: leaveRequests.filter((row) => row.status === 'approved').length,
    rejected: leaveRequests.filter((row) => row.status === 'rejected').length,
    approvedHours: leaveRequests
      .filter((row) => row.status === 'approved')
      .reduce((sum, row) => sum + (row.total_hours ?? 0), 0)
      .toFixed(1),
  }), [leaveRequests])

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, comment }: { id: string; status: 'approved' | 'rejected'; comment: string }) => {
      const { error } = await ((supabase as any).from('leave_requests') as any)
        .update({
          status,
          manager_comment: comment || null,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(vars.status === 'approved' ? 'Leave approved' : 'Leave rejected')
      setReviewing(null)
      qc.invalidateQueries({ queryKey: ['leave_requests'] })
    },
    onError: (error: any) => toast.error(error.message || 'Failed to update leave request'),
  })

  const createLeave = useMutation({
    mutationFn: async () => {
      const { error } = await ((supabase as any).from('leave_requests') as any).insert({
        organization_id: user?.organization_id,
        officer_id: isManager ? (createDraft.officer_id || null) : user?.id,
        leave_type_name: createDraft.leave_type_name,
        date_start: createDraft.date_start,
        date_end: createDraft.date_end,
        total_hours: createDraft.total_hours ? Number(createDraft.total_hours) : null,
        leave_comment: createDraft.leave_comment || null,
        is_paid: createDraft.is_paid === 'true',
        status: 'pending',
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Leave request created')
      setShowCreateDialog(false)
      qc.invalidateQueries({ queryKey: ['leave_requests'] })
    },
    onError: (error: any) => toast.error(error.message || 'Failed to create leave request'),
  })

  function openReview(request: LeaveRequest) {
    setReviewing(request)
    setManagerComment(request.manager_comment ?? '')
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarDays className="h-6 w-6 text-primary" />
              {isManager ? 'Leave Management' : 'My Leave'}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isManager
                ? 'Review leave requests and keep roster planning leave-aware.'
                : 'View and submit your own leave requests.'}
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Leave Request
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Pending', value: summary.pending, icon: Clock, colour: 'text-yellow-600' },
            { label: 'Approved', value: summary.approved, icon: CheckCircle, colour: 'text-green-600' },
            { label: 'Rejected', value: summary.rejected, icon: XCircle, colour: 'text-red-600' },
            { label: 'Approved Hours', value: `${summary.approvedHours}h`, icon: CalendarDays, colour: 'text-blue-600' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${colour}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                  <SelectTrigger className="h-8 text-sm w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isManager && (
                <div className="space-y-1">
                  <Label className="text-xs">Officer</Label>
                  <Input
                    placeholder="Search officer…"
                    value={officerFilter}
                    onChange={(e) => setOfficerFilter(e.target.value)}
                    className="h-8 text-sm w-44"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><User className="inline h-3.5 w-3.5 mr-1" />Officer</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading leave requests…</TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No leave requests found for the selected filters.</TableCell>
                  </TableRow>
                )}
                {filtered.map((request) => {
                  const meta = STATUS_META[request.status]
                  const officerName = `${request.officer?.first_name ?? ''} ${request.officer?.last_name ?? ''}`.trim() || 'Unknown'
                  return (
                    <TableRow key={request.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{officerName}</div>
                        <div className="text-xs text-muted-foreground">{request.officer?.email ?? 'Unlinked officer'}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{request.leave_type_name}</div>
                        <div className="text-xs text-muted-foreground">{request.is_paid ? 'Paid leave' : 'Unpaid leave'}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {request.date_start}
                        {request.date_start !== request.date_end ? ` → ${request.date_end}` : ''}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{formatHours(request.total_hours)}</TableCell>
                      <TableCell><Badge variant="outline" className={meta.className}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-sm max-w-[180px] truncate text-muted-foreground">{request.leave_comment || '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openReview(request)}>
                          {isManager ? 'Review' : 'View'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {reviewing && (
        <Dialog open onOpenChange={() => setReviewing(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Review Leave Request</DialogTitle>
              <DialogDescription>
                {`${reviewing.officer?.first_name ?? ''} ${reviewing.officer?.last_name ?? ''}`.trim() || 'Unknown officer'}
                {' · '}
                {reviewing.leave_type_name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Start</p>
                  <p className="font-medium">{reviewing.date_start}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">End</p>
                  <p className="font-medium">{reviewing.date_end}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Hours</p>
                  <p className="font-medium">{formatHours(reviewing.total_hours)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Paid</p>
                  <p className="font-medium">{reviewing.is_paid ? 'Yes' : 'No'}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Officer Comment</Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {reviewing.leave_comment || 'No comment provided.'}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Manager Comment</Label>
                <Textarea
                  placeholder="Optional note when approving or rejecting…"
                  value={managerComment}
                  onChange={(e) => setManagerComment(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setReviewing(null)} disabled={updateStatus.isPending}>Close</Button>
              {isManager && (
                <>
                  <Button variant="destructive" onClick={() => updateStatus.mutate({ id: reviewing.id, status: 'rejected', comment: managerComment })} disabled={updateStatus.isPending}>
                    <XCircle className="h-4 w-4 mr-1.5" /> Reject
                  </Button>
                  <Button onClick={() => updateStatus.mutate({ id: reviewing.id, status: 'approved', comment: managerComment })} disabled={updateStatus.isPending}>
                    <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Leave Request</DialogTitle>
            <DialogDescription>Add leave directly into workforce planning.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isManager && (
              <div className="space-y-1.5">
                <Label>Officer</Label>
                <Select value={createDraft.officer_id} onValueChange={(value) => setCreateDraft((prev) => ({ ...prev, officer_id: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an officer" />
                  </SelectTrigger>
                  <SelectContent>
                    {officers.map((officer) => (
                      <SelectItem key={officer.id} value={officer.id}>
                        {`${officer.first_name ?? ''} ${officer.last_name ?? ''}`.trim() || officer.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Leave Type</Label>
              <Input value={createDraft.leave_type_name} onChange={(e) => setCreateDraft((prev) => ({ ...prev, leave_type_name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={createDraft.date_start} onChange={(e) => setCreateDraft((prev) => ({ ...prev, date_start: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={createDraft.date_end} onChange={(e) => setCreateDraft((prev) => ({ ...prev, date_end: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Total Hours</Label>
                <Input value={createDraft.total_hours} onChange={(e) => setCreateDraft((prev) => ({ ...prev, total_hours: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Paid</Label>
                <Select value={createDraft.is_paid} onValueChange={(value) => setCreateDraft((prev) => ({ ...prev, is_paid: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Paid</SelectItem>
                    <SelectItem value="false">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Comment</Label>
              <Textarea value={createDraft.leave_comment} onChange={(e) => setCreateDraft((prev) => ({ ...prev, leave_comment: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={() => createLeave.mutate()} disabled={createLeave.isPending || (isManager && !createDraft.officer_id)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
