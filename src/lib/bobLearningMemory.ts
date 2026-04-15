import { supabase } from '@/lib/supabase'

export interface BobLearningEntry {
  id: string
  userId: string
  route: string
  source: string
  topic: string
  tags: string[]
  userIntent: string
  assistantOutcome: string
  createdAt: string
  lastUsedAt: string
  useCount: number
}

interface LearnFromExchangeInput {
  userId: string
  route?: string
  source?: string
  userMessage: string
  assistantReply: string
}

const STORAGE_KEY = 'bob-learning-memory-v1'
const MAX_ENTRIES = 160

function canUseLocalStorage() {
  return typeof window !== 'undefined' && !!window.localStorage
}

function truncate(value: string, max: number) {
  if (!value) return ''
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function inferTags(text: string) {
  const lowered = text.toLowerCase()
  const rules: Array<[string, string[]]> = [
    ['compliance', ['compliance', 'breach', 'infringement', 'vacate', 'warning', 'zone rules']],
    ['patrol', ['patrol', 'shift', 'officer welfare', 'roster', 'gps']],
    ['chat-ops', ['team chat', 'ptt', 'radio', 'dispatch']],
    ['ai', ['ai', 'bob', 'prompt', 'model', 'inference']],
    ['privacy', ['privacy', 'personal data', 'consent', 'permission', 'audit']],
    ['integration', ['railway', 'supabase', 'edge function', 'api key', 'env']],
    ['schema', ['table', 'migration', 'rpc', 'rls', 'schema']],
    ['frontend', ['react', 'route', 'portal', 'component', 'hook']],
  ]

  const tags: string[] = []
  for (const [tag, keywords] of rules) {
    if (keywords.some((kw) => lowered.includes(kw))) tags.push(tag)
  }
  return tags.length ? tags : ['general']
}

function inferTopic(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return 'General operational support'
  return truncate(compact, 90)
}

function readAll() {
  if (!canUseLocalStorage()) return [] as BobLearningEntry[]
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as BobLearningEntry[]) : []
  } catch {
    return []
  }
}

function writeAll(entries: BobLearningEntry[]) {
  if (!canUseLocalStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

export function learnFromBobExchange(input: LearnFromExchangeInput) {
  const now = new Date().toISOString()
  const userIntent = truncate(input.userMessage.replace(/\s+/g, ' ').trim(), 240)
  const assistantOutcome = truncate(input.assistantReply.replace(/\s+/g, ' ').trim(), 300)
  if (!userIntent || !assistantOutcome) return null

  const combined = `${userIntent} ${assistantOutcome}`
  const tags = inferTags(combined)
  const topic = inferTopic(userIntent)

  const entries = readAll()
  const existingIdx = entries.findIndex((e) =>
    e.userId === input.userId &&
    e.topic.toLowerCase() === topic.toLowerCase() &&
    e.tags.some((tag) => tags.includes(tag)),
  )

  if (existingIdx >= 0) {
    const existing = entries[existingIdx]
    entries[existingIdx] = {
      ...existing,
      route: input.route ?? existing.route,
      source: input.source ?? existing.source,
      tags: Array.from(new Set([...existing.tags, ...tags])),
      userIntent,
      assistantOutcome,
      lastUsedAt: now,
      useCount: (existing.useCount ?? 1) + 1,
    }
    writeAll(entries.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt)))
    return entries[existingIdx]
  }

  const entry: BobLearningEntry = {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userId: input.userId,
    route: input.route ?? '/bob-assistant',
    source: input.source ?? 'bob-studio',
    topic,
    tags,
    userIntent,
    assistantOutcome,
    createdAt: now,
    lastUsedAt: now,
    useCount: 1,
  }

  entries.unshift(entry)
  writeAll(entries.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt)))
  return entry
}

export function buildBobLearningContext(userId: string, maxEntries = 24) {
  const entries = readAll()
    .filter((e) => e.userId === userId)
    .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt))
    .slice(0, maxEntries)

  if (!entries.length) return ''

  return [
    'Long-term memory from prior conversations. Reuse these lessons and remain consistent:',
    ...entries.map((entry, index) =>
      `${index + 1}. Topic: ${entry.topic} | Tags: ${entry.tags.join(', ')} | Prior user intent: ${entry.userIntent} | Prior Bob outcome: ${entry.assistantOutcome}`,
    ),
  ].join('\n')
}

export function clearBobLearningMemory(userId?: string) {
  if (!userId) {
    writeAll([])
    return
  }
  const entries = readAll().filter((e) => e.userId !== userId)
  writeAll(entries)
}

interface PersistRemoteLearningInput {
  userId: string
  organizationId?: string | null
  route?: string
  source?: string
  userMessage: string
  assistantReply: string
}

interface PersistConversationTurnRemoteInput {
  userId: string
  organizationId?: string | null
  route?: string
  source?: string
  userMessage: string
  assistantReply: string
  currentRoute?: string
  destinationHint?: string
}

export async function persistBobLearningRemote(input: PersistRemoteLearningInput) {
  try {
    const localEntry = learnFromBobExchange({
      userId: input.userId,
      route: input.route,
      source: input.source,
      userMessage: input.userMessage,
      assistantReply: input.assistantReply,
    })

    if (!localEntry) return

    const payload = {
      user_id: input.userId,
      organization_id: input.organizationId ?? null,
      route: localEntry.route,
      source: localEntry.source,
      topic: localEntry.topic,
      tags: localEntry.tags,
      user_intent: localEntry.userIntent,
      assistant_outcome: localEntry.assistantOutcome,
      use_count: localEntry.useCount,
      last_used_at: localEntry.lastUsedAt,
    }

    // Try to merge with a recent entry of same user/topic to avoid noisy growth.
    const { data: existingRows } = await ((supabase as any).from('bob_learning_memory') as any)
      .select('id, use_count')
      .eq('user_id', input.userId)
      .eq('topic', localEntry.topic)
      .order('last_used_at', { ascending: false })
      .limit(1)

    const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null

    if (existing?.id) {
      await (((supabase as any).from('bob_learning_memory') as any)
        .update({
          ...payload,
          use_count: Math.max(Number(existing.use_count ?? 0) + 1, localEntry.useCount),
        })
        .eq('id', existing.id))
      return
    }

    await (((supabase as any).from('bob_learning_memory') as any).insert(payload))
  } catch {
    // Keep local memory functional even if remote table/migration is not available yet.
  }
}

export async function buildBobLearningContextRemote(userId: string, maxEntries = 20) {
  try {
    const { data, error } = await ((supabase as any).from('bob_learning_memory') as any)
      .select('topic, tags, user_intent, assistant_outcome, last_used_at')
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false })
      .limit(maxEntries)

    if (error || !Array.isArray(data) || data.length === 0) return ''

    return [
      'Long-term memory synced from secure server history. Use these prior lessons for continuity:',
      ...data.map((row: any, index: number) =>
        `${index + 1}. Topic: ${row.topic} | Tags: ${(row.tags ?? []).join(', ')} | Prior user intent: ${row.user_intent} | Prior Bob outcome: ${row.assistant_outcome}`,
      ),
    ].join('\n')
  } catch {
    return ''
  }
}

export async function persistConversationTurnRemote(input: PersistConversationTurnRemoteInput) {
  try {
    const now = new Date().toISOString()
    const route = input.route ?? '/bob-assistant'
    const source = input.source ?? 'bob-studio'
    const context = {
      app_route: input.currentRoute ?? route,
      destination_hint: input.destinationHint ?? null,
    }

    const rows = [
      {
        user_id: input.userId,
        organization_id: input.organizationId ?? null,
        role: 'user',
        message: truncate(input.userMessage.replace(/\s+/g, ' ').trim(), 1200),
        route,
        source,
        context,
        created_at: now,
      },
      {
        user_id: input.userId,
        organization_id: input.organizationId ?? null,
        role: 'assistant',
        message: truncate(input.assistantReply.replace(/\s+/g, ' ').trim(), 1400),
        route,
        source,
        context,
        created_at: now,
      },
    ]

    await (((supabase as any).from('bob_conversation_memory') as any).insert(rows))
  } catch {
    // Keep assistant functional if migration is not applied yet.
  }
}

export async function buildConversationContinuationContextRemote(userId: string, maxMessages = 16) {
  try {
    const { data, error } = await ((supabase as any).from('bob_conversation_memory') as any)
      .select('role, message, route, source, context, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(maxMessages)

    if (error || !Array.isArray(data) || data.length === 0) return ''

    const ordered = [...data].reverse()
    const turns = ordered
      .map((row: any, idx: number) => {
        const role = row?.role === 'assistant' ? 'Bob' : 'User'
        const message = String(row?.message ?? '').trim()
        if (!message) return ''
        return `${idx + 1}. ${role}: ${message}`
      })
      .filter(Boolean)

    if (!turns.length) return ''

    const latest = ordered[ordered.length - 1] as any
    const lastRoute = latest?.context?.app_route || latest?.route || '/bob-assistant'
    const destinationHint = latest?.context?.destination_hint ? String(latest.context.destination_hint) : ''

    return [
      'Conversation continuity memory from previous sessions. Continue naturally from this context:',
      `Last known app route: ${lastRoute}`,
      ...(destinationHint ? [`Last known destination context: ${destinationHint}`] : []),
      ...turns,
    ].join('\n')
  } catch {
    return ''
  }
}
