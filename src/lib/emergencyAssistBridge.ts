export type EmergencyAssistRequestSource = 'welfare_panic_button' | 'manual'

export interface EmergencyAssistRequestPacket {
  id: string
  source: EmergencyAssistRequestSource
  organizationId?: string | null
  officerId?: string | null
  officerName?: string | null
  locationLabel?: string | null
  latitude?: number | null
  longitude?: number | null
  reason?: string | null
  createdAt: string
}

export const EMERGENCY_ASSIST_REQUEST_EVENT = 'EMERGENCY_ASSIST_REQUEST'

const STORAGE_KEY = 'emergency-assist-request-queue'

function canUseSessionStorage() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

function readQueue(): EmergencyAssistRequestPacket[] {
  if (!canUseSessionStorage()) return []

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as EmergencyAssistRequestPacket[] : []
  } catch {
    return []
  }
}

function writeQueue(queue: EmergencyAssistRequestPacket[]) {
  if (!canUseSessionStorage()) return
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

export function publishEmergencyAssistRequest(packet: Omit<EmergencyAssistRequestPacket, 'id' | 'createdAt'>) {
  const entry: EmergencyAssistRequestPacket = {
    ...packet,
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  }

  const queue = readQueue()
  queue.unshift(entry)
  writeQueue(queue.slice(0, 30))

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EMERGENCY_ASSIST_REQUEST_EVENT, { detail: { id: entry.id } }))
  }

  return entry
}

export function consumeLatestEmergencyAssistRequest() {
  const queue = readQueue()
  const packet = queue.shift() ?? null
  writeQueue(queue)
  return packet
}

export function peekEmergencyAssistRequests() {
  return readQueue()
}