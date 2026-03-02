/**
 * PrivacyCurtain — Admin page for configuring per-org PII auto-redaction settings.
 * Privacy Act 2020 (NZ) — Information Privacy Principles 1, 6, 10, 11.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Shield, Eye, EyeOff, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PrivacyCurtainSettings {
  id: string
  organization_id: string
  auto_redact_enabled: boolean
  redact_owner_name: boolean
  redact_owner_address: boolean
  redact_phone_number: boolean
  redact_plate_in_exports: boolean
  require_reason_for_unredact: boolean
  unredact_roles: string[]
}

interface PrivacyAccessLog {
  id: string
  actor: string
  target_table: string
  target_record_id: string
  field_accessed: string
  access_reason: string | null
  accessed_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings row component
// ─────────────────────────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex-1 mr-4">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PrivacyCurtain() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const isAuthorized = user && ['admin', 'master'].includes(user.role)

  // ─── Fetch settings ─────────────────────────────────────────────────────

  const { data: settings, isLoading } = useQuery({
    queryKey: ['privacy-curtain-settings', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('privacy_curtain_settings')
        .select('*')
        .eq('organization_id', user!.organization_id!)
        .maybeSingle()

      if (error) throw error
      return data as PrivacyCurtainSettings | null
    },
    enabled: !!user?.organization_id && !!isAuthorized,
  })

  // ─── Fetch access log ───────────────────────────────────────────────────

  const { data: accessLog } = useQuery({
    queryKey: ['privacy-access-log', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('privacy_access_log')
        .select('*')
        .eq('organization_id', user!.organization_id!)
        .order('accessed_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return (data ?? []) as PrivacyAccessLog[]
    },
    enabled: !!user?.organization_id && !!isAuthorized,
  })

  // ─── Update / upsert settings ────────────────────────────────────────────

  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<PrivacyCurtainSettings>) => {
      if (!user?.organization_id) throw new Error('No organisation')

      if (settings?.id) {
        const { error } = await (supabase as any)
          .from('privacy_curtain_settings')
          .update(patch)
          .eq('id', settings.id)
        if (error) throw error
      } else {
        const { error } = await (supabase as any)
          .from('privacy_curtain_settings')
          .insert({
            organization_id: user.organization_id,
            auto_redact_enabled: true,
            redact_owner_name: true,
            redact_owner_address: true,
            redact_phone_number: true,
            redact_plate_in_exports: false,
            require_reason_for_unredact: true,
            unredact_roles: ['admin', 'master'],
            ...patch,
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['privacy-curtain-settings'] })
      toast.success('Privacy settings updated')
    },
    onError: () => toast.error('Failed to update privacy settings'),
  })

  const toggle = (field: keyof PrivacyCurtainSettings) => (value: boolean) => {
    updateSettings.mutate({ [field]: value })
  }

  // ─── Loading / Access denied ─────────────────────────────────────────────

  if (!isAuthorized) {
    return (
      <AppLayout title="Privacy Curtain" description="PII Redaction Settings" showBackButton>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Admin access required.</CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  const currentSettings = settings ?? ({} as Partial<PrivacyCurtainSettings>)

  return (
    <AppLayout
      title="Privacy Curtain"
      description="Auto-redaction configuration — Privacy Act 2020 (NZ)"
      showBackButton
    >
      <div className="grid gap-6 md:grid-cols-2">
        {/* Settings panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-600" />
              Redaction Settings
              {currentSettings.auto_redact_enabled ? (
                <Badge className="ml-auto bg-green-100 text-green-700 border-green-200">Active</Badge>
              ) : (
                <Badge variant="outline" className="ml-auto text-gray-500">Off</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Controls which PII fields are masked in the UI for officers (IPP 5 — Storage security).
              Admins may see un-redacted values per the unredact_roles setting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : (
              <>
                <SettingRow
                  label="Enable Auto-Redaction"
                  description="Master switch — applies all redaction rules below."
                  checked={!!currentSettings.auto_redact_enabled}
                  onChange={toggle('auto_redact_enabled')}
                />
                <SettingRow
                  label="Redact Owner Name"
                  description="Mask vehicle registered owner's first/last name."
                  checked={!!currentSettings.redact_owner_name}
                  onChange={toggle('redact_owner_name')}
                />
                <SettingRow
                  label="Redact Owner Address"
                  description="Replace residential address with '[Address redacted]'."
                  checked={!!currentSettings.redact_owner_address}
                  onChange={toggle('redact_owner_address')}
                />
                <SettingRow
                  label="Redact Phone Number"
                  description="Mask all but last 4 digits of phone numbers."
                  checked={!!currentSettings.redact_phone_number}
                  onChange={toggle('redact_phone_number')}
                />
                <SettingRow
                  label="Redact Plate in Exports"
                  description="Partially redact plate numbers in CSV/PDF exports."
                  checked={!!currentSettings.redact_plate_in_exports}
                  onChange={toggle('redact_plate_in_exports')}
                />
                <SettingRow
                  label="Require Reason for Unredact"
                  description="Authorised users must supply a reason before viewing PII (logged for audit)."
                  checked={!!currentSettings.require_reason_for_unredact}
                  onChange={toggle('require_reason_for_unredact')}
                />

                <div className="mt-4 rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-xs text-blue-700 dark:text-blue-300">
                  <strong>Compliance note:</strong> These settings implement Privacy Act 2020 IPP 5
                  (data security), IPP 6 (access by subject), and IPP 11 (limits on disclosure).
                  All un-redact events are logged to the Privacy Access Log.
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Access log */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-amber-600" />
              PII Access Log
            </CardTitle>
            <CardDescription>
              Immutable record of when PII fields were viewed un-redacted.
              Retention: 7 years (Privacy Act 2020 s22).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!accessLog || accessLog.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
                <EyeOff className="h-8 w-8" />
                <p className="text-sm">No PII access events recorded yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accessLog.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">{entry.field_accessed}</TableCell>
                      <TableCell className="text-xs text-gray-500">{entry.target_table}</TableCell>
                      <TableCell className="text-xs text-gray-500 max-w-[120px] truncate">
                        {entry.access_reason ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-gray-400 whitespace-nowrap">
                        <span className="flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(entry.accessed_at), { addSuffix: true })}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
