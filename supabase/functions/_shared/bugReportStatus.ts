type BugReportStatus = 'submitted' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed'

export function shouldAutoAcknowledge(status: string): boolean {
  return status === 'submitted'
}

export function nextStatusAfterAnalysis(currentStatus: string): BugReportStatus {
  if (currentStatus === 'submitted' || currentStatus === 'acknowledged') {
    return 'in_progress'
  }
  return currentStatus as BugReportStatus
}
