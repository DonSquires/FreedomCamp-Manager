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
