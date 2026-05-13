import { describe, expect, it } from 'vitest'
import {
  formatEmergencyGpsBroadcast,
  getActiveEmergencyAlert,
  isEmergencyWelfareAlert,
} from '@/lib/phase4Emergency'

describe('phase4Emergency helpers', () => {
  it('detects emergency welfare alert keywords', () => {
    expect(isEmergencyWelfareAlert('sos')).toBe(true)
    expect(isEmergencyWelfareAlert('armed_danger')).toBe(true)
    expect(isEmergencyWelfareAlert('panic_button')).toBe(true)
    expect(isEmergencyWelfareAlert('routine_checkin')).toBe(false)
  })

  it('returns first active emergency alert from list', () => {
    const alerts = [
      { id: '1', alert_type: 'routine_checkin' },
      { id: '2', alert_type: 'armed_danger' },
      { id: '3', alert_type: 'sos' },
    ]

    expect(getActiveEmergencyAlert(alerts)).toEqual(alerts[1])
  })

  it('formats emergency GPS broadcast text', () => {
    expect(
      formatEmergencyGpsBroadcast({ officer_name: 'Jane Doe', gps_latitude: -41.27123, gps_longitude: 173.28456 })
    ).toBe('Emergency channel broadcast active: Jane Doe GPS (-41.27123, 173.28456)')

    expect(formatEmergencyGpsBroadcast({ officer_name: 'Jane Doe' })).toBe(
      'Emergency channel broadcast active: Jane Doe GPS unavailable'
    )
  })
})
