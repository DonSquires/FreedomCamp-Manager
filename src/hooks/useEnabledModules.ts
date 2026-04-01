/**
 * useEnabledModules
 * 
 * Hook to get the list of enabled modules for the current user's organization.
 * Used for dynamic navigation, route protection, and feature gating.
 * 
 * Note: This hook uses type assertions because the organization_modules and
 * service_modules tables are created by a new migration that may not be
 * reflected in the generated database.ts types yet.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { ModuleId } from '@/modules/registry'
import { SERVICE_MODULES } from '@/modules/registry'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EnabledModule {
  moduleId: ModuleId
  moduleName: string
  status: 'active' | 'trial' | 'suspended' | 'cancelled' | 'pending' | 'disabled'
  licensedSeats: number | null
  currentSeats: number
}

export interface UseEnabledModulesResult {
  /** All modules with their status for the current organization */
  modules: EnabledModule[]
  /** Just the IDs of enabled (active or trial) modules */
  enabledModuleIds: ModuleId[]
  /** Check if a specific module is enabled */
  isModuleEnabled: (moduleId: ModuleId) => boolean
  /** Loading state */
  isLoading: boolean
  /** Error state */
  error: Error | null
  /** Refetch modules */
  refetch: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useEnabledModules(): UseEnabledModulesResult {
  const { user } = useAuthStore()
  const organizationId = user?.organization_id

  const { data, isLoading, error, refetch } = useQuery<EnabledModule[]>({
    queryKey: ['enabled-modules', organizationId],
    queryFn: async (): Promise<EnabledModule[]> => {
      if (!organizationId) {
        // If no organization, return only core module
        return [{
          moduleId: 'core',
          moduleName: SERVICE_MODULES.core.name,
          status: 'active',
          licensedSeats: null,
          currentSeats: 0,
        }]
      }

      // Try calling the RPC function if it exists
      // Fall back to direct table query if RPC doesn't exist yet
      try {
        const { data: modules, error: rpcError } = await (supabase as any)
          .rpc('get_enabled_modules', { p_organization_id: organizationId })

        if (!rpcError && modules) {
          // Map the response to our interface
          return (modules || []).map((m: any) => ({
            moduleId: m.module_id as ModuleId,
            moduleName: m.module_name,
            status: m.status as EnabledModule['status'],
            licensedSeats: m.licensed_seats,
            currentSeats: m.current_seats || 0,
          }))
        }
      } catch {
        // RPC doesn't exist yet, fall back to table query
      }

      // Fallback: Query organization_modules table directly
      try {
        const { data: subscriptions, error: subError } = await (supabase as any)
          .from('organization_modules')
          .select('module_id, status, licensed_seats, current_seats')
          .eq('organization_id', organizationId)
          .in('status', ['active', 'trial'])

        if (!subError && subscriptions) {
          return subscriptions.map((s: any) => ({
            moduleId: s.module_id as ModuleId,
            moduleName: SERVICE_MODULES[s.module_id as ModuleId]?.name || s.module_id,
            status: s.status,
            licensedSeats: s.licensed_seats,
            currentSeats: s.current_seats || 0,
          }))
        }
      } catch {
        // Table doesn't exist yet
      }

      // If nothing works, return all modules as enabled (for backwards compatibility)
      // This allows the app to work before the migration is run
      return Object.entries(SERVICE_MODULES)
        .filter(([_, m]) => !m.isCore)
        .map(([id, m]) => ({
          moduleId: id as ModuleId,
          moduleName: m.name,
          status: 'active' as const,
          licensedSeats: null,
          currentSeats: 0,
        }))
    },
    enabled: true, // Always run, even without org (will return core only)
    staleTime: 5 * 60 * 1000, // 5 minutes - modules don't change often
    gcTime: 10 * 60 * 1000,   // 10 minutes
    retry: 1,
  })

  const modules = data || []
  
  // Extract just the IDs of enabled modules (active or trial)
  const enabledModuleIds = modules
    .filter(m => m.status === 'active' || m.status === 'trial')
    .map(m => m.moduleId)
  
  // Ensure core is always included
  if (!enabledModuleIds.includes('core')) {
    enabledModuleIds.unshift('core')
  }

  // Helper function to check if a module is enabled
  const isModuleEnabled = (moduleId: ModuleId): boolean => {
    // Core is always enabled
    if (moduleId === 'core') return true
    
    // Grand master has access to everything
    if (user?.role === 'grand_master') return true
    
    return enabledModuleIds.includes(moduleId)
  }

  return {
    modules,
    enabledModuleIds,
    isModuleEnabled,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Hook: Check single module
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a specific module is enabled for the current organization.
 * Returns true/false based on the module subscription status.
 */
export function useModuleEnabled(moduleId: ModuleId): boolean {
  const { isModuleEnabled, isLoading } = useEnabledModules()
  
  // While loading, assume enabled to avoid flickering (optimistic)
  if (isLoading) return true
  
  return isModuleEnabled(moduleId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Hook: All modules for admin display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all available modules with their status for the current organization.
 * Used for the Module Management admin page.
 */
export function useAllModulesWithStatus() {
  const { user } = useAuthStore()
  const organizationId = user?.organization_id

  return useQuery({
    queryKey: ['all-modules-status', organizationId],
    queryFn: async () => {
      // Get all service modules from registry
      const allModules = Object.values(SERVICE_MODULES)
        .filter(m => !m.isCore)
        .sort((a, b) => a.displayOrder - b.displayOrder)

      if (!organizationId) {
        // Return all as disabled if no org
        return allModules.map(m => ({
          ...m,
          subscriptionStatus: 'disabled' as const,
          licensedSeats: null as number | null,
          currentSeats: 0,
        }))
      }

      // Try to get organization's module subscriptions
      let subscriptions: any[] = []
      try {
        const { data, error } = await (supabase as any)
          .from('organization_modules')
          .select('module_id, status, licensed_seats, current_seats')
          .eq('organization_id', organizationId)

        if (!error && data) {
          subscriptions = data
        }
      } catch {
        // Table doesn't exist yet
      }

      // Create a map for quick lookup
      const subMap = new Map(
        subscriptions.map((s: any) => [s.module_id, s])
      )

      // Merge with module registry
      return allModules.map(m => {
        const sub = subMap.get(m.id)
        return {
          ...m,
          subscriptionStatus: (sub?.status || 'disabled') as EnabledModule['status'],
          licensedSeats: sub?.licensed_seats ?? null,
          currentSeats: sub?.current_seats ?? 0,
        }
      })
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
  })
}
