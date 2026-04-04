/**
 * useBobCollaboration — bidirectional sub-agent hook
 *
 * Lets any page/component "ask Bob" a question and receive the answer back
 * without the user having to copy-paste anything.
 *
 * USAGE
 * ──────────────────────────────────────────────────────────────────────
 * const { askBob, bobResponse, isWaiting, clearResponse } = useBobCollaboration()
 *
 * // Fire-and-forget with autoSubmit — Bob processes in the background
 * askBob({
 *   title: 'Escalation Analysis',
 *   prompt: `Analyse this breach: ${breach.description}`,
 *   source: 'dispatch',
 *   summary: 'Auto-analysing breach #' + breach.id,
 *   autoSubmit: true,
 *   returnRoute: '/compliance-escalations',
 * })
 *
 * // When Bob has answered, bobResponse.responseText is populated
 * if (bobResponse) {
 *   console.log(bobResponse.responseText)
 * }
 * ──────────────────────────────────────────────────────────────────────
 *
 * LIFECYCLE
 *  1. `askBob()` publishes a BobCollaborationPacket and navigates to /bob-assistant
 *  2. BobAssistantStudio consumes the packet, (optionally) auto-sends to AI
 *  3. After the AI replies, Bob calls publishBobResponse(requestId, reply)
 *     which fires the BOB_RESPONSE_READY CustomEvent
 *  4. This hook catches the event → calls consumeBobResponse(requestId) → sets bobResponse
 *  5. When the user returns to the originating page, bobResponse is available inline
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  type BobCollaborationPacket,
  type BobCollaborationSource,
  type BobResponsePacket,
  BOB_RESPONSE_EVENT,
  publishBobCollaborationPacket,
  consumeBobResponse,
  peekBobResponses,
} from '@/lib/bobCollaboration'

const PENDING_ID_KEY = 'bob-collaboration-pending-id'

function readPendingId(): string | null {
  try {
    return (typeof window !== 'undefined' && window.sessionStorage.getItem(PENDING_ID_KEY)) || null
  } catch {
    return null
  }
}

function writePendingId(id: string | null) {
  try {
    if (typeof window === 'undefined') return
    if (id) {
      window.sessionStorage.setItem(PENDING_ID_KEY, id)
    } else {
      window.sessionStorage.removeItem(PENDING_ID_KEY)
    }
  } catch {
    // sessionStorage unavailable — ref-only mode
  }
}

interface AskBobOptions {
  title: string
  prompt: string
  source: BobCollaborationSource
  summary?: string
  autoSubmit?: boolean
  returnRoute?: string
  expiresAt?: string
  metadata?: Record<string, unknown>
}

interface UseBobCollaborationReturn {
  /** Send a request to Bob. Navigates to /bob-assistant automatically. */
  askBob: (options: AskBobOptions) => BobCollaborationPacket
  /** Bob's response, once ready. Null until Bob has answered. */
  bobResponse: BobResponsePacket | null
  /** True from the moment askBob() is called until a response arrives. */
  isWaiting: boolean
  /** Current in-flight request packet (null if no active request). */
  pendingPacket: BobCollaborationPacket | null
  /** Clear the response state so the component can ask another question. */
  clearResponse: () => void
}

export function useBobCollaboration(): UseBobCollaborationReturn {
  const navigate = useNavigate()
  const [pendingPacket, setPendingPacket] = useState<BobCollaborationPacket | null>(null)
  const [bobResponse, setBobResponse] = useState<BobResponsePacket | null>(null)
  const [isWaiting, setIsWaiting] = useState(false)
  const pendingIdRef = useRef<string | null>(readPendingId())

  const resolveResponse = useCallback((id: string) => {
    const response = consumeBobResponse(id)
    if (response) {
      setBobResponse(response)
      setIsWaiting(false)
      setPendingPacket(null)
      pendingIdRef.current = null
      writePendingId(null)
    }
  }, [])

  // Listen for BOB_RESPONSE_READY events fired by BobAssistantStudio
  useEffect(() => {
    const handler = (e: Event) => {
      const { requestId } = (e as CustomEvent<{ requestId: string }>).detail
      if (!pendingIdRef.current || requestId !== pendingIdRef.current) return
      resolveResponse(requestId)
    }

    window.addEventListener(BOB_RESPONSE_EVENT, handler)
    return () => window.removeEventListener(BOB_RESPONSE_EVENT, handler)
  }, [resolveResponse])

  // On mount: check sessionStorage for an in-flight request whose response already
  // arrived while we were navigated away (the React ref is gone but sessionStorage persists).
  useEffect(() => {
    const id = readPendingId()
    if (!id) return

    // Hydrate React state from sessionStorage so isWaiting shows correctly
    pendingIdRef.current = id
    setIsWaiting(true)

    // Check if Bob already answered while we were away
    const queued = peekBobResponses()
    const existing = queued.find((r) => r.requestId === id)
    if (existing) {
      resolveResponse(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const askBob = useCallback((options: AskBobOptions): BobCollaborationPacket => {
    const packet = publishBobCollaborationPacket({
      title: options.title,
      prompt: options.prompt,
      source: options.source,
      summary: options.summary,
      autoSubmit: options.autoSubmit ?? false,
      returnRoute: options.returnRoute,
      expiresAt: options.expiresAt,
      metadata: options.metadata,
    })

    pendingIdRef.current = packet.id
    writePendingId(packet.id)
    setPendingPacket(packet)
    setIsWaiting(true)
    setBobResponse(null)

    navigate('/bob-assistant')
    return packet
  }, [navigate])

  const clearResponse = useCallback(() => {
    setBobResponse(null)
    setIsWaiting(false)
    setPendingPacket(null)
    pendingIdRef.current = null
    writePendingId(null)
  }, [])

  return { askBob, bobResponse, isWaiting, pendingPacket, clearResponse }
}
