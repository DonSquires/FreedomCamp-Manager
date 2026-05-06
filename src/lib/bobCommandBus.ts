export type BobCommandIntent =
  | 'navigate'
  | 'open_workflow'
  | 'run_diagnostics'
  | 'generate_plan'
  | 'unknown'

export type BobCommandSafety = 'safe' | 'review' | 'restricted'

export interface BobCommand {
  rawText: string
  normalizedText: string
  intent: BobCommandIntent
  confidence: number
  safety: BobCommandSafety
  args: Record<string, string>
  matchedPattern: string | null
}

export interface BobCommandContext {
  role: string
  orgId: string | null
  route: string
}

export interface BobCommandPolicyResult {
  allowed: boolean
  requiresApproval: boolean
  reason: string
}

function normalize(text: string): string {
  return text.trim().toLowerCase()
}

const HIGH_RISK_RE = /\b(delete|drop\s+table|truncate|wipe|purge|disable\s+rls|bypass\s+auth|reset\s+prod)\b/i

const NAV_PATTERNS: Array<{ re: RegExp; route: string }> = [
  { re: /\b(go to|open|navigate to)\s+bob\s+assistant\b/i, route: '/bob-assistant' },
  { re: /\b(go to|open|navigate to)\s+bob\s+studio\b/i, route: '/bob-studio' },
  { re: /\b(go to|open|navigate to)\s+dispatch\b/i, route: '/dispatch-monitor' },
  { re: /\b(go to|open|navigate to)\s+compliance\b/i, route: '/compliance-escalations' },
]

export function classifyBobCommand(rawText: string): BobCommand {
  const normalizedText = normalize(rawText)

  if (!normalizedText) {
    return {
      rawText,
      normalizedText,
      intent: 'unknown',
      confidence: 0,
      safety: 'safe',
      args: {},
      matchedPattern: null,
    }
  }

  if (HIGH_RISK_RE.test(normalizedText)) {
    return {
      rawText,
      normalizedText,
      intent: 'open_workflow',
      confidence: 0.75,
      safety: 'restricted',
      args: {},
      matchedPattern: 'high-risk-keyword',
    }
  }

  for (const item of NAV_PATTERNS) {
    if (item.re.test(rawText)) {
      return {
        rawText,
        normalizedText,
        intent: 'navigate',
        confidence: 0.9,
        safety: 'safe',
        args: { route: item.route },
        matchedPattern: item.re.source,
      }
    }
  }

  if (/\b(run|execute|start)\s+(health|diagnostic|diagnostics|doctor|self\s*test)\b/i.test(rawText)) {
    return {
      rawText,
      normalizedText,
      intent: 'run_diagnostics',
      confidence: 0.78,
      safety: 'review',
      args: { scope: 'bob-health' },
      matchedPattern: 'diagnostics',
    }
  }

  if (/\b(create|generate|draft)\s+(plan|sop|risk assessment|evacuation plan|assignment)\b/i.test(rawText)) {
    return {
      rawText,
      normalizedText,
      intent: 'generate_plan',
      confidence: 0.8,
      safety: 'review',
      args: { target: 'planning-workspace' },
      matchedPattern: 'plan-generation',
    }
  }

  return {
    rawText,
    normalizedText,
    intent: 'unknown',
    confidence: 0.35,
    safety: 'safe',
    args: {},
    matchedPattern: null,
  }
}

export function evaluateBobCommandPolicy(command: BobCommand, context: BobCommandContext): BobCommandPolicyResult {
  if (command.intent === 'unknown') {
    return { allowed: true, requiresApproval: false, reason: 'No executable command detected.' }
  }

  if (command.safety === 'restricted') {
    const isGrandMaster = String(context.role).toLowerCase() === 'grand_master'
    if (!isGrandMaster) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: 'Restricted command requires Grand Master approval.',
      }
    }
    return {
      allowed: true,
      requiresApproval: true,
      reason: 'Restricted command accepted under Grand Master policy.',
    }
  }

  if (command.safety === 'review') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: 'Command requires confirmation before execution.',
    }
  }

  return {
    allowed: true,
    requiresApproval: false,
    reason: 'Command allowed for execution.',
  }
}
