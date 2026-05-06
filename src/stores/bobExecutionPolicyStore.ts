import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useAuthStore } from './authStore'

export type BobExecutionMode = 'auto' | 'owner_full' | 'master_balanced' | 'officer_assist'

export interface EffectiveBobExecutionPolicy {
  mode: Exclude<BobExecutionMode, 'auto'>
  role: string
  title: string | null
  enforceSchemaCheck: boolean
  enforceHardSections: boolean
  showActionChecklist: boolean
  canRunAutomation: boolean
  requiresGuardrails: boolean
}

interface BobExecutionPolicyState {
  mode: BobExecutionMode
  enforceSchemaCheck: boolean
  enforceHardSections: boolean
  showActionChecklist: boolean
  setMode: (mode: BobExecutionMode) => void
  setEnforceSchemaCheck: (value: boolean) => void
  setEnforceHardSections: (value: boolean) => void
  setShowActionChecklist: (value: boolean) => void
  reset: () => void
}

const DEFAULT_STATE = {
  mode: 'auto' as BobExecutionMode,
  enforceSchemaCheck: true,
  enforceHardSections: true,
  showActionChecklist: true,
}

const OWNER_TITLE_MATCHERS = ['owner', 'founder', 'director', 'chief executive', 'ceo', 'managing director']

function includesOwnerTitle(title: string | null | undefined): boolean {
  const normalized = (title || '').trim().toLowerCase()
  if (!normalized) return false
  return OWNER_TITLE_MATCHERS.some((matcher) => normalized.includes(matcher))
}

function resolveAutoMode(role: string | null | undefined, title: string | null | undefined): Exclude<BobExecutionMode, 'auto'> {
  const normalizedRole = String(role || '').toLowerCase()
  // Owner-level execution is role-anchored. Title is informational only.
  if (normalizedRole === 'grand_master') {
    return 'owner_full'
  }
  if (normalizedRole === 'master' || normalizedRole === 'admin' || normalizedRole === 'client_admin') {
    return 'master_balanced'
  }
  return 'officer_assist'
}

function canOverrideMode(role: string | null | undefined): boolean {
  const normalizedRole = String(role || '').toLowerCase()
  return normalizedRole === 'master' || normalizedRole === 'grand_master'
}

export const useBobExecutionPolicyStore = create<BobExecutionPolicyState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      setMode: (mode) => set({ mode }),
      setEnforceSchemaCheck: (value) => set({ enforceSchemaCheck: value }),
      setEnforceHardSections: (value) => set({ enforceHardSections: value }),
      setShowActionChecklist: (value) => set({ showActionChecklist: value }),
      reset: () => set(DEFAULT_STATE),
    }),
    {
      name: 'bob-execution-policy',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)

export function getEffectiveBobExecutionPolicy(): EffectiveBobExecutionPolicy {
  const user = useAuthStore.getState().user
  const policy = useBobExecutionPolicyStore.getState()

  const role = user?.role || 'unknown'
  const title = user?.job_title || null
  const titleSignalsOwner = includesOwnerTitle(title)
  const autoMode = resolveAutoMode(role, title)
  const allowOverride = canOverrideMode(role)
  const mode = policy.mode === 'auto' || !allowOverride ? autoMode : policy.mode

  if (mode === 'owner_full') {
    return {
      mode,
      role,
      title: titleSignalsOwner ? `${title} (title hint only)` : title,
      enforceSchemaCheck: policy.enforceSchemaCheck,
      enforceHardSections: policy.enforceHardSections,
      showActionChecklist: policy.showActionChecklist,
      canRunAutomation: true,
      requiresGuardrails: false,
    }
  }

  if (mode === 'master_balanced') {
    return {
      mode,
      role,
      title: titleSignalsOwner ? `${title} (title hint only)` : title,
      enforceSchemaCheck: policy.enforceSchemaCheck,
      enforceHardSections: policy.enforceHardSections,
      showActionChecklist: policy.showActionChecklist,
      canRunAutomation: false,
      requiresGuardrails: true,
    }
  }

  return {
    mode,
    role,
    title: titleSignalsOwner ? `${title} (title hint only)` : title,
    enforceSchemaCheck: true,
    enforceHardSections: true,
    showActionChecklist: true,
    canRunAutomation: false,
    requiresGuardrails: true,
  }
}
