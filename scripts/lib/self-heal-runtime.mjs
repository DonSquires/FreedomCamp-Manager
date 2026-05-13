import fs from 'node:fs/promises'
import path from 'node:path'

function asFiniteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function sanitizeError(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  return String(error.message || error)
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export async function writeJsonFileAtomic(filePath, payload) {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.rename(tmpPath, filePath)
}

export async function appendJsonl(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

export async function withFileLock(lockPath, options, runner) {
  const staleMs = Math.max(5_000, asFiniteNumber(options?.staleMs, 10 * 60 * 1000))
  const retries = Math.max(0, asFiniteNumber(options?.retries, 2))
  const retryDelayMs = Math.max(200, asFiniteNumber(options?.retryDelayMs, 600))

  let attempts = 0
  while (true) {
    attempts += 1
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true })
      const handle = await fs.open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }))

      try {
        return await runner({ attempts })
      } finally {
        await handle.close().catch(() => {})
        await fs.rm(lockPath, { force: true }).catch(() => {})
      }
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : ''
      if (code !== 'EEXIST') {
        throw error
      }

      const stats = await fs.stat(lockPath).catch(() => null)
      const lockIsStale = !!stats && (Date.now() - stats.mtimeMs) > staleMs
      if (lockIsStale) {
        await fs.rm(lockPath, { force: true }).catch(() => {})
        continue
      }

      if (attempts > retries) {
        const lockError = new Error(`Lock busy: ${lockPath}`)
        lockError.code = 'ELOCKED'
        throw lockError
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempts))
    }
  }
}

export async function fetchJsonWithRetry(url, options = {}) {
  const retries = Math.max(0, asFiniteNumber(options.retries, 2))
  const timeoutMs = Math.max(1_000, asFiniteNumber(options.timeoutMs, 12_000))
  const baseBackoffMs = Math.max(100, asFiniteNumber(options.baseBackoffMs, 400))
  const maxBackoffMs = Math.max(baseBackoffMs, asFiniteNumber(options.maxBackoffMs, 3_000))

  let attempt = 0
  let lastError = null
  let lastResponse = null

  while (attempt <= retries) {
    attempt += 1
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const startedAt = Date.now()
    try {
      const resp = await fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        signal: controller.signal,
      })
      const text = await resp.text()
      let json = null
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }

      const durationMs = Date.now() - startedAt
      const record = {
        ok: resp.ok,
        status: resp.status,
        text,
        json,
        duration_ms: durationMs,
        attempt,
      }

      if (resp.ok) {
        clearTimeout(timeout)
        return record
      }

      lastResponse = record
      const retryableStatus = resp.status >= 500 || resp.status === 429
      if (!retryableStatus || attempt > retries) {
        clearTimeout(timeout)
        return record
      }
    } catch (error) {
      lastError = error
      if (attempt > retries) {
        clearTimeout(timeout)
        break
      }
    } finally {
      clearTimeout(timeout)
    }

    const backoff = Math.min(maxBackoffMs, baseBackoffMs * (2 ** (attempt - 1)))
    const jitter = Math.floor(Math.random() * 120)
    await new Promise((resolve) => setTimeout(resolve, backoff + jitter))
  }

  if (lastResponse) {
    return lastResponse
  }

  return {
    ok: false,
    status: 0,
    text: sanitizeError(lastError),
    json: null,
    duration_ms: 0,
    attempt: attempt,
    error: sanitizeError(lastError),
  }
}
