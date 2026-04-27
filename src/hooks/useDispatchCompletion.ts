import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export interface DispatchCompletionResult {
  status: 'completed' | 'completed_no_route' | 'forbidden' | 'error'
  dispatch_job_id?: string
  completed_route_instance_id?: string | null
  resumed_instance_id?: string | null
  resumed_status?: 'in_progress' | 'completed' | null
  message?: string
}

export function useDispatchCompletion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ dispatchJobId }: { dispatchJobId: string }): Promise<DispatchCompletionResult> => {
      const { data, error } = await (supabase as any).rpc('complete_dispatch_job_and_resume_route', {
        p_dispatch_job_id: dispatchJobId,
        p_completed_by: null,
      })

      if (error) throw error
      return data as DispatchCompletionResult
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['my-dispatch-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['officer-active-patrol-route-instance'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instances'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instance-stops'] })

      if (result.status === 'forbidden') {
        toast.error(result.message ?? 'You are not allowed to complete this dispatch job')
        return
      }

      if (result.resumed_instance_id) {
        const resumedText = result.resumed_status === 'completed'
          ? 'resumed route had no open stops and is now completed'
          : 'paused route resumed'
        toast.success(`Dispatch completed, ${resumedText}`)
        return
      }

      if (result.status === 'completed_no_route') {
        toast.success('Dispatch completed')
        return
      }

      toast.success(result.message ?? 'Dispatch completed')
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to complete dispatch job')
    },
  })
}
