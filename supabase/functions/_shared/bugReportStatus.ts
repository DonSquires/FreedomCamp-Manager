/**
 * Bug report status constants and helpers for Supabase Edge Functions.
 * 
 * Duplicated from shared/bugReportStatus.ts since Deno Edge Functions
 * cannot import from paths outside supabase/functions/.
 */

export const TERMINAL_BUG_REPORT_STATUSES = [
  'resolved',
  'closed',
  'wont_fix',
  'duplicate',
] as const

export const NON_TERMINAL_BUG_REPORT_STATUSES = [
  'submitted',
  'acknowledged',
  'investigating',
  'in_progress',
] as const

export const BUG_REPORT_STATUSES = [
  ...NON_TERMINAL_BUG_REPORT_STATUSES,
  ...TERMINAL_BUG_REPORT_STATUSES,
] as const
const BUG_REPORT_STATUS_SET = new Set(BUG_REPORT_STATUSES as readonly string[])

export type TerminalBugReportStatus = typeof TERMINAL_BUG_REPORT_STATUSES[number]

export function isTerminalBugReportStatus(status: unknown): status is TerminalBugReportStatus {
  return TERMINAL_BUG_REPORT_STATUSES.includes(status as TerminalBugReportStatus)
}

export function isKnownBugReportStatus(status: unknown): status is typeof BUG_REPORT_STATUSES[number] {
  return typeof status === 'string' && BUG_REPORT_STATUS_SET.has(status)
}

export function nextStatusAfterAnalysis(status: string | null | undefined): string {
  // After AI analysis the report moves to 'investigating' (Bob has examined it
  // and produced a plan). 'in_progress' is reserved for when a GitHub issue has
  // been opened and active work has started.
  return isTerminalBugReportStatus(status) ? status : 'investigating'
}

export function shouldAutoAcknowledge(status: string | null | undefined): boolean {
  return !status || status === 'submitted'
}
