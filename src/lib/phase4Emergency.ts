export interface WelfareAlertLike {
  alert_type?: string | null
  officer_name?: string | null
  gps_latitude?: number | null
  gps_longitude?: number | null
}

export function isEmergencyWelfareAlert(alertType: string | null | undefined): boolean {
  const type = String(alertType || '').toLowerCase()
  return type.includes('sos') || type.includes('armed') || type.includes('danger') || type.includes('panic')
}

export function getActiveEmergencyAlert<T extends WelfareAlertLike>(alerts: T[]): T | null {
  return alerts.find((alert) => isEmergencyWelfareAlert(alert?.alert_type)) || null
}

export function formatEmergencyGpsBroadcast(alert: WelfareAlertLike): string {
  const officer = alert.officer_name || 'Officer'
  const lat = Number(alert.gps_latitude)
  const lng = Number(alert.gps_longitude)

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `Emergency channel broadcast active: ${officer} GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`
  }

  return `Emergency channel broadcast active: ${officer} GPS unavailable`
}
