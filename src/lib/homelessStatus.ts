export type HomelessStatus = 'confirmed' | 'claimed' | 'suspected' | 'declined' | 'freedom_camper'

export const HOMELESS_UI_STATUSES: HomelessStatus[] = ['confirmed', 'claimed', 'suspected', 'declined']

export function normalizeHomelessStatus(status: string | null | undefined): HomelessStatus {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (normalized === 'confirmed') return 'confirmed'
  if (normalized === 'claimed') return 'claimed'
  if (normalized === 'suspected' || normalized === 'likely') return 'suspected'
  if (normalized === 'declined') return 'declined'
  if (normalized === 'not_homeless' || normalized === 'none' || normalized === 'not homeless') {
    return 'freedom_camper'
  }
  return 'freedom_camper'
}

export function isHomelessForUi(status: string | null | undefined): boolean {
  return HOMELESS_UI_STATUSES.includes(normalizeHomelessStatus(status))
}

export function homelessStatusLabel(status: string | null | undefined): string {
  const normalized = normalizeHomelessStatus(status)
  if (normalized === 'confirmed') return 'Confirmed - FC Act exempt'
  if (normalized === 'claimed') return 'Claimed - pending review'
  if (normalized === 'suspected') return 'Suspected - pending review'
  if (normalized === 'declined') return 'Declined - not exempt'
  return 'Freedom camper - not exempt'
}