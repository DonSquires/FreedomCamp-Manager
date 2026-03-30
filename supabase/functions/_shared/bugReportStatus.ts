/**
 * bugReportStatus.ts
 *
 * Shared helpers for transitioning bug_report status values.
 *
 * Status flow:
 *   submitted → acknowledged → in_progress → resolved / closed
 */

type BugReportStatus = 'submitted' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed'

/**
 * Returns true when a report status is still in the "newly submitted" state
 * and should be auto-acknowledged before AI analysis runs.
 */
export function shouldAutoAcknowledge(status: string): boolean {
  return status === 'submitted'
}

/**
 * Returns the next status after AI analysis has been stored.
 * - 'submitted' and 'acknowledged' both advance to 'in_progress'
 * - Already-progressed statuses (in_progress, resolved, closed) are left unchanged
 */
export function nextStatusAfterAnalysis(currentStatus: string): BugReportStatus {
  if (currentStatus === 'submitted' || currentStatus === 'acknowledged') {
    return 'in_progress'
  }
  return currentStatus as BugReportStatus
}
