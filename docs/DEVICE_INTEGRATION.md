# Bluetooth & Wireless Device Integration

## Overview

FieldOps Manager supports comprehensive integration with Bluetooth and wireless devices to enhance officer safety. This includes:

1. **Bluetooth Panic Buttons** — Dedicated BLE panic button devices
2. **Fall Detection** — Accelerometer-based fall detection using phone/smartwatch sensors
3. **Shake-to-Alert** — Rapid phone shake for discreet panic trigger
4. **External Cameras** — Body cam and wireless camera streaming
5. **Heart Rate Monitoring** — Smartwatch heart rate with anomaly detection

---

## Supported Devices

### Bluetooth Panic Buttons

The system supports any BLE (Bluetooth Low Energy) panic button device that:
- Advertises standard button services
- Sends a notification characteristic when pressed
- Optionally supports battery level reporting

**Recommended Devices:**
- Tile Pro (with custom firmware)
- SOS Beacon devices
- BLE keyfob buttons

### Smartwatches for Fall Detection

Fall detection works on any device with DeviceMotion API support:
- **iOS**: iPhone 8+ (with iOS 13+)
- **Android**: Most modern Android phones
- **Apple Watch**: Via companion app
- **Wear OS**: Via companion app

### Body Cameras

External camera streaming supports:
- USB webcams
- Bluetooth video devices (limited)
- WiFi-enabled body cameras (via browser API)

---

## Technical Implementation

### Device Capabilities Detection

```typescript
import { detectDeviceCapabilities } from '@/lib/deviceIntegration'

const caps = detectDeviceCapabilities()
// Returns:
// {
//   bluetooth: boolean,      // Web Bluetooth API available
//   accelerometer: boolean,  // DeviceMotion API available  
//   gyroscope: boolean,      // DeviceOrientation API available
//   webNFC: boolean,         // Web NFC API available (Chrome Android)
//   mediaDevices: boolean,   // Camera/mic access available
//   wakeLock: boolean,       // Screen wake lock available
// }
```

### Bluetooth Panic Button

```typescript
import { connectBluetoothPanicButton, disconnectBluetoothPanicButton } from '@/lib/deviceIntegration'

// Connect to a panic button
const device = await connectBluetoothPanicButton(
  () => {
    // Called when button is pressed
    console.log('PANIC BUTTON PRESSED!')
    triggerDuressAlert('bluetooth_button')
  },
  (batteryLevel) => {
    // Called when battery level updates
    console.log('Battery:', batteryLevel, '%')
  }
)

// Disconnect
disconnectBluetoothPanicButton()
```

### Fall Detection

```typescript
import { startFallDetection, stopFallDetection } from '@/lib/deviceIntegration'

// Start monitoring for falls
const success = startFallDetection(
  (event) => {
    // Fall detected!
    console.log('Fall event:', event)
    // event.impactForce - G-force of impact
    // event.freeFallDuration - milliseconds of free fall
    // event.postFallMotion - 'none' | 'minimal' | 'normal'
    
    if (event.postFallMotion === 'none') {
      // No movement after fall - officer may be incapacitated
      triggerDuressAlert('fall_detection', event)
    }
  },
  'medium' // sensitivity: 'low' | 'medium' | 'high'
)

// Stop monitoring
stopFallDetection()
```

### Shake-to-Alert

```typescript
import { startShakeDetection, stopShakeDetection } from '@/lib/deviceIntegration'

// Start listening for shake gestures
const success = startShakeDetection(
  (event) => {
    // Shake threshold reached!
    console.log('Shake count:', event.shakeCount)
    // Start countdown, then trigger alert
    triggerDuressAlert('shake', event)
  },
  5,       // required number of shakes (default: 5)
  'medium' // sensitivity
)

// Stop monitoring
stopShakeDetection()
```

### Heart Rate Monitoring

```typescript
import { connectHeartRateMonitor, disconnectHeartRateMonitor } from '@/lib/deviceIntegration'

// Connect to smartwatch/fitness band
const success = await connectHeartRateMonitor(
  (bpm) => {
    // Regular heart rate update
    console.log('Heart rate:', bpm, 'BPM')
  },
  (bpm, type) => {
    // Anomaly detected!
    // type: 'high' (>150 BPM) | 'low' (<40 BPM) | 'irregular' (sudden change)
    console.log('Heart rate anomaly:', type, bpm)
    
    if (type === 'high') {
      // Officer may be in distress
      notifySupervision('heart_rate_alert', { bpm, type })
    }
  }
)

// Disconnect
disconnectHeartRateMonitor()
```

---

## React Hooks

### useFallDetection

```tsx
import { useFallDetection } from '@/hooks/useFallDetection'

function OfficerPortal() {
  const { enabled, startDetection, stopDetection, toggleDetection, sensitivity, setSensitivity, lastFall, fallCount } = useFallDetection({
    onFallDetected: (event) => triggerDuressAlert('fall_detection', event),
    sensitivity: 'medium',
    autoStart: true,
    showToasts: true,
  })
  
  return (
    <Switch 
      checked={enabled} 
      onCheckedChange={toggleDetection} 
    />
  )
}
```

### useShakeDetection

```tsx
import { useShakeDetection } from '@/hooks/useShakeDetection'

function OfficerPortal() {
  const { enabled, toggleDetection, countdown, cancelCountdown, requiredShakes, setRequiredShakes } = useShakeDetection({
    onShakeAlert: (event) => triggerDuressAlert('shake', event),
    requiredShakes: 5,
    countdownSeconds: 5, // Countdown before alert sends
    sensitivity: 'medium',
  })
  
  // countdown is number | null - shows seconds remaining before alert
  // User can cancel during countdown
  
  return (
    <>
      <Switch checked={enabled} onCheckedChange={toggleDetection} />
      {countdown && <Button onClick={cancelCountdown}>Cancel ({countdown}s)</Button>}
    </>
  )
}
```

### useBluetoothPanicButton

```tsx
import { useBluetoothPanicButton } from '@/hooks/useBluetoothPanicButton'

function OfficerPortal() {
  const { device, isConnected, connect, disconnect, batteryLevel, isSupported } = useBluetoothPanicButton({
    onPanicPressed: () => triggerDuressAlert('bluetooth_button'),
    onBatteryUpdate: (level) => console.log('Battery:', level),
  })
  
  return (
    <Button onClick={isConnected ? disconnect : connect}>
      {isConnected ? `Connected: ${device?.name} (${batteryLevel}%)` : 'Connect Panic Button'}
    </Button>
  )
}
```

---

## UI Components

### DeviceSettingsPanel

Full configuration panel for all device settings:

```tsx
import { DeviceSettingsPanel } from '@/components/features/DeviceSettingsPanel'

function SettingsPage() {
  const handleDuressAlert = (method: string, data?: any) => {
    // Trigger duress alert with appropriate method
    supabase.from('officer_welfare_alerts').insert({
      alert_type: 'sos',
      trigger_method: method,
      // ... other fields
    })
  }
  
  return (
    <DeviceSettingsPanel 
      onDuressAlert={handleDuressAlert}
      compact={false} // Full panel
    />
  )
}
```

### WearableStatus

Compact status indicator for headers/safety bars:

```tsx
import { WearableStatus } from '@/components/features/WearableStatus'

function SafetyBar() {
  return (
    <WearableStatus 
      size="sm" 
      showLabel={false}
      onSettingsClick={() => navigate('/settings/devices')}
    />
  )
}
```

---

## Store (deviceStore)

The device store tracks all connected devices and their state:

```typescript
import { useDeviceStore, useAnySafetyActive, useConnectedDevicesCount } from '@/stores/deviceStore'

// Get connected devices count
const connectedCount = useConnectedDevicesCount()

// Check if any safety feature is active
const protected = useAnySafetyActive()

// Full store access
const { blePanicDevice, fallDetection, shakeDetection, heartRateMonitor, externalCameras } = useDeviceStore()
```

---

## Fall Detection Algorithm

The fall detection uses a three-phase algorithm:

1. **Free Fall Detection**: Acceleration magnitude drops below 0.3g
2. **Impact Detection**: Acceleration magnitude exceeds 2.5g after free fall
3. **Post-Fall Analysis**: Checks for movement after impact
   - If no movement for 3 seconds → likely incapacitated → ALERT
   - If normal movement → false positive → ignore

**Sensitivity Adjustment:**
- **Low**: 30% higher thresholds (fewer false positives, may miss some falls)
- **Medium**: Default calibrated thresholds
- **High**: 30% lower thresholds (catches more falls, more false positives)

---

## Security Considerations

1. **Bluetooth Permission**: User must explicitly grant Bluetooth access
2. **Motion Permission**: iOS 13+ requires explicit permission for DeviceMotion
3. **Data Privacy**: Heart rate data is only stored in-memory during session
4. **Secure Transmission**: All alerts are sent via authenticated Supabase connection
5. **No PII in Logs**: Device identifiers are not logged

---

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Bluetooth Panic | ✅ | ❌ | ❌ | ✅ |
| Fall Detection | ✅ | ✅ | ✅* | ✅ |
| Shake Detection | ✅ | ✅ | ✅* | ✅ |
| Heart Rate | ✅ | ❌ | ❌ | ✅ |
| External Camera | ✅ | ✅ | ✅ | ✅ |

\* Safari requires explicit permission via `DeviceMotionEvent.requestPermission()`

---

## Health & Safety Compliance

These features support compliance with:

- **Health & Safety at Work Act 2015 (NZ)**: Section 36 PCBU duties for lone workers
- **PSPLA 2010**: Private security personnel licensing requirements
- **AS 4801 / ISO 45001**: Occupational health and safety management
- **EN 50518**: Monitoring and alarm receiving centers (UK/EU)

**Documentation Requirements:**
- All duress alerts are logged to `officer_welfare_alerts` table
- Trigger method recorded for incident analysis
- GPS coordinates captured if available
- Escalation level automatically set based on trigger type
