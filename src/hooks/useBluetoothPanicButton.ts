/**
 * useBluetoothPanicButton.ts
 * 
 * React hook for connecting and managing Bluetooth panic button devices.
 * Supports BLE panic buttons that send a notification when pressed.
 * 
 * Usage:
 *   const { connect, disconnect, device, isConnected } = useBluetoothPanicButton({
 *     onPanicPressed: () => triggerDuressAlert('bluetooth_button')
 *   })
 */

import { useCallback, useEffect, useRef } from 'react'
import { useDeviceStore } from '@/stores/deviceStore'
import {
  connectBluetoothPanicButton,
  disconnectBluetoothPanicButton,
  detectDeviceCapabilities,
} from '@/lib/deviceIntegration'
import { toast } from 'sonner'

interface UseBluetoothPanicButtonOptions {
  /** Called when panic button is pressed */
  onPanicPressed?: () => void
  /** Called when battery level updates */
  onBatteryUpdate?: (level: number) => void
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean
  /** Show toast notifications */
  showToasts?: boolean
}

export function useBluetoothPanicButton(options: UseBluetoothPanicButtonOptions = {}) {
  const { autoReconnect = true, showToasts = true } = options
  
  const { blePanicDevice, setBlePanicDevice, setBlePanicEnabled, blePanicEnabled, setError } = useDeviceStore()
  const onPanicPressedRef = useRef(options.onPanicPressed)
  const onBatteryUpdateRef = useRef(options.onBatteryUpdate)
  
  // Keep callback refs updated
  useEffect(() => {
    onPanicPressedRef.current = options.onPanicPressed
  }, [options.onPanicPressed])
  
  useEffect(() => {
    onBatteryUpdateRef.current = options.onBatteryUpdate
  }, [options.onBatteryUpdate])
  
  const handlePanicPressed = useCallback(() => {
    if (showToasts) {
      toast.error('🚨 PANIC BUTTON PRESSED!', {
        duration: 0,
        description: 'Duress alert is being sent to supervisors',
      })
    }
    
    onPanicPressedRef.current?.()
  }, [showToasts])
  
  const handleBatteryUpdate = useCallback((level: number) => {
    if (level < 20 && showToasts) {
      toast.warning(`Panic button battery low: ${level}%`, {
        description: 'Please charge or replace the battery soon',
      })
    }
    
    onBatteryUpdateRef.current?.(level)
  }, [showToasts])
  
  const connect = useCallback(async () => {
    const capabilities = detectDeviceCapabilities()
    
    if (!capabilities.bluetooth) {
      const errorMsg = 'Bluetooth not supported on this device'
      setError(errorMsg)
      if (showToasts) {
        toast.error(errorMsg)
      }
      return null
    }
    
    if (showToasts) {
      toast.info('Scanning for Bluetooth panic buttons...', {
        description: 'Make sure your device is in pairing mode',
      })
    }
    
    const device = await connectBluetoothPanicButton(handlePanicPressed, handleBatteryUpdate)
    
    if (device) {
      setBlePanicEnabled(true)
      if (showToasts) {
        toast.success(`Connected to ${device.name}`, {
          description: device.batteryLevel ? `Battery: ${device.batteryLevel}%` : undefined,
        })
      }
    } else if (showToasts) {
      toast.error('Failed to connect to panic button')
    }
    
    return device
  }, [handlePanicPressed, handleBatteryUpdate, setBlePanicEnabled, setError, showToasts])
  
  const disconnect = useCallback(() => {
    disconnectBluetoothPanicButton()
    setBlePanicEnabled(false)
    
    if (showToasts) {
      toast.info('Panic button disconnected')
    }
  }, [setBlePanicEnabled, showToasts])
  
  const toggleConnection = useCallback(async () => {
    if (blePanicDevice?.connected) {
      disconnect()
      return false
    } else {
      const device = await connect()
      return device !== null
    }
  }, [blePanicDevice?.connected, connect, disconnect])
  
  return {
    device: blePanicDevice,
    isConnected: blePanicDevice?.connected ?? false,
    isEnabled: blePanicEnabled,
    batteryLevel: blePanicDevice?.batteryLevel,
    connect,
    disconnect,
    toggleConnection,
    isSupported: detectDeviceCapabilities().bluetooth,
  }
}
