import { supabase } from '@/lib/supabase'

export type KeyAuditKind = 'chain_audit' | 'full_audit'

type RecordKeyAuditParams = {
  organizationId: string
  keySetId: string
  action?: 'created' | 'updated' | 'deleted' | 'transferred' | 'inventory_check' | 'key_added' | 'key_removed'
  details?: Record<string, unknown>
}

export async function recordKeyAudit({
  organizationId,
  keySetId,
  action = 'inventory_check',
  details = {},
}: RecordKeyAuditParams) {
  const { error } = await (supabase as any).rpc('record_key_audit', {
    p_organization_id: organizationId,
    p_action: action,
    p_key_set_id: keySetId,
    p_key_custody_id: null,
    p_details: details,
  })

  if (error) throw error
}

export async function recordChainAudit(params: {
  organizationId: string
  keySetId: string
  keySetName?: string | null
  patrolRouteId?: string | null
  patrolRouteName?: string | null
  patrolRouteCode?: string | null
  shiftId?: string | null
  shiftPhase?: 'start' | 'end' | null
  officerId?: string | null
  officerName?: string | null
  kind: KeyAuditKind
}) {
  await recordKeyAudit({
    organizationId: params.organizationId,
    keySetId: params.keySetId,
    details: {
      audit_kind: params.kind,
      audit_scope: 'patrol_chain',
      key_set_name: params.keySetName ?? null,
      patrol_route_id: params.patrolRouteId ?? null,
      patrol_route_name: params.patrolRouteName ?? null,
      patrol_route_code: params.patrolRouteCode ?? null,
      shift_id: params.shiftId ?? null,
      shift_phase: params.shiftPhase ?? null,
      officer_id: params.officerId ?? null,
      officer_name: params.officerName ?? null,
    },
  })
}

export async function recordFullKeyAudit(organizationId: string, keySetIds: string[]) {
  const results = await Promise.allSettled(
    keySetIds.map((keySetId) => recordKeyAudit({
      organizationId,
      keySetId,
      details: {
        audit_kind: 'full_audit',
        audit_scope: 'patrol_chain',
      },
    }))
  )

  return {
    recorded: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  }
}