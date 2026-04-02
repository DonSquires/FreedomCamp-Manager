/**
 * DeviceSettingsPanel.tsx
 * 
 * Comprehensive device settings panel for configuring:
 * - Bluetooth panic buttons
 * - Fall detection
 * - Shake-to-alert
 * - External cameras
 * - Heart rate monitoring
 * 
 * Used in officer settings/preferences screens.
 */

import { useState } from 'react'
import { useDeviceStore, useAnySafetyActive, useConnectedDevicesCount } from '@/stores/deviceStore'
import { useFallDetection } from '@/hooks/useFallDetection'
import { useShakeDetection } from '@/hooks/useShakeDetection'
import { useBluetoothPanicButton } from '@/hooks/useBluetoothPanicButton'
import {
  detectDeviceCapabilities,
  connectHeartRateMonitor,
  disconnectHeartRateMonitor,
  getAvailableCameras,
  connectExternalCamera,
  disconnectExternalCamera,
} from '@/lib/deviceIntegration'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Bluetooth,
  BluetoothConnected,
  BluetoothOff,
  Smartphone,
  Watch,
  Camera,
  Heart,
  AlertTriangle,
  ChevronDown,
  Vibrate,
  Activity,
  Shield,
  ShieldCheck,
  Battery,
  BatteryLow,
  RefreshCw,
  Wifi,
  Usb,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'

interface DeviceSettingsPanelProps {
  /** Callback when any duress alert is triggered */
  onDuressAlert?: (method: string, data?: any) => void
  /** Compact mode for embedding in other panels */
  compact?: boolean
}

export function DeviceSettingsPanel({ onDuressAlert, compact = false }: DeviceSettingsPanelProps) {
  const capabilities = detectDeviceCapabilities()
  const connectedCount = useConnectedDevicesCount()
  const anySafetyActive = useAnySafetyActive()
  
  const { heartRateMonitor, externalCameras, setHeartRateMonitor, removeExternalCamera } = useDeviceStore()
  
  // Device hooks
  const fallDetection = useFallDetection({
    onFallDetected: (event) => onDuressAlert?.('fall_detection', event),
    showToasts: true,
  })
  
  const shakeDetection = useShakeDetection({
    onShakeAlert: (event) => onDuressAlert?.('shake', event),
    showToasts: true,
  })
  
  const bluetoothPanic = useBluetoothPanicButton({
    onPanicPressed: () => onDuressAlert?.('bluetooth_button'),
    showToasts: true,
  })
  
  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [scanningCameras, setScanningCameras] = useState(false)
  const [availableCameras, setAvailableCameras] = useState<Awaited<ReturnType<typeof getAvailableCameras>>>([])
  
  // Scan for cameras
  const handleScanCameras = async () => {
    setScanningCameras(true)
    try {
      const cameras = await getAvailableCameras()
      setAvailableCameras(cameras)
      toast.success(`Found ${cameras.length} camera(s)`)
    } catch (error) {
      toast.error('Failed to scan for cameras')
    } finally {
      setScanningCameras(false)
    }
  }
  
  // Connect to heart rate monitor
  const handleConnectHeartRate = async () => {
    const success = await connectHeartRateMonitor(
      (bpm) => {
        // Update is handled in the library
      },
      (bpm, type) => {
        onDuressAlert?.('heart_rate_anomaly', { bpm, type })
      }
    )
    
    if (success) {
      toast.success('Heart rate monitor connected')
    }
  }
  
  const SectionCard = compact ? 'div' : Card
  const SectionHeader = compact ? 'div' : CardHeader
  const SectionContent = compact ? 'div' : CardContent
  
  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Safety Device Settings
            </h2>
            <p className="text-sm text-muted-foreground">
              Configure panic buttons, fall detection, and monitoring devices
            </p>
          </div>
          <div className="flex items-center gap-2">
            {anySafetyActive && (
              <Badge variant="default" className="bg-green-600">
                <ShieldCheck className="h-3 w-3 mr-1" />
                Protected
              </Badge>
            )}
            {connectedCount > 0 && (
              <Badge variant="outline">
                {connectedCount} device{connectedCount > 1 ? 's' : ''} connected
              </Badge>
            )}
          </div>
        </div>
      )}
      
      {/* Bluetooth Panic Button */}
      <SectionCard>
        <SectionHeader className={compact ? 'pb-2' : ''}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {bluetoothPanic.isConnected ? (
                <BluetoothConnected className="h-5 w-5 text-blue-500" />
              ) : (
                <Bluetooth className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <CardTitle className={compact ? 'text-sm' : ''}>Bluetooth Panic Button</CardTitle>
                {!compact && (
                  <CardDescription>
                    Connect a dedicated BLE panic button device
                  </CardDescription>
                )}
              </div>
            </div>
            {bluetoothPanic.isConnected && bluetoothPanic.batteryLevel !== undefined && (
              <div className="flex items-center gap-1 text-sm">
                {bluetoothPanic.batteryLevel < 20 ? (
                  <BatteryLow className="h-4 w-4 text-red-500" />
                ) : (
                  <Battery className="h-4 w-4 text-green-500" />
                )}
                {bluetoothPanic.batteryLevel}%
              </div>
            )}
          </div>
        </SectionHeader>
        <SectionContent className={compact ? 'space-y-2' : 'space-y-4'}>
          <div className="flex items-center justify-between">
            <div>
              {bluetoothPanic.device ? (
                <p className="text-sm font-medium">{bluetoothPanic.device.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No device connected</p>
              )}
            </div>
            <Button
              variant={bluetoothPanic.isConnected ? 'outline' : 'default'}
              size="sm"
              onClick={bluetoothPanic.toggleConnection}
              disabled={!capabilities.bluetooth}
            >
              {bluetoothPanic.isConnected ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
          
          {!capabilities.bluetooth && (
            <p className="text-xs text-orange-600">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              Bluetooth not supported on this device/browser
            </p>
          )}
        </SectionContent>
      </SectionCard>
      
      {/* Fall Detection */}
      <SectionCard>
        <SectionHeader className={compact ? 'pb-2' : ''}>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-500" />
            <div>
              <CardTitle className={compact ? 'text-sm' : ''}>Fall Detection</CardTitle>
              {!compact && (
                <CardDescription>
                  Automatically detect falls using motion sensors
                </CardDescription>
              )}
            </div>
          </div>
        </SectionHeader>
        <SectionContent className={compact ? 'space-y-2' : 'space-y-4'}>
          <div className="flex items-center justify-between">
            <Label htmlFor="fall-detection" className="flex items-center gap-2">
              Enable fall detection
              {fallDetection.enabled && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  Active
                </Badge>
              )}
            </Label>
            <Switch
              id="fall-detection"
              checked={fallDetection.enabled}
              onCheckedChange={() => fallDetection.toggleDetection()}
              disabled={!capabilities.accelerometer}
            />
          </div>
          
          {fallDetection.enabled && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Sensitivity</Label>
                <Select
                  value={fallDetection.sensitivity}
                  onValueChange={(v) => fallDetection.setSensitivity(v as any)}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {fallDetection.fallCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Falls detected this session: {fallDetection.fallCount}
                </p>
              )}
            </div>
          )}
          
          {!capabilities.accelerometer && (
            <p className="text-xs text-orange-600">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              Motion sensors not available on this device
            </p>
          )}
        </SectionContent>
      </SectionCard>
      
      {/* Shake Detection */}
      <SectionCard>
        <SectionHeader className={compact ? 'pb-2' : ''}>
          <div className="flex items-center gap-2">
            <Vibrate className="h-5 w-5 text-purple-500" />
            <div>
              <CardTitle className={compact ? 'text-sm' : ''}>Shake-to-Alert</CardTitle>
              {!compact && (
                <CardDescription>
                  Rapidly shake phone to trigger discreet panic alert
                </CardDescription>
              )}
            </div>
          </div>
        </SectionHeader>
        <SectionContent className={compact ? 'space-y-2' : 'space-y-4'}>
          <div className="flex items-center justify-between">
            <Label htmlFor="shake-detection" className="flex items-center gap-2">
              Enable shake-to-alert
              {shakeDetection.enabled && (
                <Badge variant="outline" className="text-purple-600 border-purple-600">
                  Active
                </Badge>
              )}
              {shakeDetection.isCountingDown && (
                <Badge variant="destructive" className="animate-pulse">
                  {shakeDetection.countdown}s
                </Badge>
              )}
            </Label>
            <Switch
              id="shake-detection"
              checked={shakeDetection.enabled}
              onCheckedChange={() => shakeDetection.toggleDetection()}
              disabled={!capabilities.accelerometer}
            />
          </div>
          
          {shakeDetection.enabled && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Required shakes</Label>
                <Select
                  value={String(shakeDetection.requiredShakes)}
                  onValueChange={(v) => shakeDetection.setRequiredShakes(Number(v))}
                >
                  <SelectTrigger className="w-[80px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="7">7</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-sm">Sensitivity</Label>
                <Select
                  value={shakeDetection.sensitivity}
                  onValueChange={(v) => shakeDetection.setSensitivity(v as any)}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </SectionContent>
      </SectionCard>
      
      {/* Advanced Options */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Advanced Devices
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="space-y-4 mt-4">
          {/* Heart Rate Monitor */}
          <SectionCard>
            <SectionHeader className={compact ? 'pb-2' : ''}>
              <div className="flex items-center gap-2">
                <Heart className={`h-5 w-5 ${heartRateMonitor.connected ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`} />
                <div>
                  <CardTitle className={compact ? 'text-sm' : ''}>Heart Rate Monitor</CardTitle>
                  {!compact && (
                    <CardDescription>
                      Connect smartwatch or fitness band for health monitoring
                    </CardDescription>
                  )}
                </div>
              </div>
            </SectionHeader>
            <SectionContent>
              <div className="flex items-center justify-between">
                <div>
                  {heartRateMonitor.connected ? (
                    <div>
                      <p className="text-2xl font-bold text-red-500">
                        {heartRateMonitor.currentBpm ?? '--'} <span className="text-sm">BPM</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last updated: {heartRateMonitor.lastUpdate ? new Date(heartRateMonitor.lastUpdate).toLocaleTimeString() : 'Never'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not connected</p>
                  )}
                </div>
                <Button
                  variant={heartRateMonitor.connected ? 'outline' : 'default'}
                  size="sm"
                  onClick={heartRateMonitor.connected ? disconnectHeartRateMonitor : handleConnectHeartRate}
                  disabled={!capabilities.bluetooth}
                >
                  <Watch className="h-4 w-4 mr-2" />
                  {heartRateMonitor.connected ? 'Disconnect' : 'Connect'}
                </Button>
              </div>
            </SectionContent>
          </SectionCard>
          
          {/* External Cameras */}
          <SectionCard>
            <SectionHeader className={compact ? 'pb-2' : ''}>
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-blue-500" />
                <div>
                  <CardTitle className={compact ? 'text-sm' : ''}>External Cameras</CardTitle>
                  {!compact && (
                    <CardDescription>
                      Connect body cameras or external video devices
                    </CardDescription>
                  )}
                </div>
              </div>
            </SectionHeader>
            <SectionContent className={compact ? 'space-y-2' : 'space-y-4'}>
              <Button
                variant="outline"
                size="sm"
                onClick={handleScanCameras}
                disabled={scanningCameras}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${scanningCameras ? 'animate-spin' : ''}`} />
                Scan for Cameras
              </Button>
              
              {availableCameras.length > 0 && (
                <div className="space-y-2">
                  {availableCameras.map((camera) => {
                    const connectedCamera = externalCameras.find(c => c.id === camera.id)
                    const isConnected = connectedCamera?.status !== 'disconnected'
                    
                    return (
                      <div
                        key={camera.id}
                        className="flex items-center justify-between p-2 border rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          {camera.type === 'bluetooth' ? (
                            <Bluetooth className="h-4 w-4" />
                          ) : camera.type === 'usb' ? (
                            <Usb className="h-4 w-4" />
                          ) : (
                            <Wifi className="h-4 w-4" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{camera.name}</p>
                            <p className="text-xs text-muted-foreground">{camera.type.toUpperCase()}</p>
                          </div>
                        </div>
                        <Button
                          variant={isConnected ? 'outline' : 'default'}
                          size="sm"
                          onClick={() => {
                            if (isConnected) {
                              disconnectExternalCamera(camera.id)
                              removeExternalCamera(camera.id)
                            } else {
                              connectExternalCamera(camera.id)
                            }
                          }}
                        >
                          {isConnected ? 'Disconnect' : 'Connect'}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
              
              {externalCameras.filter(c => c.status !== 'disconnected').length > 0 && (
                <div className="text-sm text-green-600">
                  {externalCameras.filter(c => c.status !== 'disconnected').length} camera(s) connected
                </div>
              )}
            </SectionContent>
          </SectionCard>
        </CollapsibleContent>
      </Collapsible>
      
      {/* Device Capabilities Summary */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p className="font-medium">Device Capabilities:</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={capabilities.bluetooth ? 'outline' : 'secondary'} className="text-xs">
            {capabilities.bluetooth ? '✓' : '✗'} Bluetooth
          </Badge>
          <Badge variant={capabilities.accelerometer ? 'outline' : 'secondary'} className="text-xs">
            {capabilities.accelerometer ? '✓' : '✗'} Motion
          </Badge>
          <Badge variant={capabilities.webNFC ? 'outline' : 'secondary'} className="text-xs">
            {capabilities.webNFC ? '✓' : '✗'} NFC
          </Badge>
          <Badge variant={capabilities.mediaDevices ? 'outline' : 'secondary'} className="text-xs">
            {capabilities.mediaDevices ? '✓' : '✗'} Camera
          </Badge>
          <Badge variant={capabilities.wakeLock ? 'outline' : 'secondary'} className="text-xs">
            {capabilities.wakeLock ? '✓' : '✗'} Wake Lock
          </Badge>
        </div>
      </div>
    </div>
  )
}
