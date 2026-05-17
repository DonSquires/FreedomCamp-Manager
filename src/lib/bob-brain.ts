import { supabase } from '@/lib/supabase'
import { assertBobMutationAccess, type BobExecutionMode } from '@/lib/bobMutationCatalog'

const sb = supabase as any

export type BobVoiceTarget = 'smoke_assessment' | 'alpr_scanner'

export interface BobVoiceStatePayload {
  target: BobVoiceTarget
  phrase: string
  source: 'assistant' | 'manual'
  at: string
}

export interface BobUserMemoryRow {
  user_id: string
  context_key: string
  context_value: string
  last_interaction: string
}

type ParsedShiftIntent = {
  shiftDate: string | null
  startTime: string | null
  endTime: string | null
  shiftType: string
}

export type BobActuationResult =
  | {
      status: 'needs_clarification'
      question: string
      missingFields: string[]
    }
  | {
      status: 'blocked'
      reason: string
    }
  | {
      status: 'success'
      summary: string
      created: {
        clientId: string
        siteId: string
        shiftId: string
      }
      computedLivingWage: number
      warnings: string[]
    }

const VOICE_EVENT = 'bob:voice-state'
const GLOBAL_LIVING_WAGE_NZD = Number(import.meta.env.VITE_GLOBAL_LIVING_WAGE_NZD || 27.8)

function normalizeText(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function parseSimpleTime(text: string): string | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2] || '0')
  const meridiem = (match[3] || '').toLowerCase()

  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return null
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
}

function parseShiftDate(text: string): string | null {
  const now = new Date()

  if (/\bnext\s+week\b/i.test(text)) {
    const nextWeek = new Date(now)
    nextWeek.setDate(now.getDate() + 7)
    return nextWeek.toISOString().slice(0, 10)
  }

  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (explicit?.[1]) return explicit[1]

  if (/\btomorrow\b/i.test(text)) {
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    return tomorrow.toISOString().slice(0, 10)
  }

  return now.toISOString().slice(0, 10)
}

function parseShiftIntent(text: string): ParsedShiftIntent {
  const startMatch = text.match(/\b(?:start(?:ing)?\s*(?:at)?|from)\s+([^,.;]+)/i)
  const endMatch = text.match(/\b(?:to|until|end(?:ing)?\s*(?:at)?)\s+([^,.;]+)/i)
  const shiftType = /\bnight\b/i.test(text) ? 'night' : /\bday\b/i.test(text) ? 'day' : 'standard'

  return {
    shiftDate: parseShiftDate(text),
    startTime: parseSimpleTime(startMatch?.[1] || text),
    endTime: parseSimpleTime(endMatch?.[1] || ''),
    shiftType,
  }
}

function extractClientName(text: string): string | null {
  const quoted = text.match(/client\s+["']([^"']+)["']/i)
  if (quoted?.[1]) return quoted[1].trim()

  const plain = text.match(/client\s+([a-z0-9\s&.-]{3,80})/i)
  return plain?.[1]?.trim() || null
}

function extractSiteAddress(text: string): string | null {
  const quoted = text.match(/(?:site|address)\s+["']([^"']+)["']/i)
  if (quoted?.[1]) return quoted[1].trim()

  const atPhrase = text.match(/\bat\s+([0-9][^,.;]{4,120})/i)
  return atPhrase?.[1]?.trim() || null
}

function shouldActuate(text: string): boolean {
  return /\b(create|add|new|start)\b/i.test(text) && /\b(client|site|shift)\b/i.test(text)
}

function buildClarificationQuestion(missingFields: string[], siteAddress: string | null): string {
  if (missingFields.includes('start_time')) {
    return `What time should the guard start${siteAddress ? ` at ${siteAddress}` : ''}?`
  }

  if (missingFields.includes('client_name')) {
    return 'What is the client name for this new setup?'
  }

  if (missingFields.includes('site_address')) {
    return 'What is the site address for this shift?'
  }

  return 'Please provide the missing details so I can complete this task.'
}

export function extractBobVoiceStateFromAssistant(text: string): BobVoiceStatePayload | null {
  const normalized = normalizeText(text)
  if (!normalized) return null

  if (normalized.includes('opened the assessment for you') || normalized.includes('open the smoke assessment')) {
    return {
      target: 'smoke_assessment',
      phrase: text,
      source: 'assistant',
      at: new Date().toISOString(),
    }
  }

  if (normalized.includes('opened the scanner for you') || normalized.includes('open alpr') || normalized.includes('open the alpr scanner')) {
    return {
      target: 'alpr_scanner',
      phrase: text,
      source: 'assistant',
      at: new Date().toISOString(),
    }
  }

  return null
}

export function publishBobVoiceState(payload: BobVoiceStatePayload): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(VOICE_EVENT, { detail: payload }))
}

export function subscribeBobVoiceState(listener: (payload: BobVoiceStatePayload) => void): () => void {
  if (typeof window === 'undefined') return () => undefined

  const handler = (event: Event) => {
    const custom = event as CustomEvent<BobVoiceStatePayload>
    if (custom.detail) listener(custom.detail)
  }

  window.addEventListener(VOICE_EVENT, handler)
  return () => window.removeEventListener(VOICE_EVENT, handler)
}

export async function loadBobUserMemory(userId: string): Promise<BobUserMemoryRow[]> {
  if (!userId) return []

  const { data, error } = await sb
    .from('bob_user_memory')
    .select('user_id, context_key, context_value, last_interaction')
    .eq('user_id', userId)
    .order('last_interaction', { ascending: false })
    .limit(30)

  if (error) return []
  return (data || []) as BobUserMemoryRow[]
}

export async function upsertBobUserMemory(userId: string, contextKey: string, contextValue: string): Promise<void> {
  if (!userId || !contextKey || !contextValue) return

  await sb
    .from('bob_user_memory')
    .upsert({
      user_id: userId,
      context_key: contextKey,
      context_value: contextValue,
      last_interaction: new Date().toISOString(),
    }, { onConflict: 'user_id,context_key' })
}

export function buildBobUserMemoryNote(memoryRows: BobUserMemoryRow[]): string {
  if (!memoryRows.length) return ''

  const preferredSites = memoryRows.filter((row) => row.context_key.startsWith('preferred_site')).map((row) => row.context_value)
  const commonPhrases = memoryRows.filter((row) => row.context_key.startsWith('common_phrase')).map((row) => row.context_value)
  const pastShiftTypes = memoryRows.filter((row) => row.context_key.startsWith('past_shift_type')).map((row) => row.context_value)

  const lines: string[] = []
  if (preferredSites.length) lines.push(`Preferred sites: ${preferredSites.slice(0, 5).join(', ')}`)
  if (commonPhrases.length) lines.push(`Common phrases: ${commonPhrases.slice(0, 5).join(', ')}`)
  if (pastShiftTypes.length) lines.push(`Past shift types: ${pastShiftTypes.slice(0, 5).join(', ')}`)
  return lines.join(' | ')
}

async function detectShiftConflicts(params: {
  organizationId: string
  siteId: string
  shiftDate: string
  startTime: string
  endTime: string | null
}): Promise<string[]> {
  const warnings: string[] = []

  const { data: shifts, error: shiftError } = await sb
    .from('roster_shifts')
    .select('id, start_time, end_time, status, has_conflict')
    .eq('organization_id', params.organizationId)
    .eq('client_site_id', params.siteId)
    .eq('shift_date', params.shiftDate)
    .neq('status', 'cancelled')

  if (!shiftError && Array.isArray(shifts)) {
    const nextStart = params.startTime
    const nextEnd = params.endTime || '23:59:59'

    const hasOverlap = shifts.some((shift) => {
      const existingStart = String(shift.start_time || '00:00:00')
      const existingEnd = String(shift.end_time || '23:59:59')
      return existingStart < nextEnd && nextStart < existingEnd
    })

    if (hasOverlap) {
      warnings.push('Potential roster overlap detected for this site and date.')
    }
  }

  const dayStart = `${params.shiftDate}T00:00:00`
  const dayEnd = `${params.shiftDate}T23:59:59`

  const { data: observations, error: observationsError } = await sb
    .from('observations')
    .select('id')
    .eq('organization_id', params.organizationId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .limit(1)

  if (!observationsError && Array.isArray(observations) && observations.length > 0) {
    warnings.push('Recent observations exist for this date; review active compliance events before dispatching.')
  }

  return warnings
}

export async function executeAdministrativeActuation(params: {
  text: string
  organizationId: string | null
  actorUserId: string | null
  emergencyPriorityActive: boolean
  executionMode: BobExecutionMode
}): Promise<BobActuationResult | null> {
  const text = String(params.text || '').trim()
  if (!shouldActuate(text)) return null

  if (!params.organizationId || !params.actorUserId) {
    return {
      status: 'blocked',
      reason: 'Missing organization or user context for secure actuation.',
    }
  }

  const mutationAccess = assertBobMutationAccess('create_client_site_shift_bundle', params.executionMode)
  if (!mutationAccess.allowed) {
    return {
      status: 'blocked',
      reason: `Administrative provisioning blocked by governance contract: ${mutationAccess.reason}`,
    }
  }

  if (params.emergencyPriorityActive) {
    return {
      status: 'blocked',
      reason: 'Armed Danger Auto-Assist is active. Emergency workflow takes priority over administrative provisioning.',
    }
  }

  const clientName = extractClientName(text)
  const siteAddress = extractSiteAddress(text)
  const shiftIntent = parseShiftIntent(text)

  const missingFields: string[] = []
  if (!clientName) missingFields.push('client_name')
  if (!siteAddress) missingFields.push('site_address')
  if (!shiftIntent.startTime) missingFields.push('start_time')

  if (missingFields.length > 0) {
    return {
      status: 'needs_clarification',
      question: buildClarificationQuestion(missingFields, siteAddress),
      missingFields,
    }
  }

  const livingWage = Number.isFinite(GLOBAL_LIVING_WAGE_NZD) ? GLOBAL_LIVING_WAGE_NZD : 27.8

  const { data: createdClient, error: clientError } = await sb
    .from('clients')
    .insert({
      organization_id: params.organizationId,
      name: clientName,
      address: siteAddress,
      created_by: params.actorUserId,
    })
    .select('id')
    .single()

  if (clientError || !createdClient?.id) {
    return {
      status: 'blocked',
      reason: `Client provisioning failed: ${clientError?.message || 'Unknown error'}`,
    }
  }

  const { data: createdSite, error: siteError } = await sb
    .from('client_sites')
    .insert({
      organization_id: params.organizationId,
      name: `${clientName} Site`,
      address: siteAddress,
      site_type: 'guarding',
      default_pay_rate: livingWage,
      created_by: params.actorUserId,
    })
    .select('id')
    .single()

  if (siteError || !createdSite?.id) {
    return {
      status: 'blocked',
      reason: `Site provisioning failed: ${siteError?.message || 'Unknown error'}`,
    }
  }

  const shiftDate = shiftIntent.shiftDate || new Date().toISOString().slice(0, 10)
  const warnings = await detectShiftConflicts({
    organizationId: params.organizationId,
    siteId: createdSite.id,
    shiftDate,
    startTime: shiftIntent.startTime,
    endTime: shiftIntent.endTime,
  })

  if (warnings.some((warning) => warning.toLowerCase().includes('overlap'))) {
    return {
      status: 'needs_clarification',
      question: `I found a possible overlap for ${siteAddress}. Do you want to proceed with this shift time anyway?`,
      missingFields: ['overlap_confirmation'],
    }
  }

  const { data: createdShift, error: shiftError } = await sb
    .from('roster_shifts')
    .insert({
      organization_id: params.organizationId,
      client_site_id: createdSite.id,
      shift_date: shiftDate,
      start_time: shiftIntent.startTime,
      end_time: shiftIntent.endTime,
      shift_type: shiftIntent.shiftType,
      guard_cost_rate: livingWage,
      client_charge_rate: livingWage * 1.35,
      created_by: params.actorUserId,
      status: 'published',
    })
    .select('id')
    .single()

  if (shiftError || !createdShift?.id) {
    return {
      status: 'blocked',
      reason: `Shift provisioning failed: ${shiftError?.message || 'Unknown error'}`,
    }
  }

  await Promise.all([
    upsertBobUserMemory(params.actorUserId, 'preferred_site_latest', siteAddress),
    upsertBobUserMemory(params.actorUserId, 'past_shift_type_latest', shiftIntent.shiftType),
    upsertBobUserMemory(params.actorUserId, 'common_phrase_latest', text.slice(0, 160)),
  ])

  return {
    status: 'success',
    summary: `Provisioned client ${clientName}, site ${siteAddress}, and shift on ${shiftDate} starting ${shiftIntent.startTime}.`,
    created: {
      clientId: createdClient.id,
      siteId: createdSite.id,
      shiftId: createdShift.id,
    },
    computedLivingWage: livingWage,
    warnings,
  }
}
