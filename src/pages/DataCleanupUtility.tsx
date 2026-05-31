import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { toast } from 'sonner'
import {
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Archive,
  Database,
  FileX,
} from 'lucide-react'

interface CleanupTask {
  id: string
  title: string
  description: string
  icon: any
  severity: 'low' | 'medium' | 'high'
  requiresMaster?: boolean
  action: () => Promise<{ deleted: number; message: string }>
}

interface TaskProgress {
  total: number
  processed: number
  removed: number
  percent: number
}

export default function DataCleanupUtility() {
  const { user } = useAuthStore()
  const isMasterUser = user?.role === 'master'
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const [runningTask, setRunningTask] = useState<string | null>(null)
  const [taskResults, setTaskResults] = useState<Record<string, { deleted: number; message: string }>>({})
  const [taskProgress, setTaskProgress] = useState<Record<string, TaskProgress>>({})

  // Fetch cleanup candidates
  const { data: cleanupStats, isLoading } = useQuery({
    queryKey: ['cleanup-stats', organizationId],
    queryFn: async () => {
      const orgFilter = organizationId || ((user?.role === 'master' || user?.role === 'grand_master') ? null : user?.organization_id)

      // Duplicate observations (same plate, zone, within 5 minutes)
      const dupQuery = (supabase as any).rpc('get_duplicate_observations', {
        org_id: orgFilter,
      })
      const { data: duplicates } = await dupQuery

      // Orphaned photos (no matching observation)
      const { count: orphanedPhotos } = await supabase
        .from('photo_metadata')
        .select('id', { count: 'exact', head: true })
        .is('observation_id', null)
        .is('incident_id', null)
        .is('vehicle_record_id', null)

      // Expired photos (past retention period)
      const { count: expiredPhotos } = await supabase
        .from('photo_metadata')
        .select('id', { count: 'exact', head: true })
        .not('scheduled_deletion_at', 'is', null)
        .lt('scheduled_deletion_at', new Date().toISOString())

      // Observations without photos
      const { count: observationsWithoutPhotos } = await supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
        .or('photo_url.is.null,photo_hash.is.null')

      // Old resolved breaches (>90 days)
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
      
      let oldBreachQuery = supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'resolved')
        .lt('resolved_at', ninetyDaysAgo.toISOString())

      if (orgFilter) oldBreachQuery = oldBreachQuery.eq('organization_id', orgFilter)
      const { count: oldResolvedBreaches } = await oldBreachQuery

      return {
        duplicateObservations: (duplicates as any)?.length || 0,
        orphanedPhotos: orphanedPhotos || 0,
        expiredPhotos: expiredPhotos || 0,
        observationsWithoutPhotos: observationsWithoutPhotos || 0,
        oldResolvedBreaches: oldResolvedBreaches || 0,
      }
    },
    enabled: !!user,
  })

  // Cleanup tasks
  const cleanupTasks: CleanupTask[] = [
    {
      id: 'duplicate-observations',
      title: 'Remove Duplicate Observations',
      description: 'Delete duplicate observations in same zone on the same NZ date/time window',
      icon: FileX,
      severity: 'high',
      requiresMaster: true,
      action: async () => {
        setTaskProgress(prev => ({
          ...prev,
          'duplicate-observations': {
            total: 0,
            processed: 0,
            removed: 0,
            percent: 0,
          },
        }))

        const zoneIds = organizationId
          ? ((await supabase
            .from('zones')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('is_active', true)).data || []).map((z: any) => z.id)
          : undefined

        const { data: totalData, error: totalError } = await edgeFunctions.detectDuplicates({
          zoneIds,
          time_window_minutes: 5,
          get_total: true,
        })

        if (totalError) throw new Error(totalError)

        const total = Number((totalData as any)?.total ?? 0)
        if (total <= 0) {
          setTaskProgress(prev => ({
            ...prev,
            'duplicate-observations': {
              total: 0,
              processed: 0,
              removed: 0,
              percent: 100,
            },
          }))
          return {
            deleted: 0,
            message: 'No duplicate observations found for current filter scope',
          }
        }

        setTaskProgress(prev => ({
          ...prev,
          'duplicate-observations': {
            total,
            processed: 0,
            removed: 0,
            percent: 0,
          },
        }))

        const batchSize = 250
        let removedTotal = 0
        let processedTotal = 0

        for (let offset = 0; offset < total; offset += batchSize) {
          const { data: batchData, error: batchError } = await edgeFunctions.detectDuplicates({
            zoneIds,
            offset,
            batch_size: batchSize,
            time_window_minutes: 5,
          })

          if (batchError) throw new Error(batchError)
          processedTotal += Number((batchData as any)?.processed ?? 0)
          removedTotal += Number((batchData as any)?.removed ?? 0)

          const percent = total > 0 ? Math.min(100, Math.round((processedTotal / total) * 100)) : 100
          setTaskProgress(prev => ({
            ...prev,
            'duplicate-observations': {
              total,
              processed: processedTotal,
              removed: removedTotal,
              percent,
            },
          }))
        }

        setTaskProgress(prev => ({
          ...prev,
          'duplicate-observations': {
            total,
            processed: total,
            removed: removedTotal,
            percent: 100,
          },
        }))

        return {
          deleted: removedTotal,
          message: `Removed ${removedTotal} duplicate observations`,
        }
      },
    },
    {
      id: 'orphaned-photos',
      title: 'Remove Orphaned Photos',
      description: 'Delete photos not linked to any observation, incident, or vehicle record',
      icon: Trash2,
      severity: 'medium',
      action: async () => {
        const { data: orphans } = await (supabase.from('photo_metadata') as any)
          .select('id, storage_path, bucket_name')
          .is('observation_id', null)
          .is('incident_id', null)
          .is('vehicle_record_id', null)
          .limit(100)

        if (!orphans || orphans.length === 0) {
          return { deleted: 0, message: 'No orphaned photos found' }
        }

        // Delete from storage
        for (const photo of orphans) {
          await supabase.storage
            .from(photo.bucket_name)
            .remove([photo.storage_path])
        }

        // Delete metadata
        const { error } = await (supabase.from('photo_metadata') as any)
          .delete()
          .in('id', orphans.map(p => p.id))

        if (error) throw error

        return {
          deleted: orphans.length,
          message: `Removed ${orphans.length} orphaned photos`,
        }
      },
    },
    {
      id: 'expired-photos',
      title: 'Remove Expired Photos',
      description: 'Delete photos that have passed their retention period',
      icon: Archive,
      severity: 'low',
      action: async () => {
        const { data, error } = await edgeFunctions.nightlyPrivacyCleanup({ dryRun: false })

        if (error) throw error

        return {
          deleted: data?.deleted || 0,
          message: `Removed ${data?.deleted || 0} expired photos`,
        }
      },
    },
    {
      id: 'observations-without-photos',
      title: 'Flag Observations Without Photos',
      description: 'Identify observations missing photo evidence (cannot be deleted - legal evidence)',
      icon: AlertTriangle,
      severity: 'high',
      action: async () => {
        const { count } = await supabase
          .from('observations')
          .select('observation_id', { count: 'exact', head: true })
          .or('photo_url.is.null,photo_hash.is.null')

        return {
          deleted: 0,
          message: `Found ${count || 0} observations without photos (manual review required)`,
        }
      },
    },
    {
      id: 'old-resolved-breaches',
      title: 'Archive Old Resolved Breaches',
      description: 'Archive breach alerts resolved over 90 days ago',
      icon: Archive,
      severity: 'low',
      action: async () => {
        const ninetyDaysAgo = new Date()
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

        const archiveQuery = (supabase.from('breach_alerts') as any)
          .update({ status: 'archived' })
          .eq('status', 'resolved')
          .lt('resolved_at', ninetyDaysAgo.toISOString())
        const { count, error } = await (archiveQuery as any).select('id', { count: 'exact', head: true })

        if (error) throw error

        return {
          deleted: count || 0,
          message: `Archived ${count || 0} old resolved breaches`,
        }
      },
    },
  ]

  const visibleCleanupTasks = cleanupTasks.filter((task) => !task.requiresMaster || isMasterUser)

  const runCleanupTask = async (task: CleanupTask) => {
    setRunningTask(task.id)
    try {
      const result = await task.action()
      setTaskResults(prev => ({ ...prev, [task.id]: result }))
      toast.success(result.message)
      queryClient.invalidateQueries({ queryKey: ['cleanup-stats'] })
    } catch (error: any) {
      console.error(`Cleanup task ${task.id} failed:`, error)
      toast.error(`Cleanup failed: ${error.message}`)
    } finally {
      setRunningTask(null)
      setTaskProgress(prev => {
        if (!(task.id in prev)) return prev
        const clone = { ...prev }
        delete clone[task.id]
        return clone
      })
    }
  }

  const getSeverityColor = (severity: 'low' | 'medium' | 'high') => {
    switch (severity) {
      case 'high':
        return 'destructive'
      case 'medium':
        return 'default'
      case 'low':
        return 'secondary'
    }
  }

  const getSeverityBadge = (severity: 'low' | 'medium' | 'high') => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive">High Priority</Badge>
      case 'medium':
        return <Badge>Medium Priority</Badge>
      case 'low':
        return <Badge variant="secondary">Low Priority</Badge>
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Data Cleanup Utility</h1>
          <p className="text-muted-foreground mt-1">
            Remove duplicates, orphaned records, and expired data
          </p>
        </div>

        {/* Warning */}
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-5 w-5" />
              Cleanup Operations Warning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              These operations permanently delete data. Always review the affected records before running cleanup tasks.
              Some operations (like removing observations without photos) are informational only and require manual review
              due to legal evidence requirements.
            </p>
          </CardContent>
        </Card>

        {/* Cleanup Statistics */}
        {!isLoading && cleanupStats && (
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Duplicate Observations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{cleanupStats.duplicateObservations}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Orphaned Photos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{cleanupStats.orphanedPhotos}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Expired Photos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{cleanupStats.expiredPhotos}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Observations Without Photos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{cleanupStats.observationsWithoutPhotos}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Old Resolved Breaches
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{cleanupStats.oldResolvedBreaches}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Cleanup Tasks */}
        <div className="space-y-4">
          {visibleCleanupTasks.map((task) => {
            const Icon = task.icon
            const isRunning = runningTask === task.id
            const result = taskResults[task.id]
            const progress = taskProgress[task.id]

            return (
              <Card key={task.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <Icon className="h-5 w-5" />
                        {task.title}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {task.description}
                      </CardDescription>
                    </div>
                    {getSeverityBadge(task.severity)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <Button
                      onClick={() => runCleanupTask(task)}
                      disabled={isRunning || !!runningTask}
                      variant={task.severity === 'high' ? 'destructive' : 'default'}
                    >
                      {isRunning ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Run Cleanup
                        </>
                      )}
                    </Button>

                    {result && (
                      <div className="flex items-center gap-2 text-sm">
                        {result.deleted > 0 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className={result.deleted > 0 ? 'text-green-600' : 'text-muted-foreground'}>
                          {result.message}
                        </span>
                      </div>
                    )}
                  </div>

                  {isRunning && progress && (
                    <div className="mt-4 space-y-3">
                      <Progress value={progress.percent} className="w-full" />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="bg-muted/40 rounded p-2">
                          <div className="text-muted-foreground">Progress</div>
                          <div className="font-semibold">{progress.percent}%</div>
                        </div>
                        <div className="bg-muted/40 rounded p-2">
                          <div className="text-muted-foreground">Processed</div>
                          <div className="font-semibold">{progress.processed.toLocaleString()}</div>
                        </div>
                        <div className="bg-muted/40 rounded p-2">
                          <div className="text-muted-foreground">Total</div>
                          <div className="font-semibold">{progress.total.toLocaleString()}</div>
                        </div>
                        <div className="bg-muted/40 rounded p-2">
                          <div className="text-muted-foreground">Removed</div>
                          <div className="font-semibold text-green-600">{progress.removed.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Recent Activity */}
        {Object.keys(taskResults).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Cleanup Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(taskResults).map(([taskId, result]) => {
                  const task = visibleCleanupTasks.find(t => t.id === taskId)
                  return (
                    <div key={taskId} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div className="flex items-center gap-2">
                        {result.deleted > 0 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium">{task?.title}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{result.message}</span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
