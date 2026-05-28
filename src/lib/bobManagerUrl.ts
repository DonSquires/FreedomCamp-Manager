function normalizeUrl(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '')
}

export function getBobManagerUrl(): string | null {
  const envUrl = normalizeUrl(import.meta.env.VITE_BOB_MANAGER_URL || '')
  if (envUrl) return envUrl

  if (typeof window !== 'undefined' && window.location?.origin) {
    return normalizeUrl(window.location.origin)
  }

  return null
}
