export type BobCommandIntent =
  | 'navigate'
  | 'open_workflow'
  | 'run_diagnostics'
  | 'generate_plan'
  | 'create_record'
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
  { re: /\b(go to|open|navigate to)\s+incidents?\b/i, route: '/incidents' },
  { re: /\b(go to|open|navigate to)\s+(patrol|patrols)\b/i, route: '/patrols' },
  { re: /\b(go to|open|navigate to)\s+vehicles?\b/i, route: '/vehicles' },
  { re: /\b(go to|open|navigate to)\s+breaches?\b/i, route: '/breach-management' },
  { re: /\b(go to|open|navigate to)\s+(reports?|reporting)\b/i, route: '/reports' },
  { re: /\b(go to|open|navigate to)\s+(zones?|geofence)\b/i, route: '/geofences' },
  { re: /\b(go to|open|navigate to)\s+(officers?|roster|staff)\b/i, route: '/officer-management' },
  { re: /\b(go to|open|navigate to)\s+(grandmaster|grand\s*master|coding\s*studio)\b/i, route: '/grandmaster-studio' },
  { re: /\b(go to|open|navigate to)\s+(data\s*hub|data\s*management)\b/i, route: '/data-management' },
  { re: /\b(go to|open|navigate to)\s+(settings?|admin\s*settings?)\b/i, route: '/settings' },
]

const CREATE_RECORD_PATTERNS: Array<{ re: RegExp; recordType: string; safety: 'safe' | 'review' }> = [
  { re: /\b(create|log|add|new)\s+(observation|obs)\b/i, recordType: 'observation', safety: 'safe' },
  { re: /\b(create|log|add|raise)\s+(breach|breach\s*alert)\b/i, recordType: 'breach', safety: 'review' },
  { re: /\b(create|log|add|raise)\s+(incident|incident\s*report)\b/i, recordType: 'incident', safety: 'review' },
  { re: /\b(start|begin|create)\s+(patrol|patrol\s*session)\b/i, recordType: 'patrol', safety: 'safe' },
  { re: /\b(create|raise|submit)\s+(welfare|welfare\s*check)\b/i, recordType: 'welfare_check', safety: 'review' },
  { re: /\b(assign|create)\s+(task|work\s*order)\b/i, recordType: 'task', safety: 'safe' },
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

  for (const item of CREATE_RECORD_PATTERNS) {
    if (item.re.test(rawText)) {
      return {
        rawText,
        normalizedText,
        intent: 'create_record',
        confidence: 0.85,
        safety: item.safety,
        args: { recordType: item.recordType },
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
