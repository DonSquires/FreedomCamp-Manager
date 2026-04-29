import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export interface ReplanResult {
  status: 'replanned' | 'no_active_route' | 'skipped' | 'error'
  paused_instance_id?: string
  new_instance_id?: string
  stops_carried_over?: number
  planning_mode?: string
  message?: string
}

export function useDispatchReplan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      dispatchJobId,
      replannedBy,
    }: {
      dispatchJobId: string
      replannedBy?: string
    }): Promise<ReplanResult> => {
      const { data, error } = await (supabase as any).rpc('replan_route_on_dispatch', {
        p_dispatch_job_id: dispatchJobId,
        p_replanned_by:    replannedBy ?? null,
      })
      if (error) throw error
      return data as ReplanResult
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instances'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instance-stops'] })

      if (result.status === 'replanned') {
        toast.success(
          `Route replanned — ${result.stops_carried_over ?? 0} stops carried over`
        )
      } else if (result.status === 'no_active_route') {
        toast.info('No active route to replan for this officer')
      } else if (result.status === 'skipped') {
        toast.info(result.message ?? 'Replan skipped')
      }
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to replan route')
    },
  })
}
