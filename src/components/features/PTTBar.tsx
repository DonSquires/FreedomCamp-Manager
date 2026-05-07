/**
 * PTTBar — Compact radio status widget
 *
 * Shows connection status, active channel and current speaker at a glance.
 * Full PTT control lives on the dedicated /radio page (PTTRadio.tsx).
 * This component is intentionally lean — no chat coupling, no channel
 * switching logic, no mic capture.
 */

import { useLocation, useNavigate } from 'react-router-dom'
import { Radio, Mic, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { usePTTStore, usePTTAvailable, usePTTCanSpeak } from '@/stores/pttStore'
import { useCallback, useState } from 'react'
import { startSpeaking, stopSpeaking } from '@/lib/ptt'

interface PTTBarProps {
  className?: string
  enableHoldToTalk?: boolean
  docked?: boolean
}

export function PTTBar({ className, enableHoldToTalk = false, docked = false }: PTTBarProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const connectionStatus = usePTTStore((s) => s.connectionStatus)
  const channelName      = usePTTStore((s) => s.channelName)
  const isSpeaking       = usePTTStore((s) => s.isSpeaking)
  const speakerId        = usePTTStore((s) => s.speakerId)
  const speakerName      = usePTTStore((s) => s.speakerName)
  const degradedMode     = usePTTStore((s) => s.degradedMode)
  const pttAvailable     = usePTTAvailable()
  const pttCanSpeak      = usePTTCanSpeak()
  const [holding, setHolding] = useState(false)

  const dotClass = {
    connected:    'bg-green-400 shadow-[0_0_5px_#4ade80]',
    connecting:   'bg-yellow-400 animate-pulse',
    reconnecting: 'bg-yellow-400 animate-pulse',
    disconnected: 'bg-slate-500',
    error:        'bg-red-500',
  }[connectionStatus] ?? 'bg-slate-500'

  const someoneSpeaking  = !!speakerId && !isSpeaking
  const iAmTransmitting  = isSpeaking
  const canTransmit = enableHoldToTalk && pttAvailable && pttCanSpeak
  const openRadioConsole = () => {
    navigate('/radio', { state: { from: `${location.pathname}${location.search}${location.hash}` } })
  }

  const handlePTTDown = useCallback(async () => {
    if (!canTransmit || holding || isSpeaking) return
    try {
      await startSpeaking()
      setHolding(true)
    } catch {
      // ptt.ts handles user-facing errors
    }
  }, [canTransmit, holding, isSpeaking])

  const handlePTTUp = useCallback(async () => {
    if (!holding && !isSpeaking) return
    try {
      await stopSpeaking()
    } catch {
      // silent cleanup
    } finally {
      setHolding(false)
    }
  }, [holding, isSpeaking])

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* P1-6: Degraded-mode amber banner */}
      {degradedMode && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-100 dark:text-amber-200 dark:bg-amber-900/50 px-2 py-1 rounded">
          ⚠ PTT server unreachable — use radio or direct call
        </div>
      )}
      <div className={cn('flex items-center gap-2', docked && 'rounded-2xl border border-slate-200/70 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 shadow-lg px-3 py-2')}>
      {/* Status dot + channel */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
        <span className="text-xs text-muted-foreground truncate max-w-[120px]">
          {channelName ?? 'Radio'}
        </span>
      </div>

      {/* Speaking indicator */}
      {(iAmTransmitting || someoneSpeaking) && (
        <div className={cn(
          'flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded',
          iAmTransmitting ? 'text-red-600 bg-red-50 dark:bg-red-950' : 'text-green-700 bg-green-50 dark:bg-green-950',
        )}>
          {iAmTransmitting ? <Mic className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          <span className="hidden sm:inline truncate max-w-[80px]">
            {iAmTransmitting ? 'TX' : speakerName ?? 'RX'}
          </span>
        </div>
      )}

      {/* Open Radio button */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs shrink-0"
        onClick={openRadioConsole}
      >
        <Radio className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Radio</span>
      </Button>

      {enableHoldToTalk && (
        <button
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return
            e.preventDefault()
            void handlePTTDown()
          }}
          onPointerUp={(e) => {
            e.preventDefault()
            void handlePTTUp()
          }}
          onPointerCancel={() => { void handlePTTUp() }}
          onPointerLeave={() => { if (isSpeaking) void handlePTTUp() }}
          onContextMenu={(e) => e.preventDefault()}
          title={isSpeaking ? 'Transmitting…' : (canTransmit ? 'Hold to Talk' : 'PTT unavailable')}
          className={cn(
            'flex items-center justify-center rounded-full h-9 w-9 transition-all select-none shrink-0',
            isSpeaking
              ? 'bg-red-600 shadow-[0_0_18px_rgba(220,38,38,0.6)] ring-2 ring-red-400/60'
              : canTransmit
                ? 'bg-blue-600 active:scale-95'
                : 'bg-slate-500 opacity-60 cursor-not-allowed',
          )}
          aria-label={isSpeaking ? 'Transmitting' : 'Push to Talk'}
        >
          <Mic className={cn('h-4 w-4 text-white', isSpeaking && 'animate-pulse')} />
        </button>
      )}
      </div>
    </div>
  )
}
