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
} from '@/lib/bobCollaboration'

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
  const pendingIdRef = useRef<string | null>(null)

  // Listen for BOB_RESPONSE_READY events fired by BobAssistantStudio
  useEffect(() => {
    const handler = (e: Event) => {
      const { requestId } = (e as CustomEvent<{ requestId: string }>).detail
      if (!pendingIdRef.current || requestId !== pendingIdRef.current) return

      const response = consumeBobResponse(requestId)
      if (response) {
        setBobResponse(response)
        setIsWaiting(false)
        setPendingPacket(null)
        pendingIdRef.current = null
      }
    }

    window.addEventListener(BOB_RESPONSE_EVENT, handler)
    return () => window.removeEventListener(BOB_RESPONSE_EVENT, handler)
  }, [])

  // On mount: check if we already have a response for an in-flight request
  // (handles the case of navigating back to this page after Bob answered)
  useEffect(() => {
    if (!pendingIdRef.current) return
    const response = consumeBobResponse(pendingIdRef.current)
    if (response) {
      setBobResponse(response)
      setIsWaiting(false)
      setPendingPacket(null)
      pendingIdRef.current = null
    }
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
  }, [])

  return { askBob, bobResponse, isWaiting, pendingPacket, clearResponse }
}
