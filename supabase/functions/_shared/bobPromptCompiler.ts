export type BobMessage = {
  role: string
  content: string
}

export type BobPromptCompilerInput = {
  basePrompt: string
  authoritativePolicyBlock: string
  userPayload: string
  sessionHistory?: BobMessage[]
  vectorMemories?: Array<string | { content?: string; summary?: string }>
}

const COMMUNICATION_ARCHITECTURE_BLOCK = [
  'COMMUNICATION ARCHITECTURE:',
  '- Max information density: prioritize direct, actionable facts.',
  '- No conversational preambles before core solution content.',
  '- Prefer scannable bullets and compact structure over dense paragraphs.',
  '- Keep response lines concise and high-signal.',
  '- End with two concrete next-step options when markdown is available.',
].join('\n')

const AUTONOMOUS_ACTION_PROTOCOL_BLOCK = [
  'AUTONOMOUS ACTION PROTOCOL:',
  '- Classify user input as conversational inquiry or operational command.',
  '- For operational commands, prefer structured tool intent representation.',
  '- For multi-step operations, process step-by-step with result-aware sequencing.',
].join('\n')

const NATURAL_LANGUAGE_EXECUTION_BLOCK = [
  'NATURAL LANGUAGE EXECUTION:',
  '- Treat plain-speaking user requests as valid instructions, not noise.',
  '- Infer likely intent and required parameters from everyday wording.',
  '- If critical details are missing, ask one concise clarifying question before acting.',
  '- Follow explicit user instructions exactly unless blocked by policy or safety constraints.',
].join('\n')

const OPERATIONAL_DEFAULTS_BLOCK = [
  'OPERATIONAL DEFAULTS:',
  '- If the user asks for patrol actions, provide concrete field actions first.',
  '- Do not switch to engineering/code-review framing unless the user explicitly asks for code or architecture review.',
  '- Keep action plans specific, local, and immediately executable.',
].join('\n')

const STYLE_GUARDRAILS_BLOCK = [
  'STYLE GUARDRAILS:',
  '- Avoid headings like "Review Findings" or "Assessment" for normal patrol guidance.',
  '- Use plain operational wording that sounds like a field supervisor briefing.',
  '- Prioritize direct action statements over meta analysis language.',
].join('\n')

const RESILIENCE_AND_SAFETY_BLOCK = [
  'RESILIENCE AND SAFETY:',
  '- On tool failure, do not repeat the same request blindly.',
  '- Analyze error payload and choose an alternate path or report blocker.',
  '- Enforce a maximum of 5 sequential tool steps per request.',
  '- Require strict server-side input validation before mutation actions.',
].join('\n')

function pickHistoryContext(history: BobMessage[]): string {
  if (!Array.isArray(history) || history.length === 0) return 'none'

  return history
    .filter((entry) => entry?.role === 'user' || entry?.role === 'assistant')
    .slice(-6)
    .map((entry) => `${entry.role}: ${String(entry.content || '').slice(0, 240)}`)
    .join('\n')
}

function pickVectorMemoryContext(entries: BobPromptCompilerInput['vectorMemories']): string {
  if (!Array.isArray(entries) || entries.length === 0) return 'none'

  return entries
    .slice(0, 4)
    .map((entry) => {
      if (typeof entry === 'string') return entry.slice(0, 220)
      return String(entry?.summary || entry?.content || '').slice(0, 220)
    })
    .filter(Boolean)
    .join('\n- ')
}

export function compileBobSystemInstructions(input: BobPromptCompilerInput): string {
  const basePrompt = String(input.basePrompt || '').trim()
  const policyBlock = String(input.authoritativePolicyBlock || '').trim()
  const userPayload = String(input.userPayload || '').trim()
  const historyContext = pickHistoryContext(input.sessionHistory || [])
  const memoryContext = pickVectorMemoryContext(input.vectorMemories || [])

  return [
    basePrompt,
    policyBlock,
    COMMUNICATION_ARCHITECTURE_BLOCK,
    AUTONOMOUS_ACTION_PROTOCOL_BLOCK,
    NATURAL_LANGUAGE_EXECUTION_BLOCK,
    OPERATIONAL_DEFAULTS_BLOCK,
    STYLE_GUARDRAILS_BLOCK,
    RESILIENCE_AND_SAFETY_BLOCK,
    'REQUEST CONTEXT:',
    `- Latest user payload: ${userPayload || 'none'}`,
    `- Recent session history:\n${historyContext}`,
    `- Memory context:\n- ${memoryContext}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
