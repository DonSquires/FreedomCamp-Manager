export const TERMINAL_BUG_REPORT_STATUSES = [
  'resolved',
  'closed',
  'wont_fix',
  'duplicate',
] as const

export type TerminalBugReportStatus = typeof TERMINAL_BUG_REPORT_STATUSES[number]

export function isTerminalBugReportStatus(status: unknown): status is TerminalBugReportStatus {
  return TERMINAL_BUG_REPORT_STATUSES.includes(status as TerminalBugReportStatus)
}

export function nextStatusAfterAnalysis(status: string | null | undefined): string {
  return isTerminalBugReportStatus(status) ? status : 'in_progress'
}

export function shouldAutoAcknowledge(status: string | null | undefined): boolean {
  return !status || status === 'submitted'
}
