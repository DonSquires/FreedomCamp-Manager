/**
 * PTT Bar Component - Push-to-Talk Control Bar
 * 
 * Provides a compact control bar for PTT functionality including:
 * - Hold-to-talk button (or toggle mode)
 * - VOX mode toggle with level indicator
 * - Channel selector (org/team/direct)
 * - Presence indicators
 * - Speaker indicator
 * - Last clip replay
 * - Bluetooth PTT status
 */

import { useEffect, useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  Mic,
  MicOff,
  Radio,
  Volume2,
  VolumeX,
  Users,
  User,
  Building2,
  Bluetooth,
  BluetoothOff,
  Wifi,
  WifiOff,
  Play,
  Settings,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  usePTTStore,
  usePTTAvailable,
  usePTTCanSpeak,
  PTTInputMode,
} from '@/stores/pttStore'
import {
  connectToOrgChannel,
  connectToDirectChannel,
  reconnectCurrentPTTChannel,
  startSpeaking,
  stopSpeaking,
  startVoxMonitoring,
  stopVoxMonitoring,
  setVoxThreshold,
  toggleMute,
  initBluetoothPTT,
  cleanupBluetoothPTT,
  playClip,
  normalizePTTErrorMessage,
} from '@/lib/ptt'
import { useAuthStore } from '@/stores/authStore'
import { useChatTargetStore } from '@/stores/chatTargetStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'

interface PTTBarProps {
  className?: string
  compact?: boolean
}

export function PTTBar({ className, compact = false }: PTTBarProps) {
  const { user } = useAuthStore()
  const { target } = useChatTargetStore()
  const selectedOrganizationId = useGlobalFiltersStore((s) => s.organizationId)
  
  const connectionStatus = usePTTStore((s) => s.connectionStatus)
  const channelId = usePTTStore((s) => s.channelId)
  const channelType = usePTTStore((s) => s.channelType)
  const channelName = usePTTStore((s) => s.channelName)
  const isSpeaking = usePTTStore((s) => s.isSpeaking)
  const speakerId = usePTTStore((s) => s.speakerId)
  const speakerName = usePTTStore((s) => s.speakerName)
  const isMuted = usePTTStore((s) => s.isMuted)
  const audioLevel = usePTTStore((s) => s.audioLevel)
  const inputMode = usePTTStore((s) => s.inputMode)
  const voxThreshold = usePTTStore((s) => s.voxThreshold)
  const voxEnabled = usePTTStore((s) => s.voxEnabled)
  const bluetoothEnabled = usePTTStore((s) => s.bluetoothEnabled)
  const bluetoothDevice = usePTTStore((s) => s.bluetoothDevice)
  const presence = usePTTStore((s) => s.presence)
  const lastClips = usePTTStore((s) => s.lastClips)
  const error = usePTTStore((s) => s.error)
  const setInputMode = usePTTStore((s) => s.setInputMode)
  const setError = usePTTStore((s) => s.setError)

  const isAvailable = usePTTAvailable()
  const canSpeak = usePTTCanSpeak()
  
  const [isPttPressed, setIsPttPressed] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const backendCodeMatch = error?.match(/\bcode\s*(\d{3})\b/i)
  const backendCode = backendCodeMatch?.[1] ?? null
  const backendHint = backendCode === '401'
    ? 'Auth/session issue'
    : backendCode === '403'
      ? 'Permission or org access issue'
      : backendCode === '502'
        ? 'PTT upstream service error'
        : backendCode === '503'
          ? 'PTT backend config missing'
          : backendCode
            ? 'Backend error'
            : null

  const operationalOrganizationId =
    user?.role === 'master' || user?.role === 'grand_master'
      ? selectedOrganizationId || user?.organization_id || null
      : user?.organization_id || null

  // Switch to appropriate channel based on chat target
  // The background service maintains the connection, we just switch channels
  useEffect(() => {
    if (!operationalOrganizationId) return
    if (connectionStatus !== 'connected') return

    const switchChannel = async () => {
      try {
        if (target.type === 'admin') {
          // Switch to org-wide channel for admin chat
          await connectToOrgChannel(operationalOrganizationId, 'Organization')
        } else if (target.type === 'user') {
          // Switch to direct channel for user chat
          await connectToDirectChannel(target.user.id, `${target.user.first_name} ${target.user.last_name}`)
        }
      } catch (err: any) {
        console.error('PTT: Failed to switch channel', err)
        setError(normalizePTTErrorMessage(err))
      }
    }

    switchChannel()
    // Note: We don't disconnect on cleanup - background service manages connection
  }, [target, operationalOrganizationId, connectionStatus, setError])

  // Handle PTT button press/release
  const handlePttDown = useCallback(async () => {
    if (!canSpeak || inputMode !== 'ptt') return
    setIsPttPressed(true)
    try {
      await startSpeaking()
    } catch (err: any) {
      console.error('PTT: Failed to start speaking', err)
      setError(normalizePTTErrorMessage(err))
    }
  }, [canSpeak, inputMode, setError])

  const handlePttUp = useCallback(async () => {
    if (!isSpeaking || inputMode !== 'ptt') return
    setIsPttPressed(false)
    try {
      await stopSpeaking()
    } catch (err: any) {
      console.error('PTT: Failed to stop speaking', err)
    }
  }, [isSpeaking, inputMode])

  // Handle toggle mode
  const handleToggle = useCallback(async () => {
    if (inputMode !== 'toggle') return
    try {
      if (isSpeaking) {
        await stopSpeaking()
      } else if (canSpeak) {
        await startSpeaking()
      }
    } catch (err: any) {
      console.error('PTT: Toggle failed', err)
      setError(normalizePTTErrorMessage(err))
    }
  }, [inputMode, isSpeaking, canSpeak, setError])

  // Handle VOX mode toggle
  const handleVoxToggle = useCallback(async (enabled: boolean) => {
    try {
      if (enabled) {
        setInputMode('vox')
        await startVoxMonitoring()
      } else {
        stopVoxMonitoring()
        setInputMode('ptt')
      }
    } catch (err: any) {
      console.error('PTT: VOX toggle failed', err)
      setError(normalizePTTErrorMessage(err))
    }
  }, [setInputMode, setError])

  // Handle Bluetooth toggle
  const handleBluetoothToggle = useCallback((enabled: boolean) => {
    if (enabled) {
      initBluetoothPTT()
    } else {
      cleanupBluetoothPTT()
    }
  }, [])

  // Handle input mode change
  const handleInputModeChange = useCallback((mode: string) => {
    setInputMode(mode as PTTInputMode)
    if (mode === 'vox' && !voxEnabled) {
      startVoxMonitoring().catch(console.error)
    } else if (mode !== 'vox' && voxEnabled) {
      stopVoxMonitoring()
    }
  }, [setInputMode, voxEnabled])

  const handleRetryConnection = useCallback(async () => {
    if (isRetrying) return
    setIsRetrying(true)
    setError(null)

    try {
      if (target.type === 'user') {
        await connectToDirectChannel(target.user.id, `${target.user.first_name} ${target.user.last_name}`)
      } else if (operationalOrganizationId) {
        await connectToOrgChannel(operationalOrganizationId, 'Organization')
      } else {
        await reconnectCurrentPTTChannel()
      }
    } catch (err: any) {
      console.error('PTT: Retry connection failed', err)
      setError(normalizePTTErrorMessage(err))
    } finally {
      setIsRetrying(false)
    }
  }, [isRetrying, operationalOrganizationId, setError, target])

  // Connection status indicator
  const getConnectionIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi className="h-4 w-4 text-green-500" />
      case 'connecting':
      case 'reconnecting':
        return <Wifi className="h-4 w-4 text-yellow-500 animate-pulse" />
      case 'error':
        return <WifiOff className="h-4 w-4 text-red-500" />
      default:
        return <WifiOff className="h-4 w-4 text-muted-foreground" />
    }
  }

  // PTT button appearance based on state
  const getPttButtonClass = () => {
    if (isSpeaking) {
      return 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
    }
    if (speakerId && !isSpeaking) {
      return 'bg-yellow-500 hover:bg-yellow-600 text-black'
    }
    if (canSpeak) {
      return 'bg-green-500 hover:bg-green-600 text-white'
    }
    return 'bg-muted text-muted-foreground'
  }

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 p-2 bg-card border rounded-lg', className)}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-8 w-8 p-0', getPttButtonClass())}
                onMouseDown={handlePttDown}
                onMouseUp={handlePttUp}
                onMouseLeave={handlePttUp}
                onTouchStart={handlePttDown}
                onTouchEnd={handlePttUp}
                onClick={inputMode === 'toggle' ? handleToggle : undefined}
                disabled={!isAvailable || isMuted}
              >
                {isSpeaking ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {inputMode === 'ptt' ? 'Hold to talk' : inputMode === 'toggle' ? 'Click to toggle' : 'VOX active'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {getConnectionIcon()}

        {speakerName && (
          <Badge variant="secondary" className="text-xs">
            <Volume2 className="h-3 w-3 mr-1" />
            {speakerName}
          </Badge>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2 p-3 bg-card border rounded-lg', className)}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Push to Talk</span>
          {channelName && (
            <Badge variant="outline" className="text-xs">
              {channelType === 'org' && <Building2 className="h-3 w-3 mr-1" />}
              {channelType === 'direct' && <User className="h-3 w-3 mr-1" />}
              {channelType === 'team' && <Users className="h-3 w-3 mr-1" />}
              {channelName}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {getConnectionIcon()}
          
          <Popover open={showSettings} onOpenChange={setShowSettings}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="end">
              <div className="space-y-4">
                <div className="font-medium text-sm">PTT Settings</div>
                
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Input Mode</label>
                  <Select value={inputMode} onValueChange={handleInputModeChange}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ptt">Push to Talk (Hold)</SelectItem>
                      <SelectItem value="toggle">Toggle (Click)</SelectItem>
                      <SelectItem value="vox">Voice Activated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {inputMode === 'vox' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-muted-foreground">VOX Threshold</label>
                      <span className="text-xs">{voxThreshold}%</span>
                    </div>
                    <input
                      type="range"
                      value={voxThreshold}
                      onChange={(e) => setVoxThreshold(parseInt(e.target.value, 10))}
                      min={0}
                      max={100}
                      step={5}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all duration-75',
                          audioLevel >= voxThreshold ? 'bg-green-500' : 'bg-blue-500'
                        )}
                        style={{ width: `${audioLevel}%` }}
                      />
                    </div>
                  </div>
                )}

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {bluetoothEnabled ? (
                      <Bluetooth className="h-4 w-4 text-blue-500" />
                    ) : (
                      <BluetoothOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm">Bluetooth PTT</span>
                  </div>
                  <Switch
                    checked={bluetoothEnabled}
                    onCheckedChange={handleBluetoothToggle}
                  />
                </div>

                {bluetoothDevice && (
                  <div className="text-xs text-muted-foreground pl-6">
                    {bluetoothDevice.name}
                    {bluetoothDevice.batteryLevel !== undefined && ` (${bluetoothDevice.batteryLevel}%)`}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => toggleMute()}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4 text-red-500" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Main PTT button */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="lg"
          className={cn(
            'flex-1 h-12 text-base font-semibold transition-all',
            getPttButtonClass()
          )}
          onMouseDown={handlePttDown}
          onMouseUp={handlePttUp}
          onMouseLeave={handlePttUp}
          onTouchStart={handlePttDown}
          onTouchEnd={handlePttUp}
          onClick={inputMode === 'toggle' ? handleToggle : undefined}
          disabled={!isAvailable || isMuted}
        >
          {isSpeaking ? (
            <>
              <Mic className="h-5 w-5 mr-2 animate-pulse" />
              Speaking...
            </>
          ) : speakerId ? (
            <>
              <Volume2 className="h-5 w-5 mr-2" />
              {speakerName} speaking
            </>
          ) : inputMode === 'ptt' ? (
            <>
              <MicOff className="h-5 w-5 mr-2" />
              Hold to Talk
            </>
          ) : inputMode === 'toggle' ? (
            <>
              <MicOff className="h-5 w-5 mr-2" />
              Click to Talk
            </>
          ) : (
            <>
              <Radio className="h-5 w-5 mr-2" />
              VOX Active
            </>
          )}
        </Button>

        {/* VOX level indicator */}
        {inputMode === 'vox' && (
          <div className="w-8 h-12 bg-muted rounded-md overflow-hidden flex flex-col-reverse">
            <div
              className={cn(
                'w-full transition-all duration-75',
                audioLevel >= voxThreshold ? 'bg-green-500' : 'bg-blue-500'
              )}
              style={{ height: `${audioLevel}%` }}
            />
          </div>
        )}
      </div>

      {/* Presence row */}
      {presence.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Online:</span>
          {presence.slice(0, 5).map((p) => (
            <Badge
              key={p.userId}
              variant={p.status === 'online' ? 'default' : 'secondary'}
              className="text-xs py-0"
            >
              {p.name.split(' ')[0]}
            </Badge>
          ))}
          {presence.length > 5 && (
            <Badge variant="outline" className="text-xs py-0">
              +{presence.length - 5}
            </Badge>
          )}
        </div>
      )}

      {/* Last clips */}
      {lastClips.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Recent:</span>
          {lastClips.slice(0, 3).map((clip) => (
            <TooltipProvider key={clip.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => clip.clipUrl && playClip(clip.clipUrl)}
                    disabled={!clip.clipUrl}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    {clip.senderName.split(' ')[0]}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {clip.duration ? `${clip.duration}s` : 'Play clip'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-500 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-900/50 dark:bg-red-950/30">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
            {backendCode && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-red-300 text-red-700 dark:border-red-700 dark:text-red-300">
                {backendHint}: {backendCode}
              </Badge>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleRetryConnection}
            disabled={isRetrying}
          >
            {isRetrying ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}
    </div>
  )
}
