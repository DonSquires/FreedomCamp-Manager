import { useEffect } from 'react'
import { cn } from '@/lib/utils'

export type BobOrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'degraded'

/**
 * Keyframes for Bob visual states per Iron Eagle design spec (INSTRUCTION_MANUAL.md §1a):
 *
 *  - thinking : slow red pulsing ring at 1.5 s; box-shadow: 0 0 0 4px rgba(211,47,47,0.4)
 *               Respects prefers-reduced-motion (falls back to static red outline)
 *  - listening: green pulsing ring (active voice capture)
 */
const BOB_KEYFRAMES = `
@keyframes bobThinkPulse {
  0%   { box-shadow: 0 0 0 0 rgba(211,47,47,0.0); }
  50%  { box-shadow: 0 0 0 4px rgba(211,47,47,0.4); }
  100% { box-shadow: 0 0 0 0 rgba(211,47,47,0.0); }
}
@keyframes bobListenPulse {
  0%   { box-shadow: 0 0 0 2px rgba(34,197,94,0.2); }
  50%  { box-shadow: 0 0 0 6px rgba(34,197,94,0.5); }
  100% { box-shadow: 0 0 0 2px rgba(34,197,94,0.2); }
}
@media (prefers-reduced-motion: reduce) {
  .bob-orb-thinking  { animation: none !important; box-shadow: 0 0 0 4px rgba(211,47,47,0.4) !important; }
  .bob-orb-listening { animation: none !important; box-shadow: 0 0 0 3px rgba(34,197,94,0.6) !important; }
}
`

interface BobOrbProps {
  state?: BobOrbState
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_OUTER: Record<'sm' | 'md' | 'lg', number> = { sm: 32, md: 40, lg: 56 }
const SIZE_INNER: Record<'sm' | 'md' | 'lg', number> = { sm: 28, md: 36, lg: 50 }

/**
 * BobOrb — button-style indicator reflecting Bob's current state.
 *
 * Visual states per INSTRUCTION_MANUAL.md §1a "Bob AI Interaction":
 *  - idle      : outlined, --color-accent-silver border, white icon/label
 *  - listening : green pulsing ring (active voice capture)
 *  - thinking  : slow red pulsing ring (box-shadow rgba(211,47,47,0.4), 1.5 s cycle)
 *  - speaking  : solid --color-brand-primary border (not pulsing)
 *  - degraded  : muted grey outline
 */
export function BobOrb({ state = 'idle', size = 'md', className }: BobOrbProps) {
  const outerPx = SIZE_OUTER[size]
  const innerPx = SIZE_INNER[size]

  // Inject keyframes once
  useEffect(() => {
    const id = 'bob-orb-keyframes'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = BOB_KEYFRAMES
      document.head.appendChild(style)
    }
  }, [])

  const stateStyles: Record<BobOrbState, React.CSSProperties> = {
    // Idle: silver outline, no animation
    idle: {
      border: '2px solid var(--color-accent-silver, #9e9e9e)',
    },
    // Listening: green pulsing ring
    listening: {
      border: '2px solid rgba(34,197,94,0.8)',
      animation: 'bobListenPulse 1s ease-in-out infinite',
    },
    // Thinking: slow red pulsing ring per spec (1.5 s cycle)
    thinking: {
      border: '2px solid rgba(211,47,47,0.4)',
      animation: 'bobThinkPulse 1.5s ease-in-out infinite',
    },
    // Speaking: solid brand-primary border, no pulse
    speaking: {
      border: '2px solid var(--color-brand-primary, #D32F2F)',
    },
    // Degraded: muted grey
    degraded: {
      border: '2px solid rgba(107,114,128,0.5)',
    },
  }

  const stateClass: Record<BobOrbState, string> = {
    idle: '',
    listening: 'bob-orb-listening',
    thinking: 'bob-orb-thinking',
    speaking: '',
    degraded: '',
  }

  return (
    <div
      className={cn('relative flex items-center justify-center rounded-full flex-shrink-0', stateClass[state], className)}
      style={{ width: outerPx, height: outerPx, ...stateStyles[state] }}
      aria-label={`Bob assistant — ${state}`}
    >
      {/* Inner fill with label */}
      <div
        className="rounded-full bg-background flex items-center justify-center font-bold text-foreground select-none"
        style={{ width: innerPx, height: innerPx, fontSize: Math.max(10, innerPx * 0.32) }}
      >
        B
      </div>
    </div>
  )
}
