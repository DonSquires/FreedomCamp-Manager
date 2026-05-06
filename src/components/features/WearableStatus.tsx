/**
 * WearableStatus.tsx
 * 
 * Compact status indicator for connected wearable devices.
 * Shows battery levels, connection status, and quick actions.
 * 
 * Designed to be placed in safety bars and headers.
 */

import { useDeviceStore, useConnectedDevicesCount, useAnySafetyActive } from '@/stores/deviceStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Watch,
  Bluetooth,
  BluetoothConnected,
  Battery,
  BatteryLow,
  BatteryWarning,
  Heart,
  Activity,
  Vibrate,
  ShieldCheck,
  ShieldAlert,
  Camera,
  Siren,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useWearableSOS } from '@/hooks/useWearableSOS'

interface WearableStatusProps {
  /** Size variant */
  size?: 'sm' | 'md'
  /** Show label text */
  showLabel?: boolean
  /** Click handler for settings */
  onSettingsClick?: () => void
}

export function WearableStatus({
  size = 'md',
  showLabel = false,
  onSettingsClick,
}: WearableStatusProps) {
  const connectedCount = useConnectedDevicesCount()
  const anySafetyActive = useAnySafetyActive()
  const { triggerSOS, isLoading: sosLoading, cooldownRemaining } = useWearableSOS()
  
  const {
    blePanicDevice,
    fallDetection,
    shakeDetection,
    heartRateMonitor,
    externalCameras,
  } = useDeviceStore()
  
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'
  const badgeSize = size === 'sm' ? 'text-[10px] px-1.5' : ''
  
  // Determine overall status
  const getStatusColor = () => {
    if (blePanicDevice?.connected && blePanicDevice.batteryLevel && blePanicDevice.batteryLevel < 20) {
      return 'text-orange-500' // Low battery warning
    }
    if (connectedCount > 0 || fallDetection.enabled || shakeDetection.enabled) {
      return 'text-green-500' // Protected
    }
    return 'text-muted-foreground' // No protection
  }
  
  // Battery icon based on level
  const getBatteryIcon = (level?: number) => {
    if (!level) return null
    if (level < 20) return <BatteryLow className={`${iconSize} text-red-500`} />
    if (level < 50) return <BatteryWarning className={`${iconSize} text-orange-500`} />
    return <Battery className={`${iconSize} text-green-500`} />
  }
  
  // If nothing is enabled/connected, show simple icon
  if (!anySafetyActive && connectedCount === 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size={size === 'sm' ? 'sm' : 'default'}
              className={`${size === 'sm' ? 'h-7 w-7 p-0' : 'h-8 w-8 p-0'}`}
              onClick={onSettingsClick}
            >
              <Watch className={`${iconSize} text-muted-foreground`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>No safety devices connected</p>
            <p className="text-xs text-muted-foreground">Click to configure</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={size === 'sm' ? 'sm' : 'default'}
          className={`${size === 'sm' ? 'h-7 px-1.5' : 'h-8 px-2'} gap-1`}
        >
          {anySafetyActive ? (
            <ShieldCheck className={`${iconSize} ${getStatusColor()}`} />
          ) : (
            <ShieldAlert className={`${iconSize} text-orange-500`} />
          )}
          
          {showLabel && (
            <span className={`${size === 'sm' ? 'text-xs' : 'text-sm'} font-medium`}>
              {connectedCount > 0 ? `${connectedCount}` : 'Setup'}
            </span>
          )}
          
          {blePanicDevice?.connected && (
            <BluetoothConnected className={`${iconSize} text-blue-500`} />
          )}
          
          {heartRateMonitor.connected && heartRateMonitor.currentBpm && (
            <span className="flex items-center gap-0.5">
              <Heart className={`${iconSize} text-red-500 animate-pulse`} />
              <span className={`${size === 'sm' ? 'text-[10px]' : 'text-xs'} font-bold text-red-500`}>
                {heartRateMonitor.currentBpm}
              </span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent className="w-72" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Safety Devices</h4>
            {anySafetyActive && (
              <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                Protected
              </Badge>
            )}
          </div>
          
          {/* Bluetooth Panic Button */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              {blePanicDevice?.connected ? (
                <BluetoothConnected className="h-4 w-4 text-blue-500" />
              ) : (
                <Bluetooth className="h-4 w-4 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">Panic Button</p>
                <p className="text-xs text-muted-foreground">
                  {blePanicDevice?.name ?? 'Not connected'}
                </p>
              </div>
            </div>
            {blePanicDevice?.connected && (
              <div className="flex items-center gap-1">
                {getBatteryIcon(blePanicDevice.batteryLevel)}
                <span className="text-xs">{blePanicDevice.batteryLevel}%</span>
              </div>
            )}
          </div>
          
          {/* Fall Detection */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Activity className={`h-4 w-4 ${fallDetection.enabled ? 'text-orange-500' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">Fall Detection</p>
                <p className="text-xs text-muted-foreground">
                  {fallDetection.enabled ? `${fallDetection.sensitivity} sensitivity` : 'Disabled'}
                </p>
              </div>
            </div>
            {fallDetection.enabled && (
              <Badge variant="outline" className={`${badgeSize} text-orange-600 border-orange-300`}>
                ON
              </Badge>
            )}
          </div>
          
          {/* Shake Detection */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Vibrate className={`h-4 w-4 ${shakeDetection.enabled ? 'text-purple-500' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">Shake Alert</p>
                <p className="text-xs text-muted-foreground">
                  {shakeDetection.enabled ? `${shakeDetection.requiredShakes} shakes` : 'Disabled'}
                </p>
              </div>
            </div>
            {shakeDetection.enabled && (
              <Badge variant="outline" className={`${badgeSize} text-purple-600 border-purple-300`}>
                ON
              </Badge>
            )}
          </div>
          
          {/* Heart Rate Monitor */}
          {heartRateMonitor.connected && (
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <Heart className="h-4 w-4 text-red-500 animate-pulse" />
                <div>
                  <p className="text-sm font-medium">Heart Rate</p>
                  <p className="text-xs text-muted-foreground">
                    {heartRateMonitor.currentBpm ? `${heartRateMonitor.currentBpm} BPM` : 'Monitoring...'}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className={`${badgeSize} text-red-600 border-red-300`}>
                LIVE
              </Badge>
            </div>
          )}
          
          {/* External Cameras */}
          {externalCameras.filter(c => c.status !== 'disconnected').length > 0 && (
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-sm font-medium">Body Camera</p>
                  <p className="text-xs text-muted-foreground">
                    {externalCameras.filter(c => c.status === 'streaming').length} streaming
                  </p>
                </div>
              </div>
              <Badge variant="outline" className={`${badgeSize} text-blue-600 border-blue-300`}>
                REC
              </Badge>
            </div>
          )}
          
          {/* SOS button (B-14) */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                className="w-full mt-2 gap-1.5"
                disabled={sosLoading || cooldownRemaining > 0}
              >
                <Siren className="h-4 w-4" />
                {cooldownRemaining > 0
                  ? `SOS sent — wait ${cooldownRemaining}s`
                  : sosLoading
                  ? 'Sending SOS…'
                  : 'Send SOS Alert'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send Emergency SOS?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will immediately alert all supervisors in your organisation
                  and log an emergency welfare alert. Only use in a genuine emergency.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => triggerSOS('web')}
                >
                  Confirm SOS
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Settings link */}
          {onSettingsClick && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={onSettingsClick}
            >
              Configure Devices
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
