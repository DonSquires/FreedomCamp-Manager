export type NoticeDecisionAction = 'edit' | 'approve' | 'issue' | 'escalate' | 'cancel' | 'enforce' | 'revoke'

export const NOTICE_DECISION_RIGHTS_MATRIX: Record<NoticeDecisionAction, readonly string[]> = {
  edit: ['officer', 'admin_officer', 'admin', 'master'],
  approve: ['client_admin', 'client_officer', 'admin', 'master'],
  issue: ['officer', 'admin_officer', 'admin', 'master'],
  escalate: ['admin_officer', 'admin', 'master'],
  cancel: ['client_admin', 'client_officer', 'admin', 'master'],
  enforce: ['admin_officer', 'admin', 'master'],
  revoke: ['client_admin', 'client_officer', 'admin', 'master'],
}
