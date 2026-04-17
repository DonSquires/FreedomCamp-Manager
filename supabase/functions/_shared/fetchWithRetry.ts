const DEFAULT_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: {
    retries?: number
    timeoutMs?: number
    retryableStatuses?: Iterable<number>
    backoffMs?: number
  } = {},
): Promise<Response> {
  const retries = Math.max(0, options.retries ?? 1)
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0)
  const retryableStatuses = new Set(options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES)
  const backoffMs = Math.max(0, options.backoffMs ?? 400)

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = timeoutMs > 0 ? new AbortController() : null
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller?.signal,
      })

      if (!retryableStatuses.has(response.status) || attempt === retries) {
        if (timeoutId) clearTimeout(timeoutId)
        return response
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === retries) {
        if (timeoutId) clearTimeout(timeoutId)
        throw lastError
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }

    await wait(backoffMs * (attempt + 1))
  }

  throw lastError ?? new Error('Request failed after retries')
}