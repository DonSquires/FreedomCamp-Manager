interface BuildBobContextInput {
  operation: string
  source?: string
  userId?: string | null
  organizationId?: string | null
  context?: Record<string, unknown>
}

function isDefined(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

export function buildBobContext(input: BuildBobContextInput): Record<string, unknown> {
  const result: Record<string, unknown> = {
    operation: input.operation,
  }

  if (isDefined(input.source)) result.source = input.source
  if (isDefined(input.userId)) result.user_id = input.userId
  if (isDefined(input.organizationId)) result.organization_id = input.organizationId

  const extra = input.context ?? {}
  for (const [key, value] of Object.entries(extra)) {
    if (isDefined(value)) {
      result[key] = value
    }
  }

  return result
}
