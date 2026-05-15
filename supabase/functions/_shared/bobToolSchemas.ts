export const BOB_ALLOWED_ROUTES = ['/dashboard', '/billing', '/analytics', '/settings'] as const

export type NavigateAppToolCall = {
  name: 'navigateApp'
  args: {
    targetRoute: (typeof BOB_ALLOWED_ROUTES)[number]
  }
}

export type UpdateDataFieldToolCall = {
  name: 'updateDataField'
  args: {
    fieldName: string
    fieldValue: unknown
  }
}

export type BobOperationalToolCall = NavigateAppToolCall | UpdateDataFieldToolCall

export type ToolValidationResult =
  | { ok: true; value: BobOperationalToolCall }
  | { ok: false; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateOperationalToolCall(raw: unknown): ToolValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Tool call payload must be an object.' }
  }

  const name = String(raw.name || '').trim()
  const args = raw.args

  if (!isPlainObject(args)) {
    return { ok: false, error: 'Tool call args must be an object.' }
  }

  if (name === 'navigateApp') {
    const targetRoute = String(args.targetRoute || '').trim()
    if (!BOB_ALLOWED_ROUTES.includes(targetRoute as (typeof BOB_ALLOWED_ROUTES)[number])) {
      return {
        ok: false,
        error: `navigateApp targetRoute must be one of: ${BOB_ALLOWED_ROUTES.join(', ')}`,
      }
    }

    return {
      ok: true,
      value: {
        name: 'navigateApp',
        args: { targetRoute: targetRoute as (typeof BOB_ALLOWED_ROUTES)[number] },
      },
    }
  }

  if (name === 'updateDataField') {
    const fieldName = String(args.fieldName || '').trim()
    if (!fieldName || fieldName.length > 64) {
      return { ok: false, error: 'updateDataField fieldName must be 1-64 chars.' }
    }

    return {
      ok: true,
      value: {
        name: 'updateDataField',
        args: {
          fieldName,
          fieldValue: (args as Record<string, unknown>).fieldValue,
        },
      },
    }
  }

  return { ok: false, error: `Unsupported tool name: ${name || 'unknown'}` }
}

export function enforceExecutionStepLimit(toolStepsExecuted: unknown, maxSteps = 5): { allowed: boolean; reason: string; steps: number } {
  const parsed = Number(toolStepsExecuted)
  const steps = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0

  if (steps >= maxSteps) {
    return {
      allowed: false,
      reason: `Execution loop cap reached (${steps}/${maxSteps}). User confirmation required to continue.`,
      steps,
    }
  }

  return {
    allowed: true,
    reason: `Execution within step limit (${steps}/${maxSteps}).`,
    steps,
  }
}

export function classifyIntentBucket(input: string): 'operational' | 'conversational' {
  const text = String(input || '').toLowerCase()
  const operationalMarkers = [
    'navigate',
    'go to',
    'open',
    'update',
    'change',
    'set',
    'run',
    'execute',
    'create',
    'delete',
    'report',
    'extract',
  ]

  return operationalMarkers.some((marker) => text.includes(marker))
    ? 'operational'
    : 'conversational'
}
