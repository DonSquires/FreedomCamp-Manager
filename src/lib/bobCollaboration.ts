export type BobCollaborationSource =
  | 'feedback-ai'
  | 'copilot'
  | 'officer-portal'
  | 'dispatch'
  | 'system'

export interface BobCollaborationPacket {
  id: string
  source: BobCollaborationSource
  title: string
  prompt: string
  summary?: string
  route?: string
  /** When true, BobAssistantStudio will auto-send the prompt to the AI without user interaction */
  autoSubmit?: boolean
  /** Route to navigate back to after Bob has responded (e.g. '/compliance-escalations') */
  returnRoute?: string
  createdAt: string
  expiresAt?: string
  metadata?: Record<string, unknown>
}

// ──────────────────────────────────────────────────────────────────
// Response side — Bob's answers flow back to the originating caller
// ──────────────────────────────────────────────────────────────────

export interface BobResponsePacket {
  /** Matches the BobCollaborationPacket.id this responds to */
  requestId: string
  responseText: string
  summary?: string
  createdAt: string
}

/** Browser CustomEvent name fired when Bob publishes a response */
export const BOB_RESPONSE_EVENT = 'BOB_RESPONSE_READY'

const RESPONSES_KEY = 'bob-response-queue'

function readResponses(): BobResponsePacket[] {
  if (!canUseSessionStorage()) return []
  try {
    const raw = window.sessionStorage.getItem(RESPONSES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeResponses(queue: BobResponsePacket[]) {
  if (!canUseSessionStorage()) return
  window.sessionStorage.setItem(RESPONSES_KEY, JSON.stringify(queue))
}

/** Called by BobAssistantStudio when the AI finishes answering a collaboration packet */
export function publishBobResponse(requestId: string, responseText: string, summary?: string) {
  const entry: BobResponsePacket = {
    requestId,
    responseText,
    summary: summary ?? responseText.slice(0, 140),
    createdAt: new Date().toISOString(),
  }
  const queue = readResponses()
  queue.unshift(entry)
  writeResponses(queue.slice(0, 40))

  // Notify any listening hook in the same tab
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(BOB_RESPONSE_EVENT, { detail: { requestId } })
    )
  }
}

/** Consume (remove + return) Bob's response for a specific requestId */
export function consumeBobResponse(requestId: string): BobResponsePacket | null {
  const queue = readResponses()
  const idx = queue.findIndex((r) => r.requestId === requestId)
  if (idx === -1) return null
  const [response] = queue.splice(idx, 1)
  writeResponses(queue)
  return response
}

/** Read all pending responses without removing them */
export function peekBobResponses(): BobResponsePacket[] {
  return readResponses()
}

const STORAGE_KEY = 'bob-collaboration-queue'

function canUseSessionStorage() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

function readQueue(): BobCollaborationPacket[] {
  if (!canUseSessionStorage()) return []

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const now = Date.now()
    return parsed.filter((packet) => {
      if (!packet || typeof packet !== 'object') return false
      if (!packet.expiresAt) return true
      const expiresAt = Date.parse(packet.expiresAt)
      return Number.isNaN(expiresAt) || expiresAt > now
    }) as BobCollaborationPacket[]
  } catch {
    return []
  }
}

function writeQueue(queue: BobCollaborationPacket[]) {
  if (!canUseSessionStorage()) return
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

export function publishBobCollaborationPacket(packet: Omit<BobCollaborationPacket, 'id' | 'createdAt'>) {
  const entry: BobCollaborationPacket = {
    ...packet,
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  }

  const queue = readQueue()
  queue.unshift(entry)
  writeQueue(queue.slice(0, 20))
  return entry
}

export function peekBobCollaborationPackets() {
  return readQueue()
}

export function consumeLatestBobCollaborationPacket() {
  const queue = readQueue()
  const packet = queue.shift() ?? null
  writeQueue(queue)
  return packet
}

export function clearBobCollaborationPackets() {
  writeQueue([])
}