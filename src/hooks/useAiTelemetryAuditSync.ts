import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import type { AiTelemetryEvent } from '@/lib/aiTelemetry'

type AiMetricEvent = CustomEvent<AiTelemetryEvent & { emitted_at?: string }>

export function useAiTelemetryAuditSync() {
  const user = useAuthStore((state) => state.user)
  const globalOrganizationId = useGlobalFiltersStore((state) => state.organizationId)
  const canPersistAiTelemetry = user?.role === 'master' || user?.role === 'grand_master'

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!canPersistAiTelemetry) return

    const handleAiMetric = (event: Event) => {
      const detail = (event as AiMetricEvent).detail
      if (!detail || !user?.id) return

      const actorOrgId = user.role === 'master'
        ? (globalOrganizationId ?? user.organization_id ?? null)
        : (user.organization_id ?? globalOrganizationId ?? null)

      const payload = {
        action: 'ai_telemetry_event',
        entity_type: 'ai_surface',
        entity_id: detail.surface,
        performed_by: user.id,
        organization_id: actorOrgId,
        new_values: {
          surface: detail.surface,
          stage: detail.stage,
          success: detail.success,
          latency_ms: detail.latency_ms ?? null,
          reason: detail.reason ?? null,
          details: detail.details ?? null,
          emitted_at: detail.emitted_at ?? new Date().toISOString(),
        },
      }

      void supabase.from('audit_log').insert(payload as any)
    }

    window.addEventListener('ai:metric', handleAiMetric as EventListener)
    return () => {
      window.removeEventListener('ai:metric', handleAiMetric as EventListener)
    }
  }, [canPersistAiTelemetry, globalOrganizationId, user?.id, user?.organization_id, user?.role])
}
