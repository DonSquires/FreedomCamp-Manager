import { cn } from '@/lib/utils'

type BobCapability = {
  id: string
  label: string
  grandMasterOnly: boolean
}

type BobPrivilegesMatrixProps = {
  role: string | null | undefined
  variant?: 'quick' | 'studio'
}

const BOB_CAPABILITIES: BobCapability[] = [
  { id: 'quick-chat', label: 'Quick Chat And Guidance', grandMasterOnly: false },
  { id: 'route-aware-advice', label: 'Route-Aware Operational Advice', grandMasterOnly: false },
  { id: 'self-heal-maintenance', label: 'Self-Heal Maintenance Actions', grandMasterOnly: true },
  { id: 'approve-deploy', label: 'Approve And Deploy Patch', grandMasterOnly: true },
  { id: 'mobile-controls', label: 'Mobile Build And OTA Controls', grandMasterOnly: true },
  { id: 'audit-trail', label: 'Bob Audit Trail Access', grandMasterOnly: true },
]

function getRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Unknown'

  return role
    .split('_')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ')
}

function canUseCapability(role: string | null | undefined, capability: BobCapability): boolean {
  if (!capability.grandMasterOnly) return true
  return role === 'grand_master'
}

export function BobPrivilegesMatrix({ role, variant = 'studio' }: BobPrivilegesMatrixProps) {
  const roleLabel = getRoleLabel(role)
  const elevatedAllowedCount = BOB_CAPABILITIES
    .filter((capability) => capability.grandMasterOnly && canUseCapability(role, capability))
    .length

  return (
    <div
      className={cn(
        variant === 'quick'
          ? 'border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40'
          : 'space-y-2',
      )}
    >
      <div className={cn('mb-2 flex items-center justify-between', variant === 'quick' ? 'text-xs' : 'text-sm')}>
        <p className={cn('font-medium', variant === 'quick' ? 'text-slate-700 dark:text-slate-200' : 'text-foreground')}>
          Your Bob Privileges
        </p>
        <p className={cn(variant === 'quick' ? 'text-slate-500 dark:text-slate-400' : 'text-muted-foreground')}>
          Role:{' '}
          <span className={cn('font-medium', variant === 'quick' ? 'text-slate-700 dark:text-slate-200' : 'text-foreground')}>
            {roleLabel}
          </span>
        </p>
      </div>

      <div className={cn('grid grid-cols-1', variant === 'quick' ? 'gap-1.5' : 'gap-2')}>
        {BOB_CAPABILITIES.map((capability) => {
          const allowed = canUseCapability(role, capability)
          return (
            <div
              key={capability.id}
              className={cn(
                'flex items-center justify-between rounded-md border',
                variant === 'quick'
                  ? 'border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900/70'
                  : 'p-2 text-sm',
              )}
            >
              <span className={cn(variant === 'quick' ? 'text-slate-700 dark:text-slate-200' : '')}>{capability.label}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-medium',
                  variant === 'quick' ? 'text-[11px]' : 'text-xs',
                  allowed
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
                )}
              >
                {allowed ? 'Allowed' : 'Grand Master Only'}
              </span>
            </div>
          )
        })}
      </div>

      <p className={cn(variant === 'quick' ? 'mt-2 text-[11px] text-slate-500 dark:text-slate-400' : 'text-xs text-muted-foreground')}>
        Elevated actions available: {elevatedAllowedCount}/4.
      </p>
    </div>
  )
}
