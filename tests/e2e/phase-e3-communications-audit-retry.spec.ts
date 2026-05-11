import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const contractPaths = {
  realignmentPlan: 'docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md',
  moduleRoadmap: 'docs/MODULE_ROADMAP.md',
  staging: 'docs/STAGING.md',
  notificationsCenter: 'src/pages/NotificationsCenter.tsx',
  useNotifications: 'src/hooks/useNotifications.ts',
  useOfficerNotifications: 'src/hooks/useOfficerNotifications.ts',
  edgeFunctionsClient: 'src/lib/edgeFunctions.ts',
  pushNotificationsClient: 'src/lib/pushNotifications.ts',
  pushFunction: 'supabase/functions/send-push-notification/index.ts',
  reportEmailFunction: 'supabase/functions/send-report-email/index.ts',
  inviteEmailFunction: 'supabase/functions/send-invite-email/index.ts',
  fetchWithRetry: 'supabase/functions/_shared/fetchWithRetry.ts',
  communicationsAudit: 'supabase/functions/_shared/communicationsAudit.ts',
  communicationsMigration: 'supabase/migrations/20260506000011_platform_enhancements_complete.sql',
}

function repoPath(relativePath: string) {
  return path.resolve(process.cwd(), relativePath)
}

function source(relativePath: string) {
  return fs.readFileSync(repoPath(relativePath), 'utf8')
}

test.describe('Phase E3 — Communications audit and retry governance gate', () => {
  test('E3 communications contract files remain present', () => {
    for (const [label, relativePath] of Object.entries(contractPaths)) {
      expect(fs.existsSync(repoPath(relativePath)), `${label} should remain at ${relativePath}`).toBe(true)
    }
  })

  test('realignment plan preserves E3 communications ownership and exit criteria', () => {
    const plan = source(contractPaths.realignmentPlan)

    expect(plan).toContain('Slice E3, Communications Lead: email, push, in-app delivery auditing and retry governance')
    expect(plan).toContain('Communications delivery audit and retry metrics are visible in operations dashboards')
    expect(plan).toContain('Communications Lead owns PTT binding, push, email, in-app delivery degradation paths, and audit visibility')
    expect(plan).toContain('Communications are treated as platform infrastructure, not page-specific utilities.')
  })

  test('in-app notification surfaces retain delivery tracking and org-bounded broadcast anchors', () => {
    const hook = source(contractPaths.useNotifications)
    const officerHook = source(contractPaths.useOfficerNotifications)
    const dashboard = source(contractPaths.notificationsCenter)

    expect(hook).toContain('Push notification management and delivery tracking')
    expect(hook).toContain('delivered: boolean')
    expect(hook).toContain('delivered_at: string | null')
    expect(hook).toContain(".from('notifications')")
    expect(hook).toContain('edgeFunctions.sendPushNotification')

    expect(officerHook).toContain('useOperationalOrganization')
    expect(officerHook).toContain(".eq('organization_id', operationalOrganizationId)")

    expect(dashboard).toContain('Inbox, broadcast, and notification preferences')
    expect(dashboard).toContain(".eq('organization_id', orgId)")
    expect(dashboard).toContain('delivered: false')
    expect(dashboard).toContain('organization_id: orgId')
    expect(dashboard).toContain('E3 Communications Delivery Metrics')
    expect(dashboard).toContain('Delivery success')
    expect(dashboard).toContain('Delivery failures')
    expect(dashboard).toContain('Retry backlog')
    expect(dashboard).toContain('Stale pending')
    expect(dashboard).toContain("queryKey: ['e3-communications-delivery-metrics', orgId]")
    expect(dashboard).toContain(".from('crm_communications')")
    expect(dashboard).toContain(".in('status', ['failed', 'bounced', 'spam'])")
    expect(dashboard).toContain(".gt('retry_count', 0)")
  })

  test('push delivery keeps web/expo degradation paths and token cleanup outcomes', () => {
    const pushFunction = source(contractPaths.pushFunction)
    const pushClient = source(contractPaths.pushNotificationsClient)
    const auditHelper = source(contractPaths.communicationsAudit)

    expect(pushFunction).toContain('Unified Push Notification Service')
    expect(pushFunction).toContain("import { recordCommunicationAudit } from '../_shared/communicationsAudit.ts'")
    expect(pushFunction).toContain('organization_id')
    expect(pushFunction).toContain('VAPID Web Push')
    expect(pushFunction).toContain('Expo Push API')
    expect(pushFunction).toContain('sendWebPush')
    expect(pushFunction).toContain("provider: 'web_push'")
    expect(pushFunction).toContain("provider: 'expo'")
    expect(pushFunction).toContain('webPushFallbackReason')
    expect(pushFunction).toContain('retryCount: webPushFallbackReason ? 1 : 0')
    expect(pushFunction).toContain("JSON.stringify({ success: true, channel: 'web_push' })")
    expect(pushFunction).toContain('console.warn(`Web push failed (${resp.status}), falling back to Expo`)')
    expect(pushFunction).toContain("JSON.stringify({ success: false, reason: 'no_push_token' })")
    expect(pushFunction).toContain("JSON.stringify({ success: false, reason: 'invalid_token' })")
    expect(pushFunction).toContain("data.details?.error === 'DeviceNotRegistered'")
    expect(pushFunction).toContain('push_subscription: null')
    expect(pushFunction).toContain('push_token: null')

    expect(pushClient).toContain('sendPushNotification')
    expect(pushClient).toContain('edgeFunctions.sendPushNotification')

    expect(auditHelper).toContain("from('crm_communications')")
    expect(auditHelper).toContain('organization_id: params.organizationId')
    expect(auditHelper).toContain("direction: 'outbound'")
    expect(auditHelper).toContain('external_provider: params.provider')
    expect(auditHelper).toContain('retry_count: params.retryCount ?? 0')
    expect(auditHelper).toContain('communications audit insert failed')
  })

  test('email delivery keeps bounded SMTP validation and fallback paths', () => {
    const reportEmail = source(contractPaths.reportEmailFunction)
    const inviteEmail = source(contractPaths.inviteEmailFunction)
    const edgeClient = source(contractPaths.edgeFunctionsClient)

    expect(reportEmail).toContain('SMTP_HOST')
    expect(reportEmail).toContain("import { recordCommunicationAudit } from '../_shared/communicationsAudit.ts'")
    expect(reportEmail).toContain('recipient_email')
    expect(reportEmail).toContain('Invalid email address')
    expect(reportEmail).toContain("if (organization_id) obsQuery = obsQuery.eq('organization_id', organization_id)")
    expect(reportEmail).toContain('Promise.all([obsQuery, enfQuery, matrixQuery])')
    expect(reportEmail).toContain("provider: 'smtp'")
    expect(reportEmail).toContain("status: 'delivered'")
    expect(reportEmail).toContain("status: 'failed'")

    expect(inviteEmail).toContain('safeErrorText')
    expect(inviteEmail).toContain("import { recordCommunicationAudit } from '../_shared/communicationsAudit.ts'")
    expect(inviteEmail).toContain('organization_id')
    expect(inviteEmail).toContain('sendInviteDirectSmtp')
    expect(inviteEmail).toContain('DIRECT_SMTP_NOT_CONFIGURED')
    expect(inviteEmail).toContain('SMTP_NOT_CONFIGURED')
    expect(inviteEmail).toContain('INVITE_RELAY_FAILED')
    expect(inviteEmail).toContain("provider: 'proxy_relay'")
    expect(inviteEmail).toContain("provider: 'direct_smtp'")
    expect(inviteEmail).toContain('retryCount: 1')

    expect(edgeClient).toContain('sendReportEmail')
    expect(edgeClient).toContain("callEdgeFunction('send-report-email'")
    expect(edgeClient).toContain('sendPushNotification')
    expect(edgeClient).toContain("callEdgeFunction('send-push-notification'")
  })

  test('communications audit schema and retry primitive remain available for E3 rollout metrics', () => {
    const migration = source(contractPaths.communicationsMigration)
    const retryHelper = source(contractPaths.fetchWithRetry)

    expect(migration).toContain('crm_communications')
    expect(migration).toContain("status TEXT NOT NULL DEFAULT 'pending'")
    expect(migration).toContain("'queued'")
    expect(migration).toContain("'delivered'")
    expect(migration).toContain("'failed'")
    expect(migration).toContain('external_message_id TEXT')
    expect(migration).toContain('external_provider TEXT')
    expect(migration).toContain('error_message TEXT')
    expect(migration).toContain('retry_count INTEGER DEFAULT 0')
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_communications_status')

    expect(retryHelper).toContain('DEFAULT_RETRYABLE_STATUSES')
    expect(retryHelper).toContain('408, 425, 429, 500, 502, 503, 504')
    expect(retryHelper).toContain('retries?: number')
    expect(retryHelper).toContain('timeoutMs?: number')
    expect(retryHelper).toContain('backoffMs')
  })

  test('roadmap and staging record E3 gate artifact ownership', () => {
    const roadmap = source(contractPaths.moduleRoadmap)
    const staging = source(contractPaths.staging)

    expect(roadmap).toContain('### E3 kickoff gate artifacts')
    expect(roadmap).toContain('tests/e2e/phase-e3-communications-audit-retry.spec.ts')
    expect(roadmap).toContain('.github/workflows/ci-phase-e3-communications-audit-retry-gate.yml')
    expect(roadmap).toContain('communications delivery audit, retry governance, degraded push/email outcomes, and operations visibility anchors')
    expect(roadmap).toContain('NotificationsCenter.tsx` now exposes an admin-only **E3 Communications Delivery Metrics** card')
    expect(roadmap).toContain('Runtime push/report/invite delivery attempts now write non-blocking `crm_communications` audit rows')

    expect(staging).toContain('Phase E3 Communications Audit and Retry Gate Kickoff')
    expect(staging).toContain('E3 communications audit/retry checkpoint')
    expect(staging).toContain('Phase E3 Communications Metrics Continuation')
    expect(staging).toContain('Phase E3 Runtime Communications Audit Continuation')
    expect(staging).toContain('send-push-notification')
    expect(staging).toContain('send-report-email')
    expect(staging).toContain('send-invite-email')
  })
})
