/**
 * AlertSettingsPanel Component
 * Customize alert thresholds and triggers
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { 
  Settings,
  AlertTriangle,
  TrendingUp,
  Clock,
  Moon,
  Save,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'

interface AlertSettings {
  monthly_stay_warning_threshold: number
  consecutive_stay_warning_threshold: number
  auto_escalate_enabled: boolean
  auto_escalate_days: number
  high_priority_zones: string[]
  alert_quiet_hours_enabled: boolean
  alert_quiet_hours_start: string
  alert_quiet_hours_end: string
}

export function AlertSettingsPanel() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['alert-settings', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return null

      // This would fetch from a settings table or user preferences
      // For now, return defaults
      return {
        monthly_stay_warning_threshold: 24, // Alert when 80% of 28 days used
        consecutive_stay_warning_threshold: 2, // Alert at 2 of 3 consecutive nights
        auto_escalate_enabled: true,
        auto_escalate_days: 3,
        high_priority_zones: [],
        alert_quiet_hours_enabled: false,
        alert_quiet_hours_start: '22:00',
        alert_quiet_hours_end: '07:00',
      } as AlertSettings
    },
    enabled: !!user?.organization_id,
  })

  const [localSettings, setLocalSettings] = useState<AlertSettings | null>(null)

  // Use local settings or fallback to fetched settings
  const currentSettings = localSettings || settings

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: AlertSettings) => {
      // This would save to database
      // For now, just simulate success
      await new Promise(resolve => setTimeout(resolve, 500))
      return newSettings
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-settings'] })
      toast.success('Alert settings updated')
      setLocalSettings(null)
    },
    onError: (error: any) => {
      toast.error(`Failed to update settings: ${error.message}`)
    },
  })

  const handleChange = (key: keyof AlertSettings, value: any) => {
    setLocalSettings({
      ...(currentSettings || {}),
      [key]: value,
    } as AlertSettings)
  }

  const handleSave = () => {
    if (localSettings) {
      updateSettingsMutation.mutate(localSettings)
    }
  }

  const handleReset = () => {
    setLocalSettings(null)
    toast.info('Changes discarded')
  }

  const hasChanges = localSettings !== null

  if (isLoading || !currentSettings) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            Loading settings...
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Alert Thresholds
            </CardTitle>
            <CardDescription className="mt-1">
              Customize when and how alerts are triggered
            </CardDescription>
          </div>
          {hasChanges && (
            <Badge variant="secondary">Unsaved Changes</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Monthly stay threshold */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="monthly-threshold">
              Monthly Stay Warning Threshold
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Input
              id="monthly-threshold"
              type="number"
              min="1"
              max="28"
              value={currentSettings.monthly_stay_warning_threshold}
              onChange={(e) => handleChange('monthly_stay_warning_threshold', parseInt(e.target.value))}
              className="max-w-24"
            />
            <span className="text-sm text-muted-foreground">
              nights (out of 28 per month)
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Alert when vehicle reaches this many nights in a calendar month
          </p>
        </div>

        {/* Consecutive stay threshold */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="consecutive-threshold">
              Consecutive Stay Warning Threshold
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Input
              id="consecutive-threshold"
              type="number"
              min="1"
              max="3"
              value={currentSettings.consecutive_stay_warning_threshold}
              onChange={(e) => handleChange('consecutive_stay_warning_threshold', parseInt(e.target.value))}
              className="max-w-24"
            />
            <span className="text-sm text-muted-foreground">
              nights (out of 3 consecutive)
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Alert when vehicle reaches this many consecutive nights
          </p>
        </div>

        {/* Auto-escalation */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="auto-escalate" className="cursor-pointer">
                Auto-Escalate Unresolved Breaches
              </Label>
            </div>
            <Switch
              id="auto-escalate"
              checked={currentSettings.auto_escalate_enabled}
              onCheckedChange={(checked) => handleChange('auto_escalate_enabled', checked)}
            />
          </div>

          {currentSettings.auto_escalate_enabled && (
            <div className="ml-6 space-y-2">
              <div className="flex items-center gap-3">
                <Label htmlFor="escalate-days" className="text-sm">
                  Escalate after
                </Label>
                <Input
                  id="escalate-days"
                  type="number"
                  min="1"
                  max="14"
                  value={currentSettings.auto_escalate_days}
                  onChange={(e) => handleChange('auto_escalate_days', parseInt(e.target.value))}
                  className="max-w-20"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatically escalate breach alerts that remain unresolved
              </p>
            </div>
          )}
        </div>

        {/* Quiet hours */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="quiet-hours" className="cursor-pointer">
                Enable Quiet Hours
              </Label>
            </div>
            <Switch
              id="quiet-hours"
              checked={currentSettings.alert_quiet_hours_enabled}
              onCheckedChange={(checked) => handleChange('alert_quiet_hours_enabled', checked)}
            />
          </div>

          {currentSettings.alert_quiet_hours_enabled && (
            <div className="ml-6 space-y-3">
              <div className="flex items-center gap-3">
                <Label htmlFor="quiet-start" className="text-sm">
                  From
                </Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={currentSettings.alert_quiet_hours_start}
                  onChange={(e) => handleChange('alert_quiet_hours_start', e.target.value)}
                  className="max-w-32"
                />
                <Label htmlFor="quiet-end" className="text-sm">
                  To
                </Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={currentSettings.alert_quiet_hours_end}
                  onChange={(e) => handleChange('alert_quiet_hours_end', e.target.value)}
                  className="max-w-32"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Suppress non-critical alerts during these hours
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        {hasChanges && (
          <div className="flex gap-2 pt-4 border-t">
            <Button
              onClick={handleSave}
              disabled={updateSettingsMutation.isPending}
            >
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={updateSettingsMutation.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Discard
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
