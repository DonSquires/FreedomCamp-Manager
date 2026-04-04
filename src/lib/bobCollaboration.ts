type BobCollaborationSource =
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
  createdAt: string
  expiresAt?: string
  metadata?: Record<string, unknown>
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