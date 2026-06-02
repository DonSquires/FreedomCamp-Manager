/**
 * BobGovernanceStatusStrip
 *
 * Reusable governance gate-state strip for governance-capable pages (Bob Assistant Studio,
 * Intel Approval Queue). Implements the pattern specified in INSTRUCTION_MANUAL.md §1a:
 *
 *   1. Show all four gate states as visible badges: proposal submitted, awaiting approver,
 *      approved, blocked by policy.
 *   2. Keep wording identical across pages to reduce operator ambiguity.
 *   3. Pair every state with icon plus text (not colour only).
 *   4. Keep the strip directly under the page header and above queue/content controls.
 *   5. If emergency-priority mode is active, add a high-visibility state badge that
 *      clarifies safety-only behavior.
 */

import { AlertTriangle, CheckCircle2, Clock, Send, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type GateState = 'submitted' | 'awaiting' | 'approved' | 'blocked'

interface BobGovernanceStatusStripProps {
  /** Currently active gate state to highlight. If null, shows all states neutrally. */
  activeState?: GateState | null
  /** When true shows the emergency-priority safety-only badge (INSTRUCTION_MANUAL.md §1a rule 5) */
  emergencyActive?: boolean
  className?: string
}

const GATE_STATES: Array<{
  key: GateState
  label: string
  icon: React.FC<{ className?: string }>
  activeClass: string
  inactiveClass: string
}> = [
  {
    key: 'submitted',
    label: 'Proposal Submitted',
    icon: ({ className }) => <Send className={className} />,
    activeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/50',
    inactiveClass: 'bg-muted/30 text-muted-foreground border-muted/30',
  },
  {
    key: 'awaiting',
    label: 'Awaiting Approver',
    icon: ({ className }) => <Clock className={className} />,
    activeClass: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50',
    inactiveClass: 'bg-muted/30 text-muted-foreground border-muted/30',
  },
  {
    key: 'approved',
    label: 'Approved',
    icon: ({ className }) => <CheckCircle2 className={className} />,
    activeClass: 'bg-green-500/20 text-green-300 border-green-500/50',
    inactiveClass: 'bg-muted/30 text-muted-foreground border-muted/30',
  },
  {
    key: 'blocked',
    label: 'Blocked by Policy',
    icon: ({ className }) => <ShieldAlert className={className} />,
    activeClass: 'bg-red-500/20 text-red-300 border-red-500/50',
    inactiveClass: 'bg-muted/30 text-muted-foreground border-muted/30',
  },
]

export function BobGovernanceStatusStrip({
  activeState = null,
  emergencyActive = false,
  className,
}: BobGovernanceStatusStripProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border/40 bg-muted/10',
        emergencyActive && 'border-destructive/60 bg-destructive/5',
        className,
      )}
      role="status"
      aria-label="Bob governance gate states"
    >
      <span className="text-xs font-medium text-muted-foreground mr-1 shrink-0">Governance:</span>

      {GATE_STATES.map(({ key, label, icon: Icon, activeClass, inactiveClass }) => {
        const isActive = activeState === key
        return (
          <Badge
            key={key}
            variant="outline"
            className={cn(
              'flex items-center gap-1 text-xs font-medium transition-colors',
              isActive ? activeClass : inactiveClass,
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </Badge>
        )
      })}

      {/* Emergency override badge — shown when emergency-priority mode is active */}
      {emergencyActive && (
        <Badge
          variant="outline"
          className="flex items-center gap-1 text-xs font-medium bg-destructive/20 text-red-300 border-destructive/60 animate-pulse"
        >
          <AlertTriangle className="h-3 w-3" />
          Safety-Only Mode Active
        </Badge>
      )}
    </div>
  )
}
