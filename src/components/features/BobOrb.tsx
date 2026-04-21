import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type BobOrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'degraded'

const THINKING_KEYFRAMES = `
@keyframes bobThinkPulse {
  0%   { transform: scale(1);    opacity: 1; }
  40%  { transform: scale(1.18); opacity: 0.7; }
  60%  { transform: scale(0.9);  opacity: 0.9; }
  100% { transform: scale(1);    opacity: 1; }
}
`

interface BobOrbProps {
  state?: BobOrbState
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const RING_GRADIENTS: Record<BobOrbState, string> = {
  idle: 'conic-gradient(from 0deg, #2dd4bf, #a855f7, #ec4899, #2dd4bf)',
  listening: 'conic-gradient(from 0deg, #4ade80, #14b8a6, #10b981, #4ade80)',
  thinking: 'conic-gradient(from 0deg, #fbbf24, #f97316, #facc15, #fbbf24)',
  speaking: 'conic-gradient(from 0deg, #60a5fa, #6366f1, #a855f7, #60a5fa)',
  degraded: 'conic-gradient(from 0deg, #9ca3af, #6b7280, #9ca3af, #6b7280)',
}

/** CSS animation name → animation string */
const RING_ANIMATION: Record<BobOrbState, string> = {
  idle: 'spin 5s linear infinite',
  listening: 'spin 1s linear infinite',
  thinking: 'bobThinkPulse 0.85s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  speaking: 'spin 1.5s linear infinite',
  degraded: 'none',
}

const SIZE_OUTER: Record<'sm' | 'md' | 'lg', number> = { sm: 32, md: 40, lg: 56 }
const SIZE_INNER: Record<'sm' | 'md' | 'lg', number> = { sm: 22, md: 28, lg: 40 }

/**
 * BobOrb — animated conic-gradient ring that reflects Bob's current state.
 *
 * States:
 *  - idle      : slow teal→purple→pink spin
 *  - listening : fast green spin
 *  - thinking  : amber pulse
 *  - speaking  : medium blue→indigo spin
 *  - degraded  : static grey
 */
export function BobOrb({ state = 'idle', size = 'md', className }: BobOrbProps) {
  const outerPx = SIZE_OUTER[size]
  const innerPx = SIZE_INNER[size]

  // Inject thinking keyframes once
  useEffect(() => {
    const id = 'bob-orb-keyframes'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = THINKING_KEYFRAMES
      document.head.appendChild(style)
    }
  }, [])

  return (
    <div
      className={cn('relative flex items-center justify-center rounded-full flex-shrink-0', className)}
      style={{ width: outerPx, height: outerPx }}
      aria-label={`Bob assistant — ${state}`}
    >
      {/* Conic gradient spinning ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: RING_GRADIENTS[state],
          animation: RING_ANIMATION[state],
        }}
      />
      {/* Inner fill (matches page background so only the ring edge shows) */}
      <div
        className="relative z-10 rounded-full bg-background flex items-center justify-center font-bold text-foreground select-none"
        style={{ width: innerPx, height: innerPx, fontSize: Math.max(10, innerPx * 0.32) }}
      >
        B
      </div>
    </div>
  )
}
