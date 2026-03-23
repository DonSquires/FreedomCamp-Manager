import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { WarningNoticeGenerator } from '@/components/features/WarningNoticeGenerator'
import { 
  AlertTriangle, 
  Bell, 
  CheckCircle, 
  Clock, 
  FileText,
  Search,
  Plus,
  Truck,
  User,
  MapPin,
  Calendar,
  XCircle,
  ArrowRight,
  MonitorPlay,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'

interface EnforcementAction {
  id: string
  action_type: string
  status: string
  assigned_to: string | null
  assigned_at: string | null
  completed_at: string | null
  completion_outcome: string | null
  notes: string | null
  created_at: string
  observation_id: string | null
  plate_number: string | null
  zone: { name: string } | null
  user_profile: {
    first_name: string
    last_name: string
  } | null
  assigned_user: {
    first_name: string
    last_name: string
  } | null
}

interface BreachAlert {
  id: string
  plate_number: string
  breach_type: string
  breach_details: any
  zone_id: string
  status: string
  zone: { name: string }
}

export default function EnforcementActions() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const effectiveOrganizationId =
    user?.role !== 'master' ? user?.organization_id || null : organizationId || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedBreach, setSelectedBreach] = useState<string>('')
  const [newActionType, setNewActionType] = useState<string>('warning')
  const [actionNotes, setActionNotes] = useState('')
  const [warningModalBreach, setWarningModalBreach] = useState<BreachAlert | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Fetch enforcement actions
  const { data: actions, isLoading: actionsLoading } = useQuery({
    queryKey: ['enforcement-actions', effectiveOrganizationId, zoneId, statusFilter, actionTypeFilter, searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('enforcement_actions')
        .select(`
          id,
          action_type,
          status,
          assigned_to,
          assigned_at,
          completed_at,
          completion_outcome,
          notes,
          created_at,
          observation_id,
          plate_number,
          zone:zones(name),
          user_profile:user_profiles!enforcement_actions_created_by_fkey(first_name, last_name),
          assigned_user:user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name)
        `)
        .order('created_at', { ascending: false })

      // Organization scoping
      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }
      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      // Date filters
      if (startDate) {
        query = query.gte('created_at', startDate)
      }
      if (endDate) {
        query = query.lte('created_at', endDate)
      }

      // Status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      // Action type filter
      if (actionTypeFilter !== 'all') {
        query = query.eq('action_type', actionTypeFilter)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error

      // Filter by plate number search
      if (searchQuery) {
        return (data as EnforcementAction[]).filter(action =>
          action.plate_number?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }

      return data as EnforcementAction[]
    },
  })

  // Fetch pending breaches for action creation
  const { data: pendingBreaches } = useQuery({
    queryKey: ['pending-breaches', organizationId, zoneId],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          id,
          plate_number,
          breach_type,
          breach_details,
          zone_id,
          status,
          zone:zones(name)
        `)
        .in('status', ['pending', 'acknowledged', 'enforcement_started'])
        .order('created_at', { ascending: false })
        .limit(50)

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (startDate) {
        query = query.gte('created_at', startDate)
      }
      if (endDate) {
        query = query.lte('created_at', endDate)
      }

      const { data, error } = await query
      if (error) throw error
      return data as BreachAlert[]
    },
    enabled: isCreateModalOpen,
  })

  // Create enforcement action mutation
  const createActionMutation = useMutation({
    mutationFn: async (data: { breach_alert_id: string; action_type: string; notes: string }) => {
      // breach_alert_id is used to look up the breach; enforcement_actions links via observation_id
      const { error } = await (supabase
        .from('enforcement_actions') as any)
        .insert({
          action_type: data.action_type,
          organization_id: user?.organization_id || organizationId,
          created_by: user?.id,
          status: 'pending',
          notes: data.notes || null,
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      queryClient.invalidateQueries({ queryKey: ['pending-breaches'] })
      setIsCreateModalOpen(false)
      setSelectedBreach('')
      setNewActionType('warning')
      setActionNotes('')
      toast.success('Enforcement action created')
    },
    onError: () => {
      toast.error('Failed to create enforcement action')
    },
  })

  // Assign action mutation
  const assignMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const { error } = await (supabase.from('enforcement_actions') as any)
        .update({
          status: 'assigned',
          assigned_to: user?.id,
          assigned_at: new Date().toISOString(),
        })
        .eq('id', actionId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Action assigned to you')
    },
    onError: () => {
      toast.error('Failed to assign action')
    },
  })

  // Complete action mutation
  const completeMutation = useMutation({
    mutationFn: async (data: { actionId: string; outcome: string }) => {
      const { error } = await (supabase.from('enforcement_actions') as any)
        .update({
          status: 'completed',
          completion_outcome: data.outcome,
          completed_at: new Date().toISOString(),
        })
        .eq('id', data.actionId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Action completed')
    },
    onError: () => {
      toast.error('Failed to complete action')
    },
  })

  // Calculate stats
  const stats = actions ? {
    total: actions.length,
    pending: actions.filter(a => a.status === 'pending').length,
    assigned: actions.filter(a => a.status === 'assigned').length,
    completed: actions.filter(a => a.status === 'completed').length,
    warnings: actions.filter(a => a.action_type === 'warning').length,
    notices: actions.filter(a => a.action_type === 'notice_to_vacate').length,
    tows: actions.filter(a => a.action_type === 'tow').length,
  } : null

  const getActionTypeIcon = (type: string) => {
    switch (type) {
      case 'warning':
        return <AlertTriangle className="h-4 w-4" />
      case 'notice_to_vacate':
        return <FileText className="h-4 w-4" />
      case 'tow':
        return <Truck className="h-4 w-4" />
      default:
        return <Bell className="h-4 w-4" />
    }
  }

  const getActionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      warning: 'Warning',
      notice_to_vacate: 'Notice to Vacate',
      tow: 'Tow Request',
      referral: 'Referral',
    }
    return labels[type] || type
  }

  const getActionTypeColor = (type: string) => {
    switch (type) {
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'notice_to_vacate':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
      case 'tow':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      default:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      case 'assigned':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <AppLayout 
      title="Enforcement Actions" 
      description="Manage enforcement workflow from warnings to escalation"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Quick Navigation */}
      <div className="flex justify-end mb-4">
        <Button variant="outline" onClick={() => navigate('/enforcement-command-center')}>
          <MonitorPlay className="h-4 w-4 mr-2" />
          Command Centre
        </Button>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-600">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600">Assigned</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.assigned}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.warnings}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Notices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.notices}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-1">
                <Truck className="h-3 w-3" />
                Tows
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.tows}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by plate number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                size="sm"
              >
                All Status
              </Button>
              <Button
                variant={statusFilter === 'pending' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('pending')}
                size="sm"
              >
                Pending
              </Button>
              <Button
                variant={statusFilter === 'assigned' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('assigned')}
                size="sm"
              >
                Assigned
              </Button>
              <Button
                variant={statusFilter === 'completed' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('completed')}
                size="sm"
              >
                Completed
              </Button>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant={actionTypeFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setActionTypeFilter('all')}
                size="sm"
              >
                All Types
              </Button>
              <Button
                variant={actionTypeFilter === 'warning' ? 'default' : 'outline'}
                onClick={() => setActionTypeFilter('warning')}
                size="sm"
              >
                Warnings
              </Button>
              <Button
                variant={actionTypeFilter === 'notice_to_vacate' ? 'default' : 'outline'}
                onClick={() => setActionTypeFilter('notice_to_vacate')}
                size="sm"
              >
                Notices
              </Button>
              <Button
                variant={actionTypeFilter === 'tow' ? 'default' : 'outline'}
                onClick={() => setActionTypeFilter('tow')}
                size="sm"
              >
                Tows
              </Button>
            </div>

            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Action
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Actions List */}
      {actionsLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading enforcement actions...</p>
        </div>
      ) : actions && actions.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No enforcement actions found</p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create First Action
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {actions?.map((action) => (
            <Card key={action.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <CardTitle className="text-xl font-bold font-mono">
                        {action.plate_number || 'Unknown'}
                      </CardTitle>
                      <Badge className={getActionTypeColor(action.action_type)}>
                        {getActionTypeIcon(action.action_type)}
                        <span className="ml-1">{getActionTypeLabel(action.action_type)}</span>
                      </Badge>
                      <Badge className={getStatusColor(action.status)}>
                        {action.status}
                      </Badge>
                    </div>
                    <CardDescription>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {action.zone?.name || 'Unknown Zone'}
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {action.action_type?.replace(/_/g, ' ') || 'Unknown Action'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDateTime(action.created_at)}
                        </span>
                      </div>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Officer Assignment */}
                  {action.user_profile && (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-600 dark:text-gray-400">Created by:</span>
                        <span className="font-medium">
                          {action.user_profile.first_name} {action.user_profile.last_name}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Assigned To */}
                  {action.assigned_user && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-blue-600" />
                        <span className="text-gray-600 dark:text-gray-400">Assigned to:</span>
                        <span className="font-medium text-blue-600">
                          {action.assigned_user.first_name} {action.assigned_user.last_name}
                        </span>
                        {action.assigned_at && (
                          <span className="text-xs text-gray-500">
                            ({formatDateTime(action.assigned_at)})
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Completion */}
                  {action.status === 'completed' && (
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm mb-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="font-medium text-green-600">Completed</span>
                        {action.completed_at && (
                          <span className="text-xs text-gray-500">
                            {formatDateTime(action.completed_at)}
                          </span>
                        )}
                      </div>
                      {action.completion_outcome && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 ml-6">
                          Outcome: {action.completion_outcome}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {action.notes && (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-semibold">Notes:</span> {action.notes}
                      </p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 flex-wrap">
                    {action.status === 'pending' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => assignMutation.mutate(action.id)}
                        disabled={assignMutation.isPending}
                      >
                        <User className="h-4 w-4 mr-1" />
                        Assign to Me
                      </Button>
                    )}
                    {action.status === 'assigned' && action.assigned_to === user?.id && (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => completeMutation.mutate({ 
                            actionId: action.id, 
                            outcome: 'complied' 
                          })}
                          disabled={completeMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Mark Complied
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => completeMutation.mutate({ 
                            actionId: action.id, 
                            outcome: 'escalated' 
                          })}
                          disabled={completeMutation.isPending}
                        >
                          <ArrowRight className="h-4 w-4 mr-1" />
                          Escalate to Notice
                        </Button>
                      </>
                    )}
                    {action.observation_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/breaches?observation_id=${action.observation_id}`)}
                      >
                        <Bell className="h-4 w-4 mr-1" />
                        View Observation
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Action Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Enforcement Action</DialogTitle>
            <DialogDescription>
              Issue a warning, notice, or other enforcement action for a breach alert
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="breach">Select Breach</Label>
              <select
                id="breach"
                className="w-full mt-1 px-3 py-2 border rounded-md"
                value={selectedBreach}
                onChange={(e) => setSelectedBreach(e.target.value)}
              >
                <option value="">-- Select a breach --</option>
                {pendingBreaches?.map((breach) => (
                  <option key={breach.id} value={breach.id}>
                    {breach.plate_number} - {breach.zone.name} ({breach.breach_type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="action-type">Action Type</Label>
              <select
                id="action-type"
                className="w-full mt-1 px-3 py-2 border rounded-md"
                value={newActionType}
                onChange={(e) => setNewActionType(e.target.value)}
              >
                <option value="warning">Warning</option>
                <option value="notice_to_vacate">Notice to Vacate</option>
                <option value="tow">Tow Request</option>
                <option value="referral">Referral</option>
              </select>
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <textarea
                id="notes"
                className="w-full mt-1 px-3 py-2 border rounded-md min-h-24"
                placeholder="Additional details about this action..."
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateModalOpen(false)
                setSelectedBreach('')
                setNewActionType('warning')
                setActionNotes('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedBreach) {
                  toast.error('Please select a breach')
                  return
                }
                if (newActionType === 'warning') {
                  // Open the full WarningNoticeGenerator dialog instead
                  const breach = pendingBreaches?.find(b => b.id === selectedBreach)
                  if (breach) {
                    setWarningModalBreach(breach)
                    setIsCreateModalOpen(false)
                  }
                  return
                }
                createActionMutation.mutate({
                  breach_alert_id: selectedBreach,
                  action_type: newActionType,
                  notes: actionNotes,
                })
              }}
              disabled={createActionMutation.isPending || !selectedBreach}
            >
              {createActionMutation.isPending ? (
                <>Creating...</>
              ) : newActionType === 'warning' ? (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Next: Issue Warning Notice
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Action
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Warning Notice Generator Dialog */}
      <Dialog open={!!warningModalBreach} onOpenChange={(open) => { if (!open) setWarningModalBreach(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              ⚠ Issue Warning Notice
            </DialogTitle>
            <DialogDescription>
              Generate and print a formal Warning Notice for this breach
            </DialogDescription>
          </DialogHeader>
          {warningModalBreach && (
            <WarningNoticeGenerator
              plateNumber={warningModalBreach.plate_number}
              zoneId={warningModalBreach.zone_id}
              zoneName={warningModalBreach.zone?.name ?? ''}
              breachType={warningModalBreach.breach_type}
              breachReason={
                (warningModalBreach.breach_details as any)?.reason ||
                (warningModalBreach.breach_details as any)?.notes ||
                warningModalBreach.breach_type.replace(/_/g, ' ')
              }
              breachAlertId={warningModalBreach.id}
              onGenerated={(_actionId, warningNumber) => {
                toast.success(`Warning ${warningNumber} issued`)
                setWarningModalBreach(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
