import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ShieldAlert, Siren, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

function severityStyles(severity: string) {
  const value = String(severity || '').toLowerCase()
  if (value === 'critical') {
    return 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100'
  }
  if (value === 'high') {
    return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100'
  }
  return 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100'
}

function eventIcon(eventType: string) {
  const value = String(eventType || '').toLowerCase()
  if (value === 'amber_alert') return Siren
  if (value === 'active_shooter' || value === 'national_security') return ShieldAlert
  if (value === 'civil_defense' || value === 'severe_weather' || value === 'emergency_alert') return AlertTriangle
  return ShieldCheck
}

export function PublicSafetyBanner() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const orgIds = useMemo(() => {
    if (!user) return [] as string[]
    const values = [user.organization_id, ...(user.extra_organization_ids || []), ...(user.authorized_work_locations || [])]
    return Array.from(new Set(values.filter(Boolean) as string[]))
  }, [user])

  const { data: alerts = [] } = useQuery({
    queryKey: ['public-safety-alerts', user?.id, orgIds],
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = new Date().toISOString()
      const query = ((supabase as any).from('public_safety_alerts') as any)
        .select('id, title, message, severity, event_type, scope, target_organization_ids, created_at, starts_at, expires_at')
        .eq('status', 'active')
        .lte('starts_at', now)
        .or(`expires_at.is.null,expires_at.gte.${now}`)
        .order('created_at', { ascending: false })

      // Client-side fallback filter for non-national alerts when org context exists.
      const { data, error } = await query
      if (error) throw error

      const rows = (data || []) as any[]
      return rows.filter((row) => {
        if (row.scope === 'national') return true
        const targets = Array.isArray(row.target_organization_ids) ? row.target_organization_ids : []
        if (targets.length === 0) return false
        return targets.some((id: string) => orgIds.includes(id))
      })
    },
  })

  const { data: acknowledgements = [] } = useQuery({
    queryKey: ['public-safety-alert-acks', user?.id],
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await ((supabase as any).from('public_safety_alert_acknowledgements') as any)
        .select('alert_id')
        .eq('user_id', user?.id)

      if (error) throw error
      return (data || []).map((row: any) => row.alert_id)
    },
  })

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await ((supabase as any).from('public_safety_alert_acknowledgements') as any)
        .insert({
          alert_id: alertId,
          user_id: user?.id,
          organization_id: user?.organization_id || null,
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-safety-alert-acks'] })
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to acknowledge alert')
    },
  })

  if (!user) return null

  const ackSet = new Set(acknowledgements)
  const activeUnacked = alerts.filter((a: any) => !ackSet.has(a.id))

  if (!activeUnacked.length) return null

  return (
    <div className="mb-4 space-y-2">
      {activeUnacked.map((alert: any) => {
        const Icon = eventIcon(alert.event_type)
        return (
          <div key={alert.id} className={`rounded-lg border px-4 py-3 ${severityStyles(alert.severity)}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Icon className="h-5 w-5 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">
                    {alert.title}
                    <span className="ml-2 text-xs uppercase opacity-80">{alert.scope}</span>
                  </p>
                  <p className="text-sm opacity-90 mt-1">{alert.message}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={acknowledgeMutation.isPending}
                onClick={() => acknowledgeMutation.mutate(alert.id)}
              >
                Acknowledge
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
