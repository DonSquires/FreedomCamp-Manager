import { useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ReasoningService, type ReasoningHypothesis, type ApprovalGate } from '@/lib/bobReasoningService'
import { useOrganization } from './useOrganization'

/**
 * useAutonomousReasoning Hook
 *
 * Manages Bob's autonomous reasoning workflow:
 * 1. Form hypothesis from conversation
 * 2. Gather evidence (supporting / contradicting)
 * 3. Calculate confidence
 * 4. Request approval if needed
 * 5. Execute action post-approval
 *
 * Handles state transitions, expiry checks, and audit trail
 */

export interface UseAutonomousReasoningOptions {
  conversationId: string
  organizationId?: string
}

export function useAutonomousReasoning(options: UseAutonomousReasoningOptions) {
  const { organization } = useOrganization()
  const orgId = options.organizationId || organization?.id
  const service = orgId ? new ReasoningService(orgId) : null

  const [activeReasoning, setActiveReasoning] = useState<ReasoningHypothesis | null>(null)
  const [approvalGate, setApprovalGate] = useState<ApprovalGate | null>(null)
  const [auditTrail, setAuditTrail] = useState<any[]>([])

  // Mutation: Form initial hypothesis
  const formHypothesis = useMutation({
    mutationFn: async (input: {
      hypothesis: string
      evidenceFor: { text: string; weight: number }[]
      evidenceAgainst?: { text: string; weight: number }[]
    }) => {
      if (!service) throw new Error('Organization not initialized')
      return service.formHypothesis(
        options.conversationId,
        input.hypothesis,
        input.evidenceFor,
        input.evidenceAgainst
      )
    },
    onSuccess: (data) => {
      setActiveReasoning(data)
      setAuditTrail((prev) => [...prev, { action: 'hypothesis_formed', data }])
    },
  })

  // Mutation: Update evidence
  const updateEvidence = useMutation({
    mutationFn: async (input: {
      newEvidence: { text: string; weight: number; supportingHypothesis: boolean }[]
    }) => {
      if (!service || !activeReasoning) throw new Error('No active reasoning')
      return service.updateEvidence(activeReasoning, input.newEvidence)
    },
    onSuccess: (data) => {
      setActiveReasoning(data)
      setAuditTrail((prev) => [...prev, { action: 'evidence_updated', data }])
    },
  })

  // Mutation: Request approval
  const requestApproval = useMutation({
    mutationFn: async (input: {
      action: string
      requiredRoles?: ('admin' | 'master' | 'grand_master')[]
    }) => {
      if (!service || !activeReasoning) throw new Error('No active reasoning')
      return service.requestApproval(activeReasoning.id, input.action, input.requiredRoles)
    },
    onSuccess: (data) => {
      setApprovalGate(data)
      setAuditTrail((prev) => [...prev, { action: 'approval_requested', data }])
    },
  })

  // Mutation: Override approval (for admin)
  const overrideApproval = useMutation({
    mutationFn: async (input: {
      reason: string
      userId: string
      userRole: 'admin' | 'master' | 'grand_master'
    }) => {
      if (!service || !approvalGate) throw new Error('No pending approval')
      return service.approveGate(approvalGate, input.userId, input.userRole, input.reason)
    },
    onSuccess: (data) => {
      setApprovalGate(data)
      setAuditTrail((prev) => [...prev, { action: 'approval_granted', data }])
    },
  })

  // Mutation: Reject approval
  const rejectApproval = useMutation({
    mutationFn: async (input: { reason: string; userId: string }) => {
      if (!service || !approvalGate) throw new Error('No pending approval')
      return service.rejectGate(approvalGate, input.userId, input.reason)
    },
    onSuccess: (data) => {
      setApprovalGate(data)
      setAuditTrail((prev) => [...prev, { action: 'approval_rejected', data }])
    },
  })

  // Mutation: Escalate approval
  const escalateApproval = useMutation({
    mutationFn: async (input: { reason: string }) => {
      if (!service || !approvalGate) throw new Error('No pending approval')
      return service.escalateGate(approvalGate, input.reason)
    },
    onSuccess: (data) => {
      setApprovalGate(data)
      setAuditTrail((prev) => [...prev, { action: 'approval_escalated', data }])
    },
  })

  // Mutation: Execute action
  const executeAction = useMutation({
    mutationFn: async (actionMetadata: Record<string, unknown>) => {
      if (!service || !approvalGate) throw new Error('No approved action')
      await service.executeAction(approvalGate, actionMetadata)
      return { success: true, actionMetadata }
    },
    onSuccess: (data) => {
      setAuditTrail((prev) => [...prev, { action: 'action_executed', data }])
    },
  })

  // Computed: Can approve?
  const canApprove = useCallback(() => {
    return approvalGate?.status === 'pending' && new Date() < approvalGate?.expiresAt
  }, [approvalGate])

  // Computed: Confidence percentage
  const confidencePercentage = activeReasoning
    ? Math.round(activeReasoning.confidence * 100)
    : null

  // Computed: Requires escalation?
  const shouldEscalate = activeReasoning && activeReasoning.confidence < 0.5

  // Reset state
  const reset = useCallback(() => {
    setActiveReasoning(null)
    setApprovalGate(null)
    setAuditTrail([])
  }, [])

  return {
    // State
    activeReasoning,
    approvalGate,
    auditTrail,
    confidencePercentage,
    shouldEscalate,

    // Mutations
    formHypothesis,
    updateEvidence,
    requestApproval,
    overrideApproval,
    rejectApproval,
    escalateApproval,
    executeAction,

    // Helpers
    canApprove,
    reset,
  }
}

/**
 * Helper: Determine action type from reasoning
 */
export function getActionTypeFromReasoning(hypothesis: string): string {
  if (hypothesis.toLowerCase().includes('repeat') || hypothesis.includes('pattern')) {
    return 'create_notice_to_vacate'
  }
  if (hypothesis.toLowerCase().includes('welfare') || hypothesis.includes('welfare')) {
    return 'notify_officer_wellness'
  }
  if (hypothesis.toLowerCase().includes('investigate')) {
    return 'escalate_to_investigator'
  }
  return 'require_human_review'
}

/**
 * Example usage in a component:
 *
 * ```typescript
 * function BreachReasoningComponent({ conversationId, breach }) {
 *   const reasoning = useAutonomousReasoning({ conversationId })
 *
 *   const handleFormalize = async () => {
 *     await reasoning.formHypothesis.mutateAsync({
 *       hypothesis: `Breach likely repeated: ${breach.reference}`,
 *       evidenceFor: [
 *         { text: 'Same site, same vehicle', weight: 0.9 },
 *         { text: 'Within 30 days of prior notice', weight: 0.7 },
 *       ],
 *     })
 *
 *     if (reasoning.shouldEscalate) {
 *       await reasoning.escalateApproval.mutateAsync({
 *         reason: 'Low confidence, needs investigation review'
 *       })
 *     } else {
 *       const actionType = getActionTypeFromReasoning(reasoning.activeReasoning?.hypothesis!)
 *       await reasoning.requestApproval.mutateAsync({ action: actionType })
 *     }
 *   }
 *
 *   return (
 *     <div className="space-y-4">
 *       {reasoning.activeReasoning && (
 *         <Card>
 *           <CardHeader>
 *             <CardTitle>Reasoning Chain</CardTitle>
 *           </CardHeader>
 *           <CardContent>
 *             <p>{reasoning.activeReasoning.hypothesis}</p>
 *             <div className="mt-4 w-full bg-gray-200 rounded-full h-2">
 *               <div
 *                 className="bg-blue-600 h-2 rounded-full"
 *                 style={{ width: `${reasoning.confidencePercentage}%` }}
 *               />
 *             </div>
 *             <p className="text-sm mt-2">Confidence: {reasoning.confidencePercentage}%</p>
 *           </CardContent>
 *         </Card>
 *       )}
 *
 *       {reasoning.approvalGate && reasoning.approvalGate.status === 'pending' && (
 *         <Card className="border-yellow-200 bg-yellow-50">
 *           <CardHeader>
 *             <CardTitle>Approval Required</CardTitle>
 *           </CardHeader>
 *           <CardContent className="space-y-4">
 *             <p className="text-sm">{reasoning.approvalGate.action}</p>
 *             <div className="flex gap-2">
 *               <Button
 *                 onClick={() =>
 *                   reasoning.overrideApproval.mutateAsync({
 *                     reason: 'Approved: Evidence is solid',
 *                     userId: user.id,
 *                     userRole: 'admin',
 *                   })
 *                 }
 *                 disabled={!reasoning.canApprove()}
 *               >
 *                 Approve
 *               </Button>
 *               <Button
 *                 variant="outline"
 *                 onClick={() =>
 *                   reasoning.rejectApproval.mutateAsync({
 *                     reason: 'Needs more investigation',
 *                     userId: user.id,
 *                   })
 *                 }
 *               >
 *                 Reject
 *               </Button>
 *             </div>
 *           </CardContent>
 *         </Card>
 *       )}
 *
 *       <Button onClick={handleFormalize}>Formalize Reasoning</Button>
 *     </div>
 *   )
 * }
 * ```
 */
