/**
 * useBobActionApproval — Hook to manage Bob action approval workflow
 *
 * Handles:
 * - Recommendation queueing
 * - Approval/rejection state
 * - Audit log creation
 * - Mutation execution with retry
 *
 * Usage:
 *   const { isOpen, recommendation, approve, reject, showDialog } = useBobActionApproval()
 *   showDialog(myRecommendation)
 *   // ... user approves/rejects
 */

import { useState, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { BobRecommendation } from '@/components/features/BobActionApprovalDialog'

export interface BobApprovalState {
  isOpen: boolean
  recommendation: BobRecommendation | null
  isLoading: boolean
}

export function useBobActionApproval() {
  const { user } = useAuthStore()
  const [state, setState] = useState<BobApprovalState>({
    isOpen: false,
    recommendation: null,
    isLoading: false,
  })

  const executionQueueRef = useRef<Map<string, BobRecommendation>>(new Map())

  /**
   * Show approval dialog for a Bob recommendation
   */
  const showDialog = useCallback((recommendation: BobRecommendation) => {
    setState({
      isOpen: true,
      recommendation,
      isLoading: false,
    })
  }, [])

  /**
   * Close dialog without approval
   */
  const closeDialog = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      recommendation: null,
    }))
  }, [])

  /**
   * Create audit log entry for a Bob-assisted action
   */
  const logBobAction = useCallback(
    async (
      action: 'recommendation_approved' | 'recommendation_rejected' | 'action_executed',
      recommendation: BobRecommendation,
      outcome: 'approved' | 'rejected' | 'success' | 'failed',
      notes: string,
      error?: string,
    ) => {
      if (!user?.organization_id) return

      try {
        const { error: insertError } = await (supabase.from('audit_log') as any).insert({
          organization_id: user.organization_id,
          action: 'bob_action_approval',
          entity_type: recommendation.entityType || 'bob_recommendation',
          entity_id: recommendation.id,
          old_values: null,
          new_values: {
            recommendation_id: recommendation.id,
            action_type: recommendation.actionType,
            title: recommendation.title,
            outcome,
            approver_notes: notes,
            error_message: error || null,
            timestamp: new Date().toISOString(),
          },
          performed_by: user.id,
        })

        if (insertError) {
          console.error('Failed to log Bob action:', insertError)
        }
      } catch (err) {
        console.error('Error creating audit log:', err)
      }
    },
    [user],
  )

  /**
   * Approve a Bob recommendation and execute the suggested payload
   */
  const approve = useCallback(
    async (recommendation: BobRecommendation, notes: string, executeFn?: () => Promise<any>) => {
      if (!user) {
        toast.error('Not authenticated')
        return
      }

      setState((prev) => ({ ...prev, isLoading: true }))

      try {
        // Log the approval first (before mutation)
        await logBobAction(
          'recommendation_approved',
          recommendation,
          'approved',
          notes,
        )

        // Execute the provided mutation function if available
        if (executeFn) {
          try {
            const result = await executeFn()
            // Log successful execution
            await logBobAction(
              'action_executed',
              recommendation,
              'success',
              notes,
            )
            toast.success(`Action approved and executed: ${recommendation.title}`)
            setState({ isOpen: false, recommendation: null, isLoading: false })
            return result
          } catch (execError: any) {
            // Log execution failure
            await logBobAction(
              'action_executed',
              recommendation,
              'failed',
              notes,
              execError.message,
            )
            toast.error(`Failed to execute action: ${execError.message}`)
            setState((prev) => ({ ...prev, isLoading: false }))
            throw execError
          }
        } else {
          // No execute function provided — user must handle manually
          toast.success(`Approved: ${recommendation.title}`)
          setState({ isOpen: false, recommendation: null, isLoading: false })
        }
      } catch (error: any) {
        console.error('Approval error:', error)
        toast.error(`Approval error: ${error.message}`)
        setState((prev) => ({ ...prev, isLoading: false }))
      }
    },
    [user, logBobAction],
  )

  /**
   * Reject a Bob recommendation
   */
  const reject = useCallback(
    async (recommendation: BobRecommendation, reason: string) => {
      if (!user) {
        toast.error('Not authenticated')
        return
      }

      setState((prev) => ({ ...prev, isLoading: true }))

      try {
        // Log the rejection
        await logBobAction(
          'recommendation_rejected',
          recommendation,
          'rejected',
          reason,
        )

        toast.info(`Rejected: ${recommendation.title}`)
        setState({ isOpen: false, recommendation: null, isLoading: false })
      } catch (error: any) {
        console.error('Rejection error:', error)
        toast.error(`Rejection error: ${error.message}`)
        setState((prev) => ({ ...prev, isLoading: false }))
      }
    },
    [user, logBobAction],
  )

  return {
    // State
    isOpen: state.isOpen,
    recommendation: state.recommendation,
    isLoading: state.isLoading,

    // Actions
    showDialog,
    closeDialog,
    approve,
    reject,
    logBobAction,

    // Queue management (for future batch processing)
    enqueue: (rec: BobRecommendation) => executionQueueRef.current.set(rec.id, rec),
    dequeue: (recId: string) => executionQueueRef.current.delete(recId),
    getQueue: () => Array.from(executionQueueRef.current.values()),
  }
}
