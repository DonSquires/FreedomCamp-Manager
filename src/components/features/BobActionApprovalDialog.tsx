/**
 * BobActionApprovalDialog — Reusable approval UI for Bob-recommended actions
 *
 * Usage:
 *   const { isOpen, recommendation, approve, reject } = useBobActionApproval()
 *   <BobActionApprovalDialog
 *     open={isOpen}
 *     recommendation={recommendation}
 *     onApprove={approve}
 *     onReject={reject}
 *   />
 */

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { AlertTriangle, BrainCircuit, CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import { useState } from 'react'

export interface BobRecommendation {
  /** Unique action identifier */
  id: string
  /** Optional structured D1 proposal identifier once persisted */
  proposalId?: string
  /** Action type: 'create', 'update', 'delete', 'enforce_action', 'policy_change', etc. */
  actionType: string
  /** Human-readable action title */
  title: string
  /** Detailed description of what Bob is recommending */
  description: string
  /** Optional: which entity this affects (e.g., plate number, user ID, zone ID) */
  entityId?: string
  /** Optional: entity type (e.g., 'vehicle', 'user', 'zone') */
  entityType?: string
  /** Optional case link for the operational timeline */
  caseId?: string
  /** Optional structured source references used for D1 audit trail */
  sourceContextRefs?: string[]
  /** Confidence level 0-100 */
  confidence?: number
  /** Evidence/reasoning Bob used to make this recommendation */
  evidence?: string[]
  /** Risk level: 'low' | 'medium' | 'high' */
  riskLevel?: 'low' | 'medium' | 'high'
  /** Optional D1 impact level for stored proposal contracts */
  impactLevel?: 'low' | 'medium' | 'high' | 'critical'
  /** Optional D1 approval due time */
  approvalDueAt?: string | null
  /** Suggested data payload for the mutation (optional) */
  suggestedPayload?: Record<string, any>
  /** Link to drill-down details (optional) */
  detailsLink?: string
}

interface BobActionApprovalDialogProps {
  open: boolean
  recommendation: BobRecommendation | null
  onApprove?: (recommendation: BobRecommendation, notes: string) => void | Promise<void>
  onReject?: (recommendation: BobRecommendation, reason: string) => void | Promise<void>
  isLoading?: boolean
}

export function BobActionApprovalDialog({
  open,
  recommendation,
  onApprove,
  onReject,
  isLoading = false,
}: BobActionApprovalDialogProps) {
  const [approvalNotes, setApprovalNotes] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectReason, setShowRejectReason] = useState(false)

  if (!recommendation) return null

  const riskColor = {
    low: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700',
    medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
    high: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700',
  }

  const handleApprove = async () => {
    if (onApprove) {
      await onApprove(recommendation, approvalNotes)
    }
    setApprovalNotes('')
  }

  const handleReject = async () => {
    if (onReject) {
      await onReject(recommendation, rejectionReason)
    }
    setRejectionReason('')
    setShowRejectReason(false)
  }

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <BrainCircuit className="h-5 w-5 text-blue-500 mt-1 flex-shrink-0" />
            <div className="flex-1">
              <DialogTitle>{recommendation.title}</DialogTitle>
              <DialogDescription className="mt-1">
                Bob has a recommendation pending your review and approval.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Action Type & Risk */}
          <div className="flex items-center gap-2">
            <Badge variant="outline">{recommendation.actionType}</Badge>
            {recommendation.riskLevel && (
              <div className={`px-2 py-1 text-xs font-medium rounded border ${riskColor[recommendation.riskLevel]}`}>
                {recommendation.riskLevel === 'high' ? (
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                ) : null}
                {recommendation.riskLevel.toUpperCase()} RISK
              </div>
            )}
            {recommendation.confidence !== undefined && (
              <Badge variant="secondary" className="ml-auto">
                {recommendation.confidence}% confidence
              </Badge>
            )}
          </div>

          {/* Description */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recommendation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {recommendation.description}
              </p>
            </CardContent>
          </Card>

          {/* Evidence */}
          {recommendation.evidence && recommendation.evidence.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Supporting Evidence</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1 list-disc list-inside text-gray-700 dark:text-gray-300">
                  {recommendation.evidence.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Entity reference */}
          {recommendation.entityType && recommendation.entityId && (
            <div className="p-3 bg-gray-50 dark:bg-[#1A1A1A]/50 rounded-lg border border-gray-200 dark:border-[#9E9E9E]/20 text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Affects: <code className="font-mono font-medium text-gray-900 dark:text-gray-100">{recommendation.entityType}:{recommendation.entityId}</code>
              </span>
              {recommendation.detailsLink && (
                <a
                  href={recommendation.detailsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs"
                >
                  View details <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {recommendation.approvalDueAt && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              Approval due by {new Date(recommendation.approvalDueAt).toLocaleString('en-NZ')}
            </div>
          )}

          {/* Approval Notes (shown when approving) */}
          {!showRejectReason && (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Approval Notes (optional)
              </label>
              <Textarea
                placeholder="Explain why you're approving this action (for audit trail)…"
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                className="mt-2 text-sm"
                rows={2}
              />
            </div>
          )}

          {/* Rejection Reason (shown when rejecting) */}
          {showRejectReason && (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Reason for Rejection *
              </label>
              <Textarea
                placeholder="Explain why you're rejecting this action (for audit trail)…"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="mt-2 text-sm"
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          {!showRejectReason ? (
            <>
              <Button
                variant="outline"
                onClick={() => setShowRejectReason(true)}
                disabled={isLoading}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
              <Button
                onClick={handleApprove}
                disabled={isLoading}
              >
                {isLoading ? 'Approving…' : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Approve & Execute
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setShowRejectReason(false)}
                disabled={isLoading}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={isLoading || !rejectionReason.trim()}
              >
                {isLoading ? 'Processing…' : 'Confirm Rejection'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
